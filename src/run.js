import fs from "node:fs/promises";
import path from "node:path";
import { runChecklist, OUTCOME } from "./checklist.js";
import { assertRequestContract } from "./contracts.js";
import { assertPublicUrl } from "./net.js";
import { sha256Json } from "./artifacts.js";
import { sanitizeResponseHeaders } from "./privacy.js";

const root = process.cwd();
const requestPath = path.resolve(root, process.argv[2] || path.join("requests", "current.json"));
const resultDir = path.join(root, "results");
const resultRunsDir = path.join(resultDir, "runs");
const resultPath = path.join(resultDir, "latest.json");

function qualifyArtifactEntry(entry, runId) {
  const artifactName = process.env.CHECKLIST_ARTIFACT_NAME;
  return { ...entry, source: artifactName ? `github-actions-artifact:${artifactName}/${entry.source}` : `artifacts/runs/${runId}/${entry.source}` };
}

function artifactBySuffix(entries, suffix) {
  return entries.find((entry) => entry.source.endsWith(suffix));
}

function publicObservationLevel(targetEnvironment) {
  return targetEnvironment === "production" ? "production_observation" : "controlled_runtime";
}

function sanitizeResultForPublicJson(result) {
  const rawHeaders = { ...(result.network_evidence?.main_response?.headers || {}) };
  result.network_evidence.main_response.headers = sanitizeResponseHeaders(rawHeaders);
  for (const item of result.observations || []) {
    if (!item.id?.startsWith("HDR-")) continue;
    const header = item.data?.header;
    item.data = { header, present: Boolean(header && rawHeaders[header]) };
  }

  const sample = result.network_evidence?.link_sample || [];
  const queryRejected = sample.filter((item) => /queryparameters/i.test(item.error || ""));
  if (queryRejected.length) result.network_evidence.link_sample = sample.filter((item) => !queryRejected.includes(item));
  const linkObservation = result.observations?.find((item) => item.id === "LINK-001");
  if (linkObservation) {
    const kept = result.network_evidence?.link_sample || [];
    const broken = kept.filter((item) => !item.ok);
    const renderedQueryCount = result.browser_evidence?.runs?.find((run) => run.viewport === "desktop" && !run.browser_error)?.dom?.internal_links_with_query_count || 0;
    linkObservation.outcome = broken.length ? OUTCOME.ISSUE : OUTCOME.OK;
    linkObservation.data = {
      ...linkObservation.data,
      tested_count: kept.length,
      broken_count: broken.length,
      broken: broken.slice(0, 20),
      skipped_query_count: renderedQueryCount + queryRejected.length
    };
    linkObservation.note = "Automatische linkprobes volgen geen query-URL's; zulke links worden als overgeslagen gerapporteerd en niet als kapot. Query-specifiek routegedrag vereist aparte veilige evidence.";
  }
  return result;
}

