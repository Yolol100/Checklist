import fs from "node:fs/promises";
import path from "node:path";
import { runChecklist, OUTCOME } from "./checklist.js";
import { assertPublicUrl } from "./net.js";
import { sha256Json } from "./artifacts.js";

const root = process.cwd();
const requestPath = path.join(root, "requests", "current.json");
const resultDir = path.join(root, "results");
const resultPath = path.join(resultDir, "latest.json");
const artifactDir = path.join(root, "artifacts", "latest");

const BASE_REQUIRED_SOURCES = [
  "active/00-project-index-en-router.md",
  "active/01-qa-proces-en-severity.md",
  "active/11-evidence-levels-runtime-matrix.md",
  "support/87-master-project-checklist.md",
  "support/82-tool-en-browsermatrix.md",
  "support/88-playwright-axe-adapter.md"
];

const RELEASE_REQUIRED_SOURCES = [
  "active/09-release-go-no-go-en-hertest.md",
  "active/13-release-scoring-and-claim-gates.md"
];

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

  const required = [...BASE_REQUIRED_SOURCES];
  if (request.task_type === "release_verification") required.push(...RELEASE_REQUIRED_SOURCES);
  const missing = required.filter((source) => !context.selected_sources.includes(source));
  if (missing.length) {
    throw new Error(`Bronpreflight onvolledig. Ontbrekend: ${missing.join(", ")}`);
  }

  if (typeof context.selection_basis !== "string" || context.selection_basis.length < 3) {
    throw new Error("source_context.selection_basis ontbreekt.");
  }

  return context;
}

function artifactBySuffix(entries, suffix) {
  return entries.find((entry) => entry.source.endsWith(suffix));
}

function buildEvidenceRegistry(result) {
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
    const files = run.artifact_entries || [];
    const screenshot = artifactBySuffix(files, "page.png");
    const axe = artifactBySuffix(files, "axe.json");
    const trace = artifactBySuffix(files, "trace.zip");

    registry.push({
      id: `EV-BROWSER-${viewport}`,
      type: "report",
      source: `runtime:chromium-${run.viewport}`,
      created_at: createdAt,
      environment,
      scope: result.final_url,
      evidence_level: "production_observation",
      execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic",
      sha256: sha256Json({
        status_code: run.status_code,
        final_url: run.final_url,
        dom: run.dom,
        console_errors: run.console_errors,
        page_errors: run.page_errors,
        request_failures: run.request_failures,
        mixed_content_requests: run.mixed_content_requests
      }),
      artifacts: [screenshot?.source, trace?.source].filter(Boolean)
    });

    if (axe) {
      registry.push({
        id: `EV-AXE-${viewport}`,
        type: "report",
        source: axe.source,
        created_at: axe.created_at,
        environment,
        scope: `${result.final_url} (${run.viewport})`,
        evidence_level: "production_observation",
        execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic",
        sha256: axe.sha256
      });
    }

    for (const file of files) {
      registry.push({
        ...file,
        evidence_level: "production_observation",
        execution_mode: run.viewport === "mobile" ? "emulated" : "synthetic"
      });
    }
  }

  return registry;
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

const sourceContext = assertSourceContext(request);
const target = await assertPublicUrl(request.url, { allowQuery: false });
const level = ["quick", "standard", "full"].includes(request.level) ? request.level : "standard";

await fs.rm(artifactDir, { recursive: true, force: true });
await fs.mkdir(artifactDir, { recursive: true });

const result = await runChecklist(target.href, level, artifactDir);
const evidenceRegistry = buildEvidenceRegistry(result);
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
  tool_versions: result.browser_evidence?.tool_versions || {},
  runtime_observation: result.runtime_observation,
  evidence_registry: evidenceRegistry,
  observations: result.observations,
  unexecuted_tests: unexecutedTests,
  limitations: result.limitations,
  policy_evaluation: null,
  final_evidence_contract: {
    owner: "website-qa-checklist",
    schema: "support/83-evidence-manifest-schema.json",
    runtime_schema: "support/84-runtime-matrix-schema.json",
    instruction: "Transformeer deze raw evidence pas na bronvalidatie naar het formele Evidence Manifest 3.0 en laat de Skill de canonieke status, prioriteit en releasebeslissing bepalen."
  }
};

await fs.mkdir(resultDir, { recursive: true });
await fs.writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Request: ${request.request_id}`);
console.log(`Checklist evidence completed for ${result.final_url}`);
console.log(`Source set: ${sourceContext.source_set_version}`);
console.log(`Observations: ${payload.observations.length}; evidence objects: ${payload.evidence_registry.length}`);
