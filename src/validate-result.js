import fs from "node:fs/promises";

const filePath = process.argv[2] || "results/latest.json";
const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

requireCondition(payload.schema_version === "raw-evidence-v1", "schema_version moet raw-evidence-v1 zijn");
requireCondition(Boolean(payload.request?.request_id), "request.request_id ontbreekt");
requireCondition(payload.source_context?.project_id === "project-checklist", "source_context.project_id klopt niet");
requireCondition(Boolean(payload.source_context?.source_set_version), "source_context.source_set_version ontbreekt");
requireCondition(/^[a-f0-9]{64}$/i.test(payload.source_context?.manifest_sha256 || ""), "manifest_sha256 ontbreekt of is ongeldig");
requireCondition(payload.runner?.contract === "raw-evidence-v1", "runner.contract klopt niet");
requireCondition(payload.runner?.mutation_performed === false, "runner mag geen targetmutatie rapporteren");
requireCondition(payload.policy_evaluation === null, "policy_evaluation moet null blijven in de runner");
requireCondition(!Object.hasOwn(payload, "decision"), "runner mag geen decision veld produceren");
requireCondition(Array.isArray(payload.observations) && payload.observations.length > 0, "observations ontbreken");
requireCondition(Array.isArray(payload.evidence_registry) && payload.evidence_registry.length > 0, "evidence_registry ontbreekt");
requireCondition(payload.final_evidence_contract?.schema === "support/83-evidence-manifest-schema.json", "formeel evidence-contract ontbreekt");

const evidenceIds = new Set((payload.evidence_registry || []).map((item) => item.id));
for (const item of payload.observations || []) {
  for (const forbidden of ["status", "priority", "confidence", "decision", "severity"]) {
    requireCondition(!Object.hasOwn(item, forbidden), `observation ${item.id} bevat verboden beleidsveld ${forbidden}`);
  }
  requireCondition(["observed_ok", "observed_issue", "needs_interpretation", "not_executed", "not_applicable"].includes(item.outcome), `observation ${item.id} heeft ongeldige outcome`);
  requireCondition(Array.isArray(item.source_refs) && item.source_refs.length > 0, `observation ${item.id} mist source_refs`);
  for (const evidenceId of item.evidence_ids || []) {
    requireCondition(evidenceIds.has(evidenceId), `observation ${item.id} verwijst naar onbekend evidence-id ${evidenceId}`);
  }
}

for (const evidence of payload.evidence_registry || []) {
  if (evidence.sha256 !== null && evidence.sha256 !== undefined) {
    requireCondition(/^[a-f0-9]{64}$/i.test(evidence.sha256), `evidence ${evidence.id} heeft ongeldige sha256`);
  }
  requireCondition(["production_observation", "controlled_runtime", "staging", "browser_at", "source"].includes(evidence.evidence_level), `evidence ${evidence.id} heeft ongeldige evidence_level`);
  requireCondition(["real", "emulated", "synthetic", "not_executed"].includes(evidence.execution_mode), `evidence ${evidence.id} heeft ongeldige execution_mode`);
}

if (errors.length) {
  console.error("Resultaatvalidatie mislukt:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Resultaatvalidatie geslaagd: ${payload.observations.length} observaties, ${payload.evidence_registry.length} evidence-objecten.`);
