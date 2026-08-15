import fs from "node:fs/promises";
import path from "node:path";
import { sha256Json } from "./artifacts.js";
import { assertSafeIdentifier } from "./contracts.js";

const root = process.cwd();
const policyPath = path.resolve(root, process.argv[2] || "policy/current.json");
const resultsDir = path.join(root, "results");
const runsDir = path.join(resultsDir, "runs");
const outputPath = path.resolve(root, process.argv[3] || "results/formal-latest.json");

const TASK_TYPES = new Set(["audit", "cleanup", "scan_fix", "release_verification", "security_retest", "accessibility_retest", "live_smoke"]);
const STABLE_TASKS = new Set(["cleanup", "scan_fix", "release_verification", "security_retest"]);
const RELEASE_DECISIONS = new Set(["source_go", "conditional_go", "go", "go_with_accepted_risk", "go_after_fixes", "no_go"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const FINDING_STATUSES = new Set(["open", "passed", "failed", "blocked", "to_fix", "closed", "accepted_risk", "false_positive"]);
const ROUND_STATUSES = new Set(["passed", "failed", "blocked"]);
const EXPERIENCES = new Set([null, "chat", "work", "codex"]);
const HOSTS = new Set([null, "web", "mobile", "desktop", "cli"]);
const MATRIX_SURFACES = new Set([null, "chat-web", "chat-desktop", "work-web", "work-mobile", "work-desktop", "codex-desktop", "codex-cli"]);
const HEX64 = /^[a-f0-9]{64}$/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function relativeToRoot(filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function assertPolicy(policy) {
  requireCondition(policy?.schema_version === "policy-evaluation-v1", "policy.schema_version moet policy-evaluation-v1 zijn");
  assertSafeIdentifier(policy.evaluation_id, "policy.evaluation_id");
  assertSafeIdentifier(policy.request_id, "policy.request_id");
  requireCondition(policy.source_context?.project_id === "project-checklist", "policy source_context.project_id klopt niet");
  requireCondition(typeof policy.source_context?.source_set_version === "string", "policy source_set_version ontbreekt");
  requireCondition(HEX64.test(policy.source_context?.manifest_sha256 || ""), "policy manifest_sha256 ontbreekt");
  requireCondition(policy.schema_hashes && HEX64.test(policy.schema_hashes.evidence_manifest || ""), "policy evidence schema hash ontbreekt");
  requireCondition(policy.schema_hashes && HEX64.test(policy.schema_hashes.runtime_matrix || ""), "policy runtime schema hash ontbreekt");
  requireCondition(policy.scope && typeof policy.scope.label === "string" && Array.isArray(policy.scope.included) && policy.scope.included.length > 0 && Array.isArray(policy.scope.excluded), "policy.scope is onvolledig");
  requireCondition(Array.isArray(policy.rounds) && policy.rounds.length > 0, "policy.rounds ontbreekt");
  for (const round of policy.rounds) {
    assertSafeIdentifier(round.request_id, "policy round request_id");
    requireCondition(ROUND_STATUSES.has(round.status), `ongeldige round status voor ${round.request_id}`);
  }
  requireCondition(Array.isArray(policy.findings), "policy.findings moet een array zijn");
  for (const finding of policy.findings) {
    requireCondition(typeof finding.observation_id === "string", "finding observation_id ontbreekt");
    requireCondition(SEVERITIES.has(finding.severity), `finding ${finding.observation_id} heeft ongeldige severity`);
    requireCondition(FINDING_STATUSES.has(finding.status), `finding ${finding.observation_id} heeft ongeldige status`);
    for (const key of ["owner", "expected", "actual", "retest"]) {
      requireCondition(typeof finding[key] === "string" && finding[key].trim(), `finding ${finding.observation_id} mist ${key}`);
    }
  }
  requireCondition(Array.isArray(policy.required_runtime_ids), "policy.required_runtime_ids moet een array zijn");
  requireCondition(policy.required_runtime_ids.length === new Set(policy.required_runtime_ids).size, "policy.required_runtime_ids bevat duplicaten");
  requireCondition(Array.isArray(policy.in_scope_unexecuted_ids), "policy.in_scope_unexecuted_ids moet een array zijn");
  requireCondition(Array.isArray(policy.false_positives || []), "policy.false_positives moet een array zijn");
  requireCondition(RELEASE_DECISIONS.has(policy.release_decision), "policy.release_decision is ongeldig");
  requireCondition(policy.rollback && typeof policy.rollback.available === "boolean" && typeof policy.rollback.tested === "boolean", "policy.rollback is onvolledig");
  requireCondition(policy.monitoring && typeof policy.monitoring.ready === "boolean", "policy.monitoring is onvolledig");

  if (policy.surface !== undefined) {
    requireCondition(policy.surface && typeof policy.surface === "object" && !Array.isArray(policy.surface), "policy.surface moet een object zijn");
    requireCondition(EXPERIENCES.has(policy.surface.experience ?? null), "policy.surface.experience is ongeldig");
    requireCondition(HOSTS.has(policy.surface.host ?? null), "policy.surface.host is ongeldig");
    requireCondition(MATRIX_SURFACES.has(policy.surface.runtime_surface ?? null), "policy.surface.runtime_surface is ongeldig");
    if (policy.surface.app_connectors !== undefined) requireCondition(typeof policy.surface.app_connectors === "boolean", "policy.surface.app_connectors moet boolean zijn");
  }
}

function assertRawMatchesPolicy(raw, policy) {
  requireCondition(raw.schema_version === "raw-evidence-v1", `raw ${raw.request?.request_id} heeft verkeerd schema`);
  requireCondition(raw.source_context?.project_id === policy.source_context.project_id, "raw/policy project_id mismatch");
  requireCondition(raw.source_context?.source_set_version === policy.source_context.source_set_version, "raw/policy source_set_version mismatch");
  requireCondition(raw.source_context?.manifest_sha256 === policy.source_context.manifest_sha256, "raw/policy manifest_sha256 mismatch");
  requireCondition(raw.source_context?.source_hashes?.["support/83-evidence-manifest-schema.json"] === policy.schema_hashes.evidence_manifest, "evidence schema hash mismatch");
  requireCondition(raw.source_context?.source_hashes?.["support/84-runtime-matrix-schema.json"] === policy.schema_hashes.runtime_matrix, "runtime schema hash mismatch");
}

function evidenceId(roundId, rawEvidenceId) {
  return `${roundId}--${rawEvidenceId}`;
}

function normalizeEvidence(raw, roundId) {
  return (raw.evidence_registry || []).map((item) => ({
    id: evidenceId(roundId, item.id),
    type: item.type,
    source: item.source,
    created_at: item.created_at,
    environment: item.environment,
    scope: item.scope,
    sha256: item.sha256 ?? null,
    redaction: item.redaction ?? null
  }));
}

function observationMap(raw) {
  return new Map((raw.observations || []).map((item) => [item.id, item]));
}

function runtimeCandidates(raw, roundId) {
  const observations = observationMap(raw);
  const hasEvidence = (id) => (raw.evidence_registry || []).some((item) => item.id === id);
  const candidates = [];

  candidates.push({ id: "RT-PUBLIC-HTTP", category: "platform", component: "publieke HTTP-observatie", target: raw.final_url, execution_mode: "synthetic", passed: observations.get("HTTP-001")?.outcome === "observed_ok", evidence_ids: hasEvidence("EV-HTTP-MAIN") ? [evidenceId(roundId, "EV-HTTP-MAIN")] : [], limitation: "Publieke read-only observatie; geen login of targetmutatie." });
  candidates.push({ id: "RT-BROWSER-DESKTOP", category: "browser", component: "Chromium desktop browserharness", target: raw.final_url, execution_mode: "synthetic", passed: hasEvidence("EV-BROWSER-DESKTOP"), evidence_ids: hasEvidence("EV-BROWSER-DESKTOP") ? [evidenceId(roundId, "EV-BROWSER-DESKTOP")] : [], limitation: "Synthetische GitHub Actions Chromium-run; geen echte gebruikersbrowser." });
  candidates.push({ id: "RT-BROWSER-MOBILE", category: "device", component: "Chromium mobiele viewportemulatie", target: raw.final_url, execution_mode: "emulated", passed: hasEvidence("EV-BROWSER-MOBILE"), evidence_ids: hasEvidence("EV-BROWSER-MOBILE") ? [evidenceId(roundId, "EV-BROWSER-MOBILE")] : [], limitation: "Viewportemulatie is geen echt mobiel apparaat of echte Safari/iOS." });
  candidates.push({ id: "RT-KEYBOARD-ZOOM-SCREENREADER", category: "assistive_technology", component: "keyboard, zoom en screenreader", target: raw.final_url, execution_mode: "not_executed", passed: false, evidence_ids: [], limitation: observations.get("A11Y-MANUAL")?.note || "Aparte echte browser/input/AT-test nodig." });
  candidates.push({ id: "RT-REAL-IOS", category: "device", component: "echt mobiel apparaat / echte Safari-iOS", target: raw.final_url, execution_mode: "not_executed", passed: false, evidence_ids: [], limitation: "Niet uitvoerbaar in deze remote read-only GitHub Actions runner." });
  candidates.push({ id: "RT-STAGING", category: "infrastructure", component: "representatieve staging met integraties en rollback", target: raw.final_url, execution_mode: "not_executed", passed: false, evidence_ids: [], limitation: "Een publieke URL-observatie bewijst geen representatieve staging, database/rollen/integraties of rollback." });
  if (observations.has("RUNTIME-CROSS-BROWSER")) candidates.push({ id: "RT-CROSS-BROWSER", category: "browser", component: "Firefox en WebKit/Safari-afdekking", target: raw.final_url, execution_mode: "not_executed", passed: false, evidence_ids: [], limitation: "Deze runner voert alleen Chromium uit." });
  return candidates;
}

function buildRuntimeMatrix(raw, policy, roundId) {
  const required = new Set(policy.required_runtime_ids);
  const candidates = runtimeCandidates(raw, roundId);
  const known = new Set(candidates.map((item) => item.id));
  for (const id of required) requireCondition(known.has(id), `policy vereist onbekende runtime ${id}`);
  const runtimeSurface = policy.surface?.runtime_surface ?? null;

  return {
    schema_version: "2.0",
    items: candidates.map((item) => {
      const isRequired = required.has(item.id);
      const status = item.passed ? "passed" : isRequired ? "blocked" : "not_applicable";
      return {
        id: item.id,
        category: item.category,
        component: item.component,
        target: item.target,
        version_or_configuration: item.id.startsWith("RT-BROWSER") ? `Playwright ${raw.tool_versions?.playwright || "unknown"}; axe ${raw.tool_versions?.axe_core || "unknown"}` : null,
        selection_basis: policy.runtime_selection_basis || policy.scope.label,
        execution_mode: item.execution_mode,
        required: isRequired,
        status,
        evidence_ids: item.evidence_ids,
        limitation: item.limitation,
        not_applicable_reason: !isRequired && !item.passed ? "Niet verplicht binnen de door Website QA vastgelegde scope." : null,
        surface: runtimeSurface,
        capability: item.id.startsWith("RT-BROWSER") ? "github-actions-remote-browser-harness" : item.id === "RT-PUBLIC-HTTP" ? "public-http" : null,
        invocation_status: item.passed ? "called" : isRequired ? "blocked" : "not_needed",
        recommended_surface: null
      };
    })
  };
}

function mapPolicyEvidenceIds(ids, roundId) {
  return (ids || []).map((id) => evidenceId(roundId, id));
}

function buildFormalFindings(raw, policy, roundId, policyEvidenceId) {
  const observations = observationMap(raw);
  return policy.findings.map((finding) => {
    const observation = observations.get(finding.observation_id);
    requireCondition(observation, `policy finding verwijst naar onbekende observatie ${finding.observation_id}`);
    const rawIds = finding.evidence_ids || observation.evidence_ids || [];
    const mapped = rawIds.map((id) => evidenceId(roundId, id));
    return {
      id: finding.id || `F-${finding.observation_id}`,
      title: finding.title || observation.title,
      severity: finding.severity,
      status: finding.status,
      owner: finding.owner,
      evidence_ids: mapped.length ? mapped : [policyEvidenceId],
      expected: finding.expected,
      actual: finding.actual,
      retest: finding.retest,
      observation_id: finding.observation_id,
      source_refs: observation.source_refs || []
    };
  });
}

const policy = await readJson(policyPath);
assertPolicy(policy);
const rounds = [];
for (const round of policy.rounds) {
  const raw = await readJson(path.join(runsDir, `${round.request_id}.json`));
  requireCondition(raw.request?.request_id === round.request_id, `run history mismatch voor ${round.request_id}`);
  assertRawMatchesPolicy(raw, policy);
  rounds.push({ policy_round: round, raw, roundId: round.request_id });
}

const latest = rounds.at(-1);
requireCondition(latest.raw.request.request_id === policy.request_id, "policy.request_id moet de laatste policy-round zijn");
requireCondition(TASK_TYPES.has(latest.raw.request.task_type), "raw task_type is ongeldig");
if (STABLE_TASKS.has(latest.raw.request.task_type)) {
  requireCondition(rounds.length >= 2, `${latest.raw.request.task_type} vereist minstens twee onafhankelijke raw rondes`);
  requireCondition(new Set(rounds.map((item) => item.raw.request.request_id)).size === rounds.length, "stabiele rondes moeten unieke request_id's hebben");
}

const policyHash = sha256Json(policy);
const policyEvidenceId = "EV-POLICY-EVALUATION";
const registry = rounds.flatMap((item) => normalizeEvidence(item.raw, item.raw.request.request_id));
registry.push({ id: policyEvidenceId, type: "report", source: relativeToRoot(policyPath), created_at: new Date().toISOString(), environment: "website-qa-policy", scope: policy.scope.label, sha256: policyHash, redaction: null });

const findings = buildFormalFindings(latest.raw, policy, latest.raw.request.request_id, policyEvidenceId);
const findingsHash = sha256Json(findings);
const contractHash = sha256Json({ source_context: policy.source_context, schema_hashes: policy.schema_hashes });
const formalRounds = rounds.map((item, index) => ({ round: index + 1, status: item.policy_round.status, artifact_sha256: item.raw.artifact_fingerprint_sha256, contract_hash: contractHash, findings_hash: findingsHash, tool_config_hash: item.raw.configuration_hash, evidence_ids: (item.raw.evidence_registry || []).map((evidence) => evidenceId(item.raw.request.request_id, evidence.id)) }));

const matrix = buildRuntimeMatrix(latest.raw, policy, latest.raw.request.request_id);
const evidenceLevels = new Set((latest.raw.evidence_registry || []).map((item) => item.evidence_level));
const evidenceLevel = evidenceLevels.has("production_observation") ? "production_observation" : evidenceLevels.has("staging") ? "staging" : evidenceLevels.has("browser_at") ? "browser_at" : evidenceLevels.has("controlled_runtime") ? "controlled_runtime" : "source";
const inScopeUnexecuted = new Set(policy.in_scope_unexecuted_ids);
const unexecutedTests = (latest.raw.unexecuted_tests || []).filter((item) => inScopeUnexecuted.has(item.id));
for (const id of inScopeUnexecuted) requireCondition((latest.raw.unexecuted_tests || []).some((item) => item.id === id), `policy noemt onbekende unexecuted test ${id}`);

const hasDesktopBrowser = (latest.raw.evidence_registry || []).some((item) => item.id === "EV-BROWSER-DESKTOP");
const hasMobileBrowser = (latest.raw.evidence_registry || []).some((item) => item.id === "EV-BROWSER-MOBILE");
const hasBrowserHarness = hasDesktopBrowser || hasMobileBrowser;

const manifest = {
  schema_version: "3.0",
  run_id: policy.evaluation_id,
  generated_at: new Date().toISOString(),
  task_type: latest.raw.request.task_type,
  artifact: { name: latest.raw.final_url, sha256: latest.raw.artifact_fingerprint_sha256 },
  scope: policy.scope,
  evidence_level: evidenceLevel,
  capabilities: {
    public_browser: hasBrowserHarness,
    authenticated_browser: false,
    browser_emulation: hasMobileBrowser,
    real_device: false,
    assistive_technology: false,
    staging_access: false,
    production_observation: evidenceLevels.has("production_observation"),
    limitations: latest.raw.limitations || [],
    experience: policy.surface?.experience ?? null,
    host: policy.surface?.host ?? null,
    cloud_browser: hasBrowserHarness,
    local_files: false,
    local_repository: false,
    terminal_commands: false,
    browser_harness: hasBrowserHarness,
    desktop_app_control: false,
    app_connectors: policy.surface?.app_connectors ?? null
  },
  tool_versions: { runner: latest.raw.runner?.version || "unknown", ...latest.raw.tool_versions },
  scan_configuration: { config_hash: latest.raw.configuration_hash, level: latest.raw.request.level, target_environment: latest.raw.request.target_environment || null, source_set_version: latest.raw.source_context.source_set_version, manifest_sha256: latest.raw.source_context.manifest_sha256, evidence_schema_sha256: policy.schema_hashes.evidence_manifest, runtime_schema_sha256: policy.schema_hashes.runtime_matrix },
  environment: { runner_host: "github-actions", target: latest.raw.final_url, target_environment: latest.raw.request.target_environment || null, source_project: "project-checklist" },
  baseline_contract_hash: contractHash,
  runtime_matrix: matrix,
  evidence_registry: registry,
  rounds: formalRounds,
  findings,
  false_positives: policy.false_positives || [],
  changes: [],
  unexecuted_tests: unexecutedTests,
  rollback: { available: policy.rollback.available, tested: policy.rollback.tested, plan: policy.rollback.plan || "", owner: policy.rollback.owner || "website-qa-checklist", evidence_ids: mapPolicyEvidenceIds(policy.rollback.evidence_ids, latest.raw.request.request_id) },
  monitoring: { ready: policy.monitoring.ready, plan: policy.monitoring.plan || "", owner: policy.monitoring.owner || "website-qa-checklist", evidence_ids: mapPolicyEvidenceIds(policy.monitoring.evidence_ids, latest.raw.request.request_id) },
  release_decision: policy.release_decision
};

if (policy.accepted_risks) manifest.accepted_risks = policy.accepted_risks;
if (policy.security_profile !== undefined) manifest.security_profile = policy.security_profile;
if (policy.score !== undefined) manifest.score = policy.score;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Formal evidence manifest written: ${relativeToRoot(outputPath)}`);
console.log(`Policy evaluation: ${policy.evaluation_id}`);
console.log(`Rounds: ${rounds.length}; findings: ${findings.length}; evidence objects: ${registry.length}`);
