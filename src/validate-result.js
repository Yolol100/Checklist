import fs from "node:fs/promises";
import { IDENTIFIER_RE, TARGET_ENVIRONMENTS } from "./contracts.js";

const filePath = process.argv[2] || "results/latest.json";
const rawText = await fs.readFile(filePath, "utf8");
const payload = JSON.parse(rawText);
const errors = [];
const HEX64 = /^[a-f0-9]{64}$/i;

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

requireCondition(payload.schema_version === "raw-evidence-v1", "schema_version moet raw-evidence-v1 zijn");
requireCondition(IDENTIFIER_RE.test(payload.request?.request_id || ""), "request.request_id ontbreekt of is onveilig");
requireCondition(["quick", "standard", "full"].includes(payload.request?.level), "request.level is ongeldig");
requireCondition(["audit", "live_smoke", "release_verification"].includes(payload.request?.task_type), "request.task_type is ongeldig");
requireCondition(TARGET_ENVIRONMENTS.has(payload.request?.target_environment), "request.target_environment is ongeldig");
requireCondition(payload.source_context?.project_id === "project-checklist", "source_context.project_id klopt niet");
requireCondition(Boolean(payload.source_context?.source_set_version), "source_context.source_set_version ontbreekt");
requireCondition(HEX64.test(payload.source_context?.manifest_sha256 || ""), "manifest_sha256 ontbreekt of is ongeldig");
requireCondition(Array.isArray(payload.source_context?.selected_sources), "selected_sources ontbreekt");
requireCondition(payload.source_context?.selected_sources?.length === new Set(payload.source_context?.selected_sources || []).size, "selected_sources bevat duplicaten");
requireCondition(payload.source_context?.source_hashes && typeof payload.source_context.source_hashes === "object", "source_context.source_hashes ontbreekt");
for (const source of payload.source_context?.selected_sources || []) {
  requireCondition(HEX64.test(payload.source_context?.source_hashes?.[source] || ""), `bronhash ontbreekt/ongeldig voor ${source}`);
}
requireCondition(HEX64.test(payload.source_context?.source_hashes?.["support/83-evidence-manifest-schema.json"] || ""), "evidence-manifest schemahash ontbreekt");
requireCondition(HEX64.test(payload.source_context?.source_hashes?.["support/84-runtime-matrix-schema.json"] || ""), "runtime-matrix schemahash ontbreekt");
requireCondition(payload.runner?.contract === "raw-evidence-v1", "runner.contract klopt niet");
requireCondition(payload.runner?.mutation_performed === false, "runner mag geen targetmutatie rapporteren");
requireCondition(HEX64.test(payload.configuration_hash || ""), "configuration_hash ontbreekt/ongeldig");
requireCondition(HEX64.test(payload.artifact_fingerprint_sha256 || ""), "artifact_fingerprint_sha256 ontbreekt/ongeldig");
requireCondition(payload.policy_evaluation === null, "policy_evaluation moet null blijven in de runner");
requireCondition(!Object.hasOwn(payload, "decision"), "runner mag geen decision veld produceren");
requireCondition(Array.isArray(payload.observations) && payload.observations.length > 0, "observations ontbreken");
requireCondition(Array.isArray(payload.evidence_registry) && payload.evidence_registry.length > 0, "evidence_registry ontbreekt");
requireCondition(payload.final_evidence_contract?.schema === "support/83-evidence-manifest-schema.json", "formeel evidence-contract ontbreekt");
requireCondition(payload.final_evidence_contract?.runtime_schema === "support/84-runtime-matrix-schema.json", "formeel runtime-contract ontbreekt");
requireCondition(payload.final_evidence_contract?.policy_input === "policy/queue/<evaluation_id>.json", "policy input-contract ontbreekt");
requireCondition(payload.final_evidence_contract?.output === "results/formal/<evaluation_id>.json", "formal output-contract ontbreekt");

const evidenceIds = new Set();
for (const evidence of payload.evidence_registry || []) {
  requireCondition(typeof evidence.id === "string" && evidence.id.length >= 3, "evidence-id ontbreekt");
  requireCondition(!evidenceIds.has(evidence.id), `dubbel evidence-id ${evidence.id}`);
  evidenceIds.add(evidence.id);
  if (evidence.sha256 !== null && evidence.sha256 !== undefined) requireCondition(HEX64.test(evidence.sha256), `evidence ${evidence.id} heeft ongeldige sha256`);
  requireCondition(["production_observation", "controlled_runtime", "staging", "browser_at", "source"].includes(evidence.evidence_level), `evidence ${evidence.id} heeft ongeldige evidence_level`);
  requireCondition(["real", "emulated", "synthetic", "not_executed"].includes(evidence.execution_mode), `evidence ${evidence.id} heeft ongeldige execution_mode`);
  if (payload.request.target_environment !== "production") {
    requireCondition(evidence.evidence_level !== "production_observation", `evidence ${evidence.id} mag voor ${payload.request.target_environment} geen production_observation zijn`);
  }
}

for (const item of payload.observations || []) {
  for (const forbidden of ["status", "priority", "confidence", "decision", "severity"]) requireCondition(!Object.hasOwn(item, forbidden), `observation ${item.id} bevat verboden beleidsveld ${forbidden}`);
  requireCondition(["observed_ok", "observed_issue", "needs_interpretation", "not_executed", "not_applicable"].includes(item.outcome), `observation ${item.id} heeft ongeldige outcome`);
  requireCondition(Array.isArray(item.source_refs) && item.source_refs.length > 0, `observation ${item.id} mist source_refs`);
  for (const evidenceId of item.evidence_ids || []) requireCondition(evidenceIds.has(evidenceId), `observation ${item.id} verwijst naar onbekend evidence-id ${evidenceId}`);
}

const browserEvidence = payload.evidence_registry.filter((item) => item.id.startsWith("EV-BROWSER-"));
requireCondition(Boolean(payload.runtime_observation?.browser_harness) === (browserEvidence.length > 0), "runtime_observation.browser_harness moet overeenkomen met echt browserevidence");
for (const item of browserEvidence) requireCondition(item.evidence_level === "controlled_runtime", `${item.id} moet controlled_runtime blijven`);
const mobile = payload.evidence_registry.find((item) => item.id === "EV-BROWSER-MOBILE");
if (mobile) requireCondition(mobile.execution_mode === "emulated", "EV-BROWSER-MOBILE moet emulated zijn");

requireCondition(!/[?&](?:access_token|id_token|api[_-]?key|token|secret)=/i.test(rawText), "raw evidence bevat een query-secretpatroon");
requireCondition(!/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/i.test(rawText), "raw evidence bevat een Bearer-tokenpatroon");

if (errors.length) {
  console.error("Resultaatvalidatie mislukt:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Resultaatvalidatie geslaagd: ${payload.observations.length} observaties, ${payload.evidence_registry.length} evidence-objecten.`);
