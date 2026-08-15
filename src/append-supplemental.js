import fs from "node:fs/promises";
import path from "node:path";
import { sha256Json } from "./artifacts.js";
import { mergeObservation } from "./supplemental-merge.js";

const requestPath = process.argv[2];
if (!requestPath) throw new Error("request path ontbreekt");
const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
const latestPath = path.join("results", "latest.json");
const runPath = path.join("results", "runs", `${request.request_id}.json`);
const payload = JSON.parse(await fs.readFile(latestPath, "utf8"));
const supplemental = JSON.parse(await fs.readFile(path.join("results", "supplemental.json"), "utf8"));
const now = payload.completed_at || new Date().toISOString();
const evidenceIds = [];

function addEvidence(item) {
  if (payload.evidence_registry.some((existing) => existing.id === item.id)) throw new Error(`dubbel evidence-id ${item.id}`);
  payload.evidence_registry.push(item);
  evidenceIds.push(item.id);
}
function addObservation(item, options) {
  return mergeObservation(payload.observations, item, options);
}

const crossRuns = supplemental.cross_browser || [];
const successful = crossRuns.filter((run) => !run.browser_error);
for (const run of successful) {
  addEvidence({ id: `EV-BROWSER-${run.browser.toUpperCase()}-DESKTOP`, type: "report", source: `runtime:${run.browser}-desktop`, created_at: now, environment: "github-actions", scope: payload.final_url, evidence_level: "controlled_runtime", execution_mode: "synthetic", sha256: sha256Json(run) });
}
if (crossRuns.length) {
  addObservation({
    id: "RUNTIME-CROSS-BROWSER", category: "runtime", title: "Playwright Firefox/WebKit synthetic smoke",
    outcome: successful.length === crossRuns.length ? "observed_ok" : successful.length ? "needs_interpretation" : "not_executed",
    source_refs: ["support/82-tool-en-browsermatrix.md", "active/11-evidence-levels-runtime-matrix.md"],
    evidence_ids: successful.map((run) => `EV-BROWSER-${run.browser.toUpperCase()}-DESKTOP`),
    data: { requested: crossRuns.map((run) => run.browser), completed: successful.map((run) => run.browser), errors: crossRuns.filter((run) => run.browser_error).map((run) => ({ browser: run.browser, error: run.browser_error })), summaries: successful.map((run) => ({ browser: run.browser, status_code: run.status_code, final_url: run.final_url, dom: run.dom, console_error_count: run.console_errors.length, page_error_count: run.page_errors.length, blocked_write_count: run.blocked_write_requests.length })) },
    note: "Firefox en Playwright WebKit zijn synthetische controlled-runtime checks. WebKit is geen bewijs voor echte branded Safari/iOS, echte apparaten of assistive technology."
  }, { replaceNotExecutedPlaceholder: true });
}

if (supplemental.link_scan) {
  addEvidence({ id: "EV-LINK-BOUNDED", type: "report", source: "runtime:bounded-same-origin-link-scan", created_at: now, environment: "github-actions", scope: payload.final_url, evidence_level: "controlled_runtime", execution_mode: "synthetic", sha256: sha256Json(supplemental.link_scan) });
  addObservation({ id: "LINK-BOUNDED", category: "links", title: "Begrensde same-origin linkscan", outcome: supplemental.link_scan.broken_count > 0 ? "observed_issue" : "observed_ok", source_refs: ["active/04-seo-indexatie-en-migratie.md", "support/82-tool-en-browsermatrix.md"], evidence_ids: ["EV-LINK-BOUNDED"], data: supplemental.link_scan, note: supplemental.link_scan.limitation });
}

let vnuSummary = null;
try {
  const parsed = JSON.parse(await fs.readFile(path.join("reports", "vnu.json"), "utf8"));
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  vnuSummary = { message_count: messages.length, error_count: messages.filter((item) => item.type === "error").length, warning_count: messages.filter((item) => item.type === "info" && item.subType === "warning").length, info_count: messages.filter((item) => item.type === "info" && item.subType !== "warning").length };
  addEvidence({ id: "EV-HTML-VNU", type: "report", source: "runtime:local-nu-html-checker", created_at: now, environment: "github-actions", scope: payload.final_url, evidence_level: "controlled_runtime", execution_mode: "synthetic", sha256: sha256Json(vnuSummary) });
  addObservation({ id: "HTML-VNU", category: "frontend", title: "Lokale Nu HTML-validatie", outcome: vnuSummary.error_count ? "observed_issue" : vnuSummary.warning_count ? "needs_interpretation" : "observed_ok", source_refs: ["support/82-tool-en-browsermatrix.md", "active/02-frontend-responsive-accessibility.md"], evidence_ids: ["EV-HTML-VNU"], data: vnuSummary, note: "Markupvalidator-signalen zijn diagnostiek; Website QA bepaalt relevantie tegen de actieve bron en gebruikersflow." });
} catch {}

let lighthouseSummary = null;
try {
  const files = (await fs.readdir(".lighthouseci")).filter((name) => /^lhr-.*\.json$/.test(name)).sort();
  if (files.length) {
    const parsed = JSON.parse(await fs.readFile(path.join(".lighthouseci", files[0]), "utf8"));
    lighthouseSummary = { performance: parsed.categories?.performance?.score ?? null, accessibility: parsed.categories?.accessibility?.score ?? null, best_practices: parsed.categories?.["best-practices"]?.score ?? null, seo: parsed.categories?.seo?.score ?? null, lighthouse_version: parsed.lighthouseVersion || null };
    addEvidence({ id: "EV-LIGHTHOUSE-LAB", type: "report", source: "runtime:lighthouse-lab", created_at: now, environment: "github-actions", scope: payload.final_url, evidence_level: "controlled_runtime", execution_mode: "synthetic", sha256: sha256Json(lighthouseSummary) });
    addObservation({ id: "PERF-LIGHTHOUSE-LAB", category: "performance", title: "Lighthouse labdiagnose uitgevoerd", outcome: "needs_interpretation", source_refs: ["active/06-wordpress-elementor-en-performance.md", "support/82-tool-en-browsermatrix.md"], evidence_ids: ["EV-LIGHTHOUSE-LAB"], data: lighthouseSummary, note: "Lighthouse is synthetische labdiagnose en geen velddata/Core Web Vitals-productieclaim." });
  }
} catch {}

payload.supplemental_tooling = { schema_version: supplemental.schema_version, cross_browser_requested: crossRuns.map((run) => run.browser), cross_browser_completed: successful.map((run) => run.browser), bounded_link_scan: supplemental.link_scan ? { links_tested: supplemental.link_scan.links_tested, broken_count: supplemental.link_scan.broken_count } : null, local_vnu: vnuSummary, lighthouse_lab: lighthouseSummary, limitations: supplemental.limitations || [] };
payload.limitations.push(...(supplemental.limitations || []));
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
await fs.writeFile(latestPath, serialized, "utf8");
await fs.writeFile(runPath, serialized, "utf8");
console.log(`Supplemental evidence merged: ${evidenceIds.join(", ") || "none"}`);
