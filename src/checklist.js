import { runBrowserEvidence } from "./browser.js";
import { mapWithConcurrency } from "./concurrency.js";
import { assertPublicUrl, readTextLimited, safeFetch } from "./net.js";
import { sanitizeEvidenceText, sanitizeUrlForEvidence } from "./privacy.js";

export const OUTCOME = {
  OK: "observed_ok",
  ISSUE: "observed_issue",
  INTERPRET: "needs_interpretation",
  NOT_EXECUTED: "not_executed",
  NA: "not_applicable"
};

const SOURCE_REFS = {
  bereikbaarheid: ["active/01-qa-proces-en-severity.md", "active/11-evidence-levels-runtime-matrix.md"],
  security: ["active/08-security-en-technische-risicos.md"],
  seo: ["active/04-seo-indexatie-en-migratie.md"],
  frontend: ["active/02-frontend-responsive-accessibility.md"],
  accessibility: ["active/02-frontend-responsive-accessibility.md", "support/88-playwright-axe-adapter.md"],
  forms: ["active/03-formulieren-email-en-crm.md"],
  links: ["active/04-seo-indexatie-en-migratie.md"],
  performance: ["active/06-wordpress-elementor-en-performance.md", "support/82-tool-en-browsermatrix.md"],
  runtime: ["active/11-evidence-levels-runtime-matrix.md", "support/82-tool-en-browsermatrix.md", "support/88-playwright-axe-adapter.md"]
};

function observation({ id, category, title, outcome, data, evidenceIds = [], sourceRefs, note }) {
  return {
    id,
    category,
    title,
    outcome,
    source_refs: sourceRefs || SOURCE_REFS[category] || [],
    evidence_ids: evidenceIds,
    data,
    note: note || null
  };
}

function countMatches(html, regex) {
  return [...html.matchAll(regex)].length;
}

function extractAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1].trim() : "";
}

function findMetaContent(html, name) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (extractAttribute(tag, "name").toLowerCase() === name.toLowerCase()) return extractAttribute(tag, "content");
  }
  return "";
}

function findCanonical(html, base) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = extractAttribute(tag, "rel").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) {
      const href = extractAttribute(tag, "href");
      try { return href ? sanitizeUrlForEvidence(new URL(href, base)) : null; } catch { return null; }
    }
  }
  return null;
}

