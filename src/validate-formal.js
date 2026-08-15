import fs from "node:fs/promises";

const filePath = process.argv[2] || "results/formal-latest.json";
const data = JSON.parse(await fs.readFile(filePath, "utf8"));
const errors = [];
const HEX64 = /^[a-f0-9]{64}$/i;
const TASK_TYPES = new Set(["audit", "cleanup", "scan_fix", "release_verification", "security_retest", "accessibility_retest", "live_smoke"]);
const STABLE_TASKS = new Set(["cleanup", "scan_fix", "release_verification", "security_retest"]);
const LEVELS = ["source", "controlled_runtime", "staging", "browser_at", "production_observation"];
const DECISIONS = new Set(["source_go", "conditional_go", "go", "go_with_accepted_risk", "go_after_fixes", "no_go"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const FINDING_STATUS = new Set(["open", "passed", "failed", "blocked", "to_fix", "closed", "accepted_risk", "false_positive"]);
const OPEN_STATUS = new Set(["open", "failed", "blocked", "to_fix"]);
const RUNTIME_STATUS = new Set(["to_check", "passed", "failed", "blocked", "not_applicable"]);
const RUNTIME_CATEGORY = new Set(["platform", "infrastructure", "integration", "role", "browser", "device", "input", "assistive_technology", "monitoring", "rollback", "other"]);
const EXECUTION_MODE = new Set(["real", "emulated", "synthetic", "not_executed"]);
const EVIDENCE_TYPES = new Set(["screenshot", "video", "trace", "log", "response", "request", "config", "report", "test_order", "other"]);

function check(condition, message) {
  if (!condition) errors.push(message);
}

function isIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function levelAtLeast(actual, required) {
  return LEVELS.indexOf(actual) >= LEVELS.indexOf(required);
}

const required = [
  "schema_version", "run_id", "generated_at", "task_type", "artifact", "scope", "evidence_level",
  "capabilities", "tool_versions", "scan_configuration", "runtime_matrix", "evidence_registry", "rounds",
  "findings", "false_positives", "changes", "unexecuted_tests", "rollback", "monitoring", "release_decision"
];
for (const key of required) check(Object.hasOwn(data, key), `verplicht veld ontbreekt: ${key}`);

check(data.schema_version === "3.0", "schema_version moet 3.0 zijn");
check(typeof data.run_id === "string" && data.run_id.length >= 3, "run_id ontbreekt");
check(isIso(data.generated_at), "generated_at is geen ISO-datetime");
check(TASK_TYPES.has(data.task_type), "task_type is ongeldig");
check(data.artifact && typeof data.artifact.name === "string" && HEX64.test(data.artifact.sha256 || ""), "artifact name/sha256 ongeldig");
check(data.scope && typeof data.scope.label === "string" && Array.isArray(data.scope.included) && data.scope.included.length > 0 && Array.isArray(data.scope.excluded), "scope ongeldig");
check(LEVELS.includes(data.evidence_level), "evidence_level ongeldig");
check(data.tool_versions && typeof data.tool_versions === "object" && Object.keys(data.tool_versions).length > 0, "tool_versions ontbreekt");
check(data.scan_configuration && typeof data.scan_configuration === "object" && Object.keys(data.scan_configuration).length > 0, "scan_configuration ontbreekt");
check(DECISIONS.has(data.release_decision), "release_decision ongeldig");

const capabilities = data.capabilities || {};
for (const key of ["public_browser", "authenticated_browser", "browser_emulation", "real_device", "assistive_technology", "staging_access", "production_observation"]) {
  check(typeof capabilities[key] === "boolean", `capabilities.${key} moet boolean zijn`);
}
check(Array.isArray(capabilities.limitations), "capabilities.limitations moet array zijn");

const registry = Array.isArray(data.evidence_registry) ? data.evidence_registry : [];
check(registry.length > 0, "evidence_registry is leeg");
const evidenceIds = new Set();
for (const [index, item] of registry.entries()) {
  const label = `evidence_registry[${index + 1}]`;
  check(item && typeof item === "object", `${label} is geen object`);
  if (!item || typeof item !== "object") continue;
  check(typeof item.id === "string" && item.id.length >= 3, `${label}.id ongeldig`);
  check(!evidenceIds.has(item.id), `dubbel evidence-id: ${item.id}`);
  evidenceIds.add(item.id);
  check(EVIDENCE_TYPES.has(item.type), `${label}.type ongeldig`);
  for (const key of ["source", "environment", "scope"]) check(typeof item[key] === "string" && item[key].trim(), `${label}.${key} ontbreekt`);
  check(isIso(item.created_at), `${label}.created_at ongeldig`);
  check(item.sha256 === null || item.sha256 === undefined || HEX64.test(item.sha256), `${label}.sha256 ongeldig`);
}

function validateRefs(ids, label, allowEmpty = true) {
  check(Array.isArray(ids), `${label} moet array zijn`);
  if (!Array.isArray(ids)) return;
  if (!allowEmpty) check(ids.length > 0, `${label} mag niet leeg zijn`);
  check(ids.length === new Set(ids).size, `${label} bevat duplicaten`);
  for (const id of ids) check(evidenceIds.has(id), `${label} verwijst naar onbekend evidence-id ${id}`);
}

const matrix = data.runtime_matrix || {};
check(matrix.schema_version === "2.0", "runtime_matrix.schema_version moet 2.0 zijn");
const runtimeItems = Array.isArray(matrix.items) ? matrix.items : [];
check(runtimeItems.length > 0, "runtime_matrix.items is leeg");
for (const [index, item] of runtimeItems.entries()) {
  const label = `runtime_matrix.items[${index + 1}]`;
  check(typeof item.id === "string" && item.id, `${label}.id ontbreekt`);
  check(RUNTIME_CATEGORY.has(item.category), `${label}.category ongeldig`);
  check(typeof item.component === "string" && item.component, `${label}.component ontbreekt`);
  check(typeof item.selection_basis === "string" && item.selection_basis, `${label}.selection_basis ontbreekt`);
  check(EXECUTION_MODE.has(item.execution_mode), `${label}.execution_mode ongeldig`);
  check(typeof item.required === "boolean", `${label}.required moet boolean zijn`);
  check(RUNTIME_STATUS.has(item.status), `${label}.status ongeldig`);
  validateRefs(item.evidence_ids, `${label}.evidence_ids`);
}

const rounds = Array.isArray(data.rounds) ? data.rounds : [];
check(rounds.length > 0, "rounds is leeg");
for (const [index, round] of rounds.entries()) {
  const label = `rounds[${index + 1}]`;
  check(round.round === index + 1, `${label}.round moet sequentieel zijn`);
  check(["passed", "failed", "blocked"].includes(round.status), `${label}.status ongeldig`);
  for (const key of ["artifact_sha256", "findings_hash", "tool_config_hash"]) check(HEX64.test(round[key] || ""), `${label}.${key} ongeldig`);
  check(round.contract_hash === null || HEX64.test(round.contract_hash || ""), `${label}.contract_hash ongeldig`);
  validateRefs(round.evidence_ids, `${label}.evidence_ids`);
}

if (STABLE_TASKS.has(data.task_type)) {
  check(rounds.length >= 2, `${data.task_type} vereist minimaal twee rondes`);
  if (rounds.length >= 2) {
    const a = rounds.at(-2);
    const b = rounds.at(-1);
    check(a.status === "passed" && b.status === "passed", "laatste twee stabiele rondes moeten passed zijn");
    for (const key of ["artifact_sha256", "contract_hash", "findings_hash", "tool_config_hash"]) {
      check(a[key] === b[key], `laatste twee rondes zijn niet stabiel: ${key} verschilt`);
    }
  }
}

const findings = Array.isArray(data.findings) ? data.findings : [];
check(Array.isArray(data.findings), "findings moet array zijn");
const openCriticalHigh = [];
const openMedium = [];
for (const [index, finding] of findings.entries()) {
  const label = `findings[${index + 1}]`;
  for (const key of ["id", "title", "owner", "expected", "actual", "retest"]) check(typeof finding[key] === "string" && finding[key].trim(), `${label}.${key} ontbreekt`);
  check(SEVERITIES.has(finding.severity), `${label}.severity ongeldig`);
  check(FINDING_STATUS.has(finding.status), `${label}.status ongeldig`);
  validateRefs(finding.evidence_ids, `${label}.evidence_ids`, false);
  if (OPEN_STATUS.has(finding.status) && ["critical", "high"].includes(finding.severity)) openCriticalHigh.push(finding.id);
  if (OPEN_STATUS.has(finding.status) && finding.severity === "medium") openMedium.push(finding.id);
}

for (const key of ["false_positives", "changes", "unexecuted_tests"]) check(Array.isArray(data[key]), `${key} moet array zijn`);

const rollback = data.rollback || {};
check(typeof rollback.available === "boolean", "rollback.available moet boolean zijn");
check(typeof rollback.tested === "boolean", "rollback.tested moet boolean zijn");
check(typeof rollback.plan === "string" && typeof rollback.owner === "string", "rollback plan/owner ontbreekt");
validateRefs(rollback.evidence_ids, "rollback.evidence_ids");
check(!(rollback.tested && !rollback.available), "rollback.tested kan niet true zijn als rollback.available false is");
if (rollback.tested) check(rollback.evidence_ids.length > 0, "geteste rollback vereist evidence");

const monitoring = data.monitoring || {};
check(typeof monitoring.ready === "boolean", "monitoring.ready moet boolean zijn");
check(typeof monitoring.plan === "string" && typeof monitoring.owner === "string", "monitoring plan/owner ontbreekt");
validateRefs(monitoring.evidence_ids, "monitoring.evidence_ids");
if (monitoring.ready) check(monitoring.evidence_ids.length > 0, "monitoring.ready=true vereist evidence");

const requiredItems = runtimeItems.filter((item) => item.required);
const passedRequired = requiredItems.filter((item) => item.status === "passed");
const coverage = requiredItems.length === 0 ? 100 : Math.round((passedRequired.length / requiredItems.length) * 10000) / 100;

if (data.evidence_level === "staging") check(capabilities.staging_access, "staging evidence vereist staging_access");
if (data.evidence_level === "production_observation") check(capabilities.production_observation, "production_observation vereist capability");
if (data.evidence_level === "browser_at") {
  check(capabilities.public_browser || capabilities.authenticated_browser || capabilities.assistive_technology, "browser_at vereist browser/AT capability");
  check(runtimeItems.some((item) => item.status === "passed" && ["browser", "device", "input", "assistive_technology"].includes(item.category)), "browser_at vereist passed client-runtime item");
}

if (data.release_decision === "go") {
  check(levelAtLeast(data.evidence_level, "staging"), "go vereist staging of hoger evidence level");
  check(coverage === 100, "go vereist 100% required runtime coverage");
  check(openCriticalHigh.length === 0, "go kan geen open critical/high finding hebben");
  check(data.unexecuted_tests.length === 0, "go kan geen onuitgevoerde in-scope tests hebben");
  check(rollback.available && rollback.tested, "go vereist beschikbare en geteste rollback");
  check(monitoring.ready, "go vereist monitoring.ready=true");
}
if (data.release_decision === "source_go") check(data.evidence_level === "source", "source_go vereist evidence_level source");
if (!["no_go", "go_after_fixes", "go_with_accepted_risk"].includes(data.release_decision)) {
  check(openCriticalHigh.length === 0, `${data.release_decision} is incompatibel met open critical/high findings`);
}
if (data.release_decision === "go_with_accepted_risk") check(Array.isArray(data.accepted_risks) && data.accepted_risks.length > 0, "go_with_accepted_risk vereist accepted_risks");

if (data.score !== undefined && data.score !== null) {
  check(typeof data.score.value === "number" && data.score.value >= 0 && data.score.value <= 10, "score.value ongeldig");
  check(data.score.scale === 10, "score.scale moet 10 zijn");
  check(Math.abs(Number(data.score.required_coverage_percent) - coverage) < 0.01, `score coverage moet ${coverage} zijn`);
  if (data.score.value === 10) {
    check(coverage === 100, "10/10 vereist 100% coverage");
    check(openCriticalHigh.length === 0 && openMedium.length === 0, "10/10 kan geen open critical/high/medium findings hebben");
    check(data.unexecuted_tests.length === 0, "10/10 kan geen onuitgevoerde in-scope tests hebben");
  }
}

if (errors.length) {
  console.error("Formeel evidence-manifest ongeldig:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Formeel evidence-manifest geldig: ${findings.length} findings, ${runtimeItems.length} runtime-items, ${rounds.length} ronde(s), ${coverage}% required coverage.`);