function buildEvidenceRegistry(result, runId, targetEnvironment) {
  const createdAt = result.completed_at;
  const environment = "github-actions";
  const externalLevel = publicObservationLevel(targetEnvironment);
  const registry = [{
    id: "EV-HTTP-MAIN", type: "response", source: "runtime:main-http-response", created_at: createdAt,
    environment, scope: result.final_url, evidence_level: externalLevel, execution_mode: "synthetic",
    sha256: sha256Json(result.network_evidence.main_response)
  }];
  if (result.observations.some((item) => item.id === "LINK-001")) registry.push({ id: "EV-LINK-SAMPLE", type: "report", source: "runtime:internal-link-sample", created_at: createdAt, environment, scope: result.final_url, evidence_level: externalLevel, execution_mode: "synthetic", sha256: sha256Json(result.network_evidence.link_sample) });
  if (result.network_evidence.robots) registry.push({ id: "EV-ROBOTS", type: "response", source: "runtime:robots.txt", created_at: createdAt, environment, scope: result.network_evidence.robots.url, evidence_level: externalLevel, execution_mode: "synthetic", sha256: sha256Json(result.network_evidence.robots) });

  for (const run of result.browser_evidence?.runs || []) {
    if (run.browser_error) continue;
    const viewport = run.viewport.toUpperCase();
    const files = (run.artifact_entries || []).map((entry) => qualifyArtifactEntry(entry, runId));
    const screenshot = artifactBySuffix(files, "page.png");
    const axe = artifactBySuffix(files, "axe.json");
    const trace = artifactBySuffix(files, "trace.zip");
    const domInventory = artifactBySuffix(files, "dom-inventory.json");
    registry.push({
      id: `EV-BROWSER-${viewport}`, type: "report", source: `runtime:chromium-${run.viewport}`, created_at: createdAt,
      environment, scope: result.final_url, evidence_level: "controlled_runtime", execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic",
      sha256: sha256Json({ status_code: run.status_code, final_url: run.final_url, readiness: run.readiness, dom: run.dom, console_errors: run.console_errors, page_errors: run.page_errors, request_failures: run.request_failures, mixed_content_requests: run.mixed_content_requests, websocket_requests: run.websocket_requests }),
      artifacts: [screenshot?.source, trace?.source, domInventory?.source].filter(Boolean)
    });
    if (axe) registry.push({ id: `EV-AXE-${viewport}`, type: "report", source: axe.source, created_at: axe.created_at, environment, scope: `${result.final_url} (${run.viewport})`, evidence_level: "controlled_runtime", execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic", sha256: axe.sha256 });
    for (const file of files) registry.push({ ...file, evidence_level: "controlled_runtime", execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic" });
  }
  return registry;
}

function selectedHeaders(headers = {}) {
  const keys = ["cache-control", "content-security-policy", "content-type", "permissions-policy", "referrer-policy", "strict-transport-security", "x-content-type-options"];
  return Object.fromEntries(keys.map((key) => [key, headers[key] ?? null]));
}

function stableLinkSample(items = []) {
  return items.map((item) => ({ url: item.url || null, final_url: item.final_url || null, status: item.status ?? null, ok: Boolean(item.ok), error: item.error || null })).sort((a, b) => String(a.url).localeCompare(String(b.url)));
}

function stableRobots(robots) {
  if (!robots) return null;
  return { url: robots.url || null, status_code: robots.status_code ?? null, sitemap_directives: [...(robots.sitemap_directives || [])].sort(), blocks_all: Boolean(robots.blocks_all), error: robots.error || null };
}

function stableDom(dom) {
  if (!dom) return null;
  return {
    document_ready_state: dom.document_ready_state || null, title: dom.title || null, description: dom.description || null,
    lang: dom.lang || null, viewport_meta: dom.viewport_meta || null, canonical: dom.canonical || null, robots_meta: dom.robots_meta || null,
    h1_count: dom.h1_count ?? null, form_count: dom.form_count ?? null, image_count: dom.image_count ?? null,
    missing_alt_attribute_count: dom.missing_alt_attribute_count ?? null, interactive_count: dom.interactive_count ?? null,
    internal_links: [...(dom.internal_links || [])].sort(), internal_links_with_query_count: dom.internal_links_with_query_count ?? 0,
    inventory: dom.inventory || null
  };
}

function stableAxe(axe) {
  if (!axe) return null;
  return { violation_count: axe.violation_count ?? null, serious_or_critical_count: axe.serious_or_critical_count ?? null, incomplete: axe.incomplete ?? null, violations: (axe.violations || []).map((item) => ({ id: item.id, impact: item.impact || null, node_count: item.node_count ?? null, targets: item.targets || [] })) };
}

function stableBrowserRuns(runs = []) {
  return runs.map((run) => {
    if (run.browser_error) return { viewport: run.viewport, browser_error: run.browser_error };
    return {
      viewport: run.viewport, viewport_size: run.viewport_size || null, status_code: run.status_code ?? null, final_url: run.final_url || null,
      readiness: run.readiness ? { body_visible: Boolean(run.readiness.body_visible), strategy: run.readiness.strategy || null, quiescence_reason: run.readiness.quiescence_reason || null } : null,
      dom: stableDom(run.dom), axe: stableAxe(run.axe), console_errors: run.console_errors || [], page_errors: run.page_errors || [], request_failures: run.request_failures || [], mixed_content_requests: [...(run.mixed_content_requests || [])].sort(), websocket_requests: [...(run.websocket_requests || [])].sort()
    };
  }).sort((a, b) => String(a.viewport).localeCompare(String(b.viewport)));
}

function artifactFingerprint(result) {
  return sha256Json({
    final_url: result.final_url,
    main_response: { status_code: result.network_evidence.main_response.status_code, content_type: result.network_evidence.main_response.content_type, redirect_chain: result.network_evidence.main_response.redirect_chain || [], headers: selectedHeaders(result.network_evidence.main_response.headers) },
    link_sample: stableLinkSample(result.network_evidence.link_sample), robots: stableRobots(result.network_evidence.robots), browser_runs: stableBrowserRuns(result.browser_evidence?.runs)
  });
}

const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
assertRequestContract(request);
const runId = request.request_id;
const target = await assertPublicUrl(request.url, { allowQuery: false });
const artifactDir = path.join(root, "artifacts", "runs", runId);
await fs.rm(artifactDir, { recursive: true, force: true });
await fs.mkdir(artifactDir, { recursive: true });

const result = sanitizeResultForPublicJson(await runChecklist(target.href, request.level, artifactDir, request.target_environment));
const evidenceRegistry = buildEvidenceRegistry(result, runId, request.target_environment);
const unexecutedTests = result.observations.filter((item) => item.outcome === OUTCOME.NOT_EXECUTED).map((item) => ({ id: item.id, title: item.title, source_refs: item.source_refs, reason: item.note || "Niet uitvoerbaar in deze read-only GitHub Actions runner." }));

const payload = {
  schema_version: "raw-evidence-v1",
  request: { request_id: request.request_id, url: target.href, level: request.level, task_type: request.task_type, target_environment: request.target_environment, requested_at: request.requested_at || null, requested_by: request.requested_by || "ChatGPT" },
  source_context: request.source_context,
  runner: { name: result.runner, version: result.runner_version, contract: result.contract, mutation_performed: result.mutation_performed },
  target: result.target, final_url: result.final_url, started_at: result.started_at, completed_at: result.completed_at,
  configuration_hash: sha256Json({ level: request.level, task_type: request.task_type, target_environment: request.target_environment, source_context: request.source_context }),
  artifact_fingerprint_sha256: artifactFingerprint(result),
  tool_versions: result.browser_evidence?.tool_versions || {}, runtime_observation: result.runtime_observation,
  evidence_registry: evidenceRegistry, observations: result.observations, unexecuted_tests: unexecutedTests, limitations: result.limitations,
  policy_evaluation: null,
  final_evidence_contract: {
    owner: "website-qa-checklist", policy_input: "policy/queue/<evaluation_id>.json", output: "results/formal/<evaluation_id>.json",
    schema: "support/83-evidence-manifest-schema.json", runtime_schema: "support/84-runtime-matrix-schema.json",
    instruction: "Website QA interpreteert de raw observaties tegen de vooraf gelezen live bronnen en schrijft alleen de policy-evaluation. src/finalize.js bouwt daarna deterministisch het formele manifest; repositorycode verzint geen severity, status of releasebesluit."
  }
};

await fs.mkdir(resultDir, { recursive: true });
await fs.mkdir(resultRunsDir, { recursive: true });
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
await fs.writeFile(resultPath, serialized, "utf8");
await fs.writeFile(path.join(resultRunsDir, `${runId}.json`), serialized, "utf8");
console.log(`Request: ${request.request_id}`);
console.log(`Checklist evidence completed for ${result.final_url}`);
console.log(`Source set: ${request.source_context.source_set_version}`);
console.log(`Observations: ${payload.observations.length}; evidence objects: ${payload.evidence_registry.length}`);
console.log(`History: results/runs/${runId}.json`);
