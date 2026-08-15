import fs from "node:fs/promises";
import path from "node:path";
import { runChecklist, OUTCOME } from "./checklist.js";
import { assertPublicUrl } from "./net.js";
import { sha256Json } from "./artifacts.js";

const root = process.cwd();
const requestPath = path.join(root, "requests", "current.json");
const resultDir = path.join(root, "results");
const resultRunsDir = path.join(resultDir, "runs");
const resultPath = path.join(resultDir, "latest.json");

const BASE_REQUIRED_SOURCES = [
  "active/00-project-index-en-router.md",
  "active/01-qa-proces-en-severity.md",
  "active/11-evidence-levels-runtime-matrix.md",
  "support/82-tool-en-browsermatrix.md",
  "support/83-evidence-manifest-schema.json",
  "support/84-runtime-matrix-schema.json",
  "support/87-master-project-checklist.md",
  "support/88-playwright-axe-adapter.md"
];

const RELEASE_REQUIRED_SOURCES = [
  "active/09-release-go-no-go-en-hertest.md",
  "active/13-release-scoring-and-claim-gates.md"
];

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function assertSourceContext(request) {
  const context = request.source_context;
  if (!context || typeof context !== "object") {
    throw new Error("source_context ontbreekt. Lees eerst de Website QA Skill en actieve Checklist-bronnen voordat de runner wordt gestart.");
  }
  if (context.project_id !== "project-checklist") {
    throw new Error("source_context.project_id moet project-checklist zijn.");
  }
  if (typeof context.source_set_version !== "string" || context.source_set_version.length < 5) {
    throw new Error("source_context.source_set_version ontbreekt.");
  }
  if (!/^[a-f0-9]{64}$/i.test(context.manifest_sha256 || "")) {
    throw new Error("source_context.manifest_sha256 moet de SHA-256 van het live Project Checklist manifest bevatten.");
  }
  if (!Array.isArray(context.selected_sources)) {
    throw new Error("source_context.selected_sources moet een lijst met vooraf gelezen bronnen zijn.");
  }
  if (!context.source_hashes || typeof context.source_hashes !== "object" || Array.isArray(context.source_hashes)) {
    throw new Error("source_context.source_hashes ontbreekt. Neem de SHA-256 van iedere geselecteerde live bron over uit het manifest/SHA256SUMS.");
  }

  const required = [...BASE_REQUIRED_SOURCES];
  if (request.task_type === "release_verification") required.push(...RELEASE_REQUIRED_SOURCES);
  const missing = required.filter((source) => !context.selected_sources.includes(source));
  if (missing.length) {
    throw new Error(`Bronpreflight onvolledig. Ontbrekend: ${missing.join(", ")}`);
  }

  for (const source of context.selected_sources) {
    if (!/^[a-f0-9]{64}$/i.test(context.source_hashes[source] || "")) {
      throw new Error(`Bronhash ontbreekt of is ongeldig voor ${source}.`);
    }
  }

  if (typeof context.selection_basis !== "string" || context.selection_basis.length < 3) {
    throw new Error("source_context.selection_basis ontbreekt.");
  }

  return context;
}

function qualifyArtifactEntry(entry, runId) {
  return {
    ...entry,
    source: `artifacts/runs/${runId}/${entry.source}`
  };
}

function artifactBySuffix(entries, suffix) {
  return entries.find((entry) => entry.source.endsWith(suffix));
}

function buildEvidenceRegistry(result, runId) {
  const createdAt = result.completed_at;
  const environment = "github-actions";
  const registry = [
    {
      id: "EV-HTTP-MAIN",
      type: "response",
      source: "runtime:main-http-response",
      created_at: createdAt,
      environment,
      scope: result.final_url,
      evidence_level: "production_observation",
      execution_mode: "synthetic",
      sha256: null
    }
  ];

  if (result.observations.some((item) => item.id === "LINK-001")) {
    registry.push({
      id: "EV-LINK-SAMPLE",
      type: "report",
      source: "runtime:internal-link-sample",
      created_at: createdAt,
      environment,
      scope: result.final_url,
      evidence_level: "production_observation",
      execution_mode: "synthetic",
      sha256: sha256Json(result.network_evidence.link_sample)
    });
  }

  if (result.network_evidence.robots) {
    registry.push({
      id: "EV-ROBOTS",
      type: "response",
      source: "runtime:robots.txt",
      created_at: createdAt,
      environment,
      scope: result.network_evidence.robots.url,
      evidence_level: "production_observation",
      execution_mode: "synthetic",
      sha256: sha256Json(result.network_evidence.robots)
    });
  }

  for (const run of result.browser_evidence?.runs || []) {
    if (run.browser_error) continue;
    const viewport = run.viewport.toUpperCase();
    const files = (run.artifact_entries || []).map((entry) => qualifyArtifactEntry(entry, runId));
    const screenshot = artifactBySuffix(files, "page.png");
    const axe = artifactBySuffix(files, "axe.json");
    const trace = artifactBySuffix(files, "trace.zip");
    const domInventory = artifactBySuffix(files, "dom-inventory.json");

    registry.push({
      id: `EV-BROWSER-${viewport}`,
      type: "report",
      source: `runtime:chromium-${run.viewport}`,
      created_at: createdAt,
      environment,
      scope: result.final_url,
      evidence_level: "controlled_runtime",
      execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic",
      sha256: sha256Json({
        status_code: run.status_code,
        final_url: run.final_url,
        readiness: run.readiness,
        dom: run.dom,
        console_errors: run.console_errors,
        page_errors: run.page_errors,
        request_failures: run.request_failures,
        mixed_content_requests: run.mixed_content_requests
      }),
      artifacts: [screenshot?.source, trace?.source, domInventory?.source].filter(Boolean)
    });

    if (axe) {
      registry.push({
        id: `EV-AXE-${viewport}`,
        type: "report",
        source: axe.source,
        created_at: axe.created_at,
        environment,
        scope: `${result.final_url} (${run.viewport})`,
        evidence_level: "controlled_runtime",
        execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic",
        sha256: axe.sha256
      });
    }

    for (const file of files) {
      registry.push({
        ...file,
        evidence_level: "controlled_runtime",
        execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic"
      });
    }
  }

  return registry;
}