function absoluteUrl(href, base) {
  try {
    const url = new URL(href, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function checkLink(url, timeoutMs = 7000) {
  try {
    const result = await safeFetch(url, { method: "HEAD", timeoutMs, headers: { "user-agent": "Webactueel-Checklist-QA/0.6 (+read-only evidence runner)" } });
    return {
      url: sanitizeUrlForEvidence(url),
      final_url: sanitizeUrlForEvidence(result.finalUrl),
      status: result.response.status,
      ok: result.response.status < 400,
      conclusive: ![403, 405].includes(result.response.status)
    };
  } catch (error) {
    return {
      url: sanitizeUrlForEvidence(url),
      status: null,
      ok: false,
      conclusive: false,
      error: sanitizeEvidenceText(error instanceof Error ? error.message : String(error), 240)
    };
  }
}

async function collectRobots(finalUrl) {
  const robotsUrl = new URL("/robots.txt", finalUrl);
  try {
    const { response, finalUrl: observedUrl } = await safeFetch(robotsUrl, {
      method: "GET",
      timeoutMs: 8000,
      headers: { "user-agent": "Webactueel-Checklist-QA/0.6 (+read-only evidence runner)" }
    });
    const text = response.status === 200 ? await readTextLimited(response, 250_000) : "";
    return {
      url: sanitizeUrlForEvidence(observedUrl),
      status_code: response.status,
      sitemap_directives: text.split(/\r?\n/).filter((line) => /^\s*sitemap\s*:/i.test(line)).slice(0, 20).map((line) => sanitizeEvidenceText(line, 300)),
      blocks_all: /user-agent\s*:\s*\*[\s\S]{0,500}?disallow\s*:\s*\/\s*(?:\r?\n|$)/i.test(text)
    };
  } catch (error) {
    return {
      url: sanitizeUrlForEvidence(robotsUrl),
      status_code: null,
      error: sanitizeEvidenceText(error instanceof Error ? error.message : String(error), 240)
    };
  }
}

function browserObservations(browserEvidence, level) {
  const observations = [];
  const successful = browserEvidence.runs.filter((run) => !run.browser_error);
  const evidenceFor = (viewport, kind = "browser") => {
    const prefix = kind === "axe" ? "EV-AXE" : "EV-BROWSER";
    return [`${prefix}-${viewport.toUpperCase()}`];
  };

  if (!successful.length) {
    observations.push(observation({
      id: "RUNTIME-BROWSER",
      category: "runtime",
      title: "Chromium browserharness uitgevoerd",
      outcome: OUTCOME.NOT_EXECUTED,
      data: { errors: browserEvidence.runs.map((run) => run.browser_error).filter(Boolean) },
      note: "Browserruntime leverde geen bruikbare run op."
    }));
    return observations;
  }

  observations.push(observation({
    id: "RUNTIME-BROWSER",
    category: "runtime",
    title: "Chromium browserharness uitgevoerd",
    outcome: OUTCOME.OK,
    data: {
      browser: browserEvidence.browser,
      tool_versions: browserEvidence.tool_versions,
      viewports: successful.map((run) => run.viewport),
      execution_note: browserEvidence.execution_note
    },
    evidenceIds: successful.flatMap((run) => evidenceFor(run.viewport))
  }));

  const readinessTimedOut = successful.some((run) => run.readiness?.quiescence_reason === "max_wait_reached");
  observations.push(observation({
    id: "RUNTIME-UI-READINESS",
    category: "runtime",
    title: "Gerenderde UI-readiness vóór inspectie",
    outcome: readinessTimedOut ? OUTCOME.INTERPRET : OUTCOME.OK,
    data: { by_viewport: successful.map((run) => ({ viewport: run.viewport, readiness: run.readiness || null })) },
    evidenceIds: successful.flatMap((run) => evidenceFor(run.viewport)),
    note: readinessTimedOut
      ? "Body was zichtbaar, maar mutation-quiescence bereikte de maximale wachttijd; interpreteer dynamische DOM-resultaten met die beperking."
      : "Inspectie startte pas na zichtbare body en een mutation-quiescence venster; geen networkidle- of blind-sleepclaim."
  }));

  const totalViolations = successful.reduce((sum, run) => sum + (run.axe?.violation_count || 0), 0);
  const serious = successful.reduce((sum, run) => sum + (run.axe?.serious_or_critical_count || 0), 0);
  const incomplete = successful.reduce((sum, run) => sum + (run.axe?.incomplete || 0), 0);
  observations.push(observation({
    id: "A11Y-AUTO",
    category: "accessibility",
    title: "Geautomatiseerde axe-observatie",
    outcome: totalViolations > 0 ? OUTCOME.ISSUE : incomplete > 0 ? OUTCOME.INTERPRET : OUTCOME.OK,
    data: { total_violations: totalViolations, serious_or_critical_count: serious, incomplete_count: incomplete },
    evidenceIds: successful.flatMap((run) => evidenceFor(run.viewport, "axe")),
    note: "Axe is een geautomatiseerd signaal en geen WCAG-conformiteitsclaim."
  }));

  return observations;
}

export async function collectChecklistEvidence(request) {
  const url = await assertPublicUrl(request.url, { allowQuery: false });
  const { response, finalUrl } = await safeFetch(url, {
    method: "GET",
    allowQuery: false,
    timeoutMs: 12_000,
    headers: { "user-agent": "Webactueel-Checklist-QA/0.6 (+read-only evidence runner)" }
  });
  const contentType = response.headers.get("content-type") || "";
  const html = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) ? await readTextLimited(response, 1_000_000) : "";
  const evidence = [];
  const observations = [];

  evidence.push({ id: "EV-HTTP-MAIN", type: "report", source: "runtime:http-main", scope: sanitizeUrlForEvidence(finalUrl) });
  observations.push(observation({
    id: "HTTP-001", category: "bereikbaarheid", title: "Hoofdroute HTTP-status", outcome: response.status < 400 ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { status_code: response.status, final_url: sanitizeUrlForEvidence(finalUrl), content_type: contentType }, evidenceIds: ["EV-HTTP-MAIN"]
  }));

  if (html) {
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
    const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
    const formCount = countMatches(html, /<form\b[^>]*>/gi);
    const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    const missingAlt = imageTags.filter((tag) => !/\balt\s*=/i.test(tag)).length;
    const robots = findMetaContent(html, "robots");
    const canonical = findCanonical(html, finalUrl);
    observations.push(observation({
      id: "DOM-001", category: "frontend", title: "Statische HTML-basis", outcome: OUTCOME.OK,
      data: { title, h1_count: h1Count, form_count: formCount, image_count: imageTags.length, missing_alt_attribute_count: missingAlt }, evidenceIds: ["EV-HTTP-MAIN"]
    }));
    observations.push(observation({
      id: "SEO-001", category: "seo", title: "Statische robots/canonical-observatie", outcome: /noindex/i.test(robots) ? OUTCOME.INTERPRET : OUTCOME.OK,
      data: { robots: robots || null, canonical }, evidenceIds: ["EV-HTTP-MAIN"]
    }));
  }

  const robots = await collectRobots(finalUrl);
  observations.push(observation({
    id: "SEO-ROBOTS", category: "seo", title: "robots.txt-observatie", outcome: robots.status_code === 200 ? OUTCOME.OK : OUTCOME.INTERPRET,
    data: robots, evidenceIds: ["EV-HTTP-MAIN"]
  }));

  const browserEvidence = await runBrowserEvidence(finalUrl, { level: request.level });
  evidence.push(...browserEvidence.evidence_registry);
  observations.push(...browserObservations(browserEvidence, request.level));

  const renderedLinks = browserEvidence.runs.flatMap((run) => run.dom?.internal_links || []).filter(Boolean);
  const sampled = [...new Set(renderedLinks)].slice(0, request.level === "quick" ? 10 : 30).map((href) => absoluteUrl(href, finalUrl)).filter(Boolean);
  const linkResults = await mapWithConcurrency(sampled, 6, checkLink);
  observations.push(observation({
    id: "LINK-001",
    category: "links",
    title: "Begrensde interne linkproef uit gerenderde DOM",
    outcome: linkResults.some((item) => item.conclusive && !item.ok) ? OUTCOME.ISSUE : linkResults.some((item) => !item.conclusive) ? OUTCOME.INTERPRET : OUTCOME.OK,
    data: { basis: "rendered_dom", concurrency_limit: 6, sampled: linkResults.length, broken: linkResults.filter((item) => item.conclusive && !item.ok).slice(0, 20), inconclusive: linkResults.filter((item) => !item.conclusive).slice(0, 20) },
    evidenceIds: browserEvidence.evidence_registry.filter((item) => item.id.startsWith("EV-BROWSER-")).map((item) => item.id)
  }));

  return { evidence_registry: evidence, observations, browser_evidence: browserEvidence };
}
