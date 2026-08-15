export const LEVELS = new Set(["quick", "standard", "full"]);
export const TASK_TYPES = new Set(["audit", "live_smoke", "release_verification"]);
export const TARGET_ENVIRONMENTS = new Set(["production", "staging", "public_test"]);
export const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
export const HEX64 = /^[a-f0-9]{64}$/i;

export const BASE_REQUIRED_SOURCES = [
  "active/00-project-index-en-router.md",
  "active/01-qa-proces-en-severity.md",
  "active/11-evidence-levels-runtime-matrix.md",
  "support/82-tool-en-browsermatrix.md",
  "support/83-evidence-manifest-schema.json",
  "support/84-runtime-matrix-schema.json",
  "support/87-master-project-checklist.md",
  "support/88-playwright-axe-adapter.md"
];

export const RELEASE_REQUIRED_SOURCES = [
  "active/09-release-go-no-go-en-hertest.md",
  "active/13-release-scoring-and-claim-gates.md"
];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertSafeIdentifier(value, label = "identifier") {
  requireCondition(typeof value === "string" && IDENTIFIER_RE.test(value), `${label} moet 3-80 tekens bevatten en alleen letters, cijfers, punt, underscore of koppelteken gebruiken.`);
  return value;
}

export function assertSourceContext(request) {
  const context = request.source_context;
  requireCondition(context && typeof context === "object" && !Array.isArray(context), "source_context ontbreekt. Lees eerst de Website QA Skill en actieve Checklist-bronnen voordat de runner wordt gestart.");
  requireCondition(context.project_id === "project-checklist", "source_context.project_id moet project-checklist zijn.");
  requireCondition(typeof context.source_set_version === "string" && context.source_set_version.length >= 5, "source_context.source_set_version ontbreekt.");
  requireCondition(HEX64.test(context.manifest_sha256 || ""), "source_context.manifest_sha256 moet de SHA-256 van het live Project Checklist manifest bevatten.");
  requireCondition(Array.isArray(context.selected_sources), "source_context.selected_sources moet een lijst met vooraf gelezen bronnen zijn.");
  requireCondition(context.selected_sources.length === new Set(context.selected_sources).size, "source_context.selected_sources bevat duplicaten.");
  requireCondition(context.selected_sources.length <= 40, "source_context.selected_sources is onverwacht groot.");
  requireCondition(context.source_hashes && typeof context.source_hashes === "object" && !Array.isArray(context.source_hashes), "source_context.source_hashes ontbreekt.");

  const required = [...BASE_REQUIRED_SOURCES];
  if (request.task_type === "release_verification") required.push(...RELEASE_REQUIRED_SOURCES);
  const missing = required.filter((source) => !context.selected_sources.includes(source));
  requireCondition(!missing.length, `Bronpreflight onvolledig. Ontbrekend: ${missing.join(", ")}`);

  for (const source of context.selected_sources) {
    requireCondition(typeof source === "string" && !source.includes("..") && !source.startsWith("/"), `Ongeldig bronpad: ${source}`);
    requireCondition(HEX64.test(context.source_hashes[source] || ""), `Bronhash ontbreekt of is ongeldig voor ${source}.`);
  }
  const extraHashKeys = Object.keys(context.source_hashes).filter((source) => !context.selected_sources.includes(source));
  requireCondition(extraHashKeys.length === 0, `source_hashes bevat niet-geselecteerde bronnen: ${extraHashKeys.join(", ")}`);
  requireCondition(typeof context.selection_basis === "string" && context.selection_basis.trim().length >= 3, "source_context.selection_basis ontbreekt.");
  return context;
}

export function assertRequestContract(request) {
  requireCondition(request && typeof request === "object" && !Array.isArray(request), "Request moet een JSON-object zijn.");
  assertSafeIdentifier(request.request_id, "request_id");
  requireCondition(typeof request.url === "string" && request.url.length > 0, "request.url ontbreekt.");
  requireCondition(LEVELS.has(request.level), "level moet quick, standard of full zijn.");
  requireCondition(TASK_TYPES.has(request.task_type), "task_type moet audit, live_smoke of release_verification zijn.");
  requireCondition(TARGET_ENVIRONMENTS.has(request.target_environment), "target_environment moet production, staging of public_test zijn.");
  assertSourceContext(request);
  return request;
}