function artifactFingerprint(result) {
  const desktop = result.browser_evidence?.runs?.find((run) => run.viewport === "desktop" && !run.browser_error);
  const dom = desktop?.dom;
  return sha256Json({
    final_url: result.final_url,
    status_code: result.network_evidence.main_response.status_code,
    content_type: result.network_evidence.main_response.content_type,
    rendered_state: dom ? {
      title: dom.title,
      description: dom.description,
      lang: dom.lang,
      viewport_meta: dom.viewport_meta,
      canonical: dom.canonical,
      robots_meta: dom.robots_meta,
      h1_count: dom.h1_count,
      form_count: dom.form_count,
      image_count: dom.image_count,
      missing_alt_attribute_count: dom.missing_alt_attribute_count,
      internal_links: dom.internal_links
    } : null
  });
}

const raw = await fs.readFile(requestPath, "utf8");
const request = JSON.parse(raw);

if (!request.url || typeof request.url !== "string") {
  throw new Error("requests/current.json moet een geldige url bevatten.");
}
if (!request.request_id || typeof request.request_id !== "string") {
  throw new Error("requests/current.json moet een unieke request_id bevatten.");
}
if (!["audit", "live_smoke", "release_verification"].includes(request.task_type)) {
  throw new Error("task_type moet audit, live_smoke of release_verification zijn.");
}

const runId = safeId(request.request_id);
if (!runId) throw new Error("request_id bevat geen bruikbare tekens.");
const sourceContext = assertSourceContext(request);
const target = await assertPublicUrl(request.url, { allowQuery: false });
const level = ["quick", "standard", "full"].includes(request.level) ? request.level : "standard";
const artifactDir = path.join(root, "artifacts", "runs", runId);

await fs.rm(artifactDir, { recursive: true, force: true });
await fs.mkdir(artifactDir, { recursive: true });

const result = await runChecklist(target.href, level, artifactDir);
const evidenceRegistry = buildEvidenceRegistry(result, runId);
const unexecutedTests = result.observations
  .filter((item) => item.outcome === OUTCOME.NOT_EXECUTED)
  .map((item) => ({ id: item.id, title: item.title, source_refs: item.source_refs, reason: item.note || "Niet uitvoerbaar in deze read-only GitHub Actions runner." }));

const payload = {
  schema_version: "raw-evidence-v1",
  request: {
    request_id: request.request_id,
    url: target.href,
    level,
    task_type: request.task_type,
    requested_at: request.requested_at || null,
    requested_by: request.requested_by || "ChatGPT"
  },
  source_context: sourceContext,
  runner: {
    name: result.runner,
    version: result.runner_version,
    contract: result.contract,
    mutation_performed: result.mutation_performed
  },
  target: result.target,
  final_url: result.final_url,
  started_at: result.started_at,
  completed_at: result.completed_at,
  configuration_hash: sha256Json({ level, task_type: request.task_type, source_context: sourceContext }),
  artifact_fingerprint_sha256: artifactFingerprint(result),
  tool_versions: result.browser_evidence?.tool_versions || {},
  runtime_observation: result.runtime_observation,
  evidence_registry: evidenceRegistry,
  observations: result.observations,
  unexecuted_tests: unexecutedTests,
  limitations: result.limitations,
  policy_evaluation: null,
  final_evidence_contract: {
    owner: "website-qa-checklist",
    policy_input: "policy/current.json",
    output: "results/formal-latest.json",
    schema: "support/83-evidence-manifest-schema.json",
    runtime_schema: "support/84-runtime-matrix-schema.json",
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
console.log(`Source set: ${sourceContext.source_set_version}`);
console.log(`Observations: ${payload.observations.length}; evidence objects: ${payload.evidence_registry.length}`);
console.log(`History: results/runs/${runId}.json`);
