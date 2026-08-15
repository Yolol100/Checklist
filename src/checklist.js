import { runBrowserEvidence } from "./browser.js";
import { assertPublicUrl, readTextLimited, safeFetch } from "./net.js";

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
  runtime: ["active/11-evidence-levels-runtime-matrix.md", "support/82-tool-en-browsermatrix.md"]
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
      try { return href ? new URL(href, base).href : null; } catch { return null; }
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
    let result = await safeFetch(url, { method: "HEAD", timeoutMs, headers: { "user-agent": "Webactueel-Checklist-QA/0.4 (+read-only evidence runner)" } });
    if (result.response.status === 405 || result.response.status === 403) {
      result = await safeFetch(url, { method: "GET", timeoutMs, headers: { "user-agent": "Webactueel-Checklist-QA/0.4 (+read-only evidence runner)" } });
    }
    return { url, final_url: result.finalUrl, status: result.response.status, ok: result.response.status < 400 };
  } catch (error) {
    return { url, status: null, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function collectRobots(finalUrl) {
  const robotsUrl = new URL("/robots.txt", finalUrl);
  try {
    const { response, finalUrl: observedUrl } = await safeFetch(robotsUrl, {
      method: "GET",
      timeoutMs: 8000,
      headers: { "user-agent": "Webactueel-Checklist-QA/0.4 (+read-only evidence runner)" }
    });
    const text = response.status === 200 ? await readTextLimited(response, 250_000) : "";
    return {
      url: observedUrl,
      status_code: response.status,
      sitemap_directives: text.split(/\r?\n/).filter((line) => /^\s*sitemap\s*:/i.test(line)).slice(0, 20),
      blocks_all: /user-agent\s*:\s*\*[\s\S]{0,500}?disallow\s*:\s*\/\s*(?:\r?\n|$)/i.test(text)
    };
  } catch (error) {
    return { url: robotsUrl.href, status_code: null, error: error instanceof Error ? error.message : String(error) };
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

  const totalViolations = successful.reduce((sum, run) => sum + (run.axe?.violation_count || 0), 0);
  const serious = successful.reduce((sum, run) => sum + (run.axe?.serious_or_critical_count || 0), 0);
  observations.push(observation({
    id: "A11Y-AUTO",
    category: "accessibility",
    title: "Geautomatiseerde axe-observatie",
    outcome: totalViolations === 0 ? OUTCOME.OK : OUTCOME.ISSUE,
    data: {
      violation_count: totalViolations,
      serious_or_critical_count: serious,
      by_viewport: successful.map((run) => ({ viewport: run.viewport, ...run.axe }))
    },
    evidenceIds: successful.flatMap((run) => evidenceFor(run.viewport, "axe")),
    note: "Automatische axe-resultaten zijn aanvullend bewijs en geen formele WCAG-conformiteitsclaim."
  }));

  const desktop = successful.find((run) => run.viewport === "desktop") || successful[0];
  observations.push(observation({
    id: "HTML-LANG",
    category: "accessibility",
    title: "HTML-taalattribuut geobserveerd",
    outcome: desktop.dom?.lang ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { lang: desktop.dom?.lang || null },
    evidenceIds: evidenceFor(desktop.viewport)
  }));

  observations.push(observation({
    id: "RESP-001",
    category: "frontend",
    title: "Viewport-meta geobserveerd",
    outcome: desktop.dom?.viewport_meta ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { viewport_meta: desktop.dom?.viewport_meta || null },
    evidenceIds: evidenceFor(desktop.viewport)
  }));

  const consoleCount = successful.reduce((sum, run) => sum + run.console_errors.length + run.page_errors.length, 0);
  observations.push(observation({
    id: "JS-001",
    category: "frontend",
    title: "Browserconsole- en page-errors in testload",
    outcome: consoleCount === 0 ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { by_viewport: successful.map((run) => ({ viewport: run.viewport, console_errors: run.console_errors, page_errors: run.page_errors })) },
    evidenceIds: successful.flatMap((run) => evidenceFor(run.viewport))
  }));

  const mixed = successful.flatMap((run) => run.mixed_content_requests || []);
  observations.push(observation({
    id: "TLS-MIXED-CONTENT",
    category: "security",
    title: "HTTP-subrequests op HTTPS-pagina",
    outcome: mixed.length === 0 ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { count: mixed.length, urls: [...new Set(mixed)].slice(0, 20) },
    evidenceIds: successful.flatMap((run) => evidenceFor(run.viewport))
  }));

  observations.push(observation({
    id: "PERF-LAB-OBS",
    category: "performance",
    title: "Synthetische browser-navigation timing",
    outcome: OUTCOME.OK,
    data: { by_viewport: successful.map((run) => ({ viewport: run.viewport, navigation_timing: run.dom?.navigation_timing || null })) },
    evidenceIds: successful.flatMap((run) => evidenceFor(run.viewport)),
    note: "Diagnostisch labbewijs; geen echte Core Web Vitals-velddata."
  }));

  const mobile = successful.find((run) => run.viewport === "mobile");
  observations.push(observation({
    id: "RUNTIME-MOBILE-EMU",
    category: "runtime",
    title: "Mobiele viewportemulatie uitgevoerd",
    outcome: level === "quick" ? OUTCOME.NA : mobile ? OUTCOME.OK : OUTCOME.NOT_EXECUTED,
    data: { viewport: mobile?.viewport_size || null, emulation: true },
    evidenceIds: mobile ? evidenceFor("mobile") : [],
    note: "Emulatie bewijst geen echte iPhone, Safari/iOS, touchhardware of mobiele browserchrome."
  }));

  return observations;
}

export async function runChecklist(rawUrl, level = "standard", artifactRoot = "artifacts/latest") {
  const startedAt = new Date().toISOString();
  const target = await assertPublicUrl(rawUrl, { allowQuery: false });
  const { response, finalUrl, redirectChain } = await safeFetch(target, {
    method: "GET",
    allowQuery: false,
    timeoutMs: 15_000,
    headers: { "user-agent": "Webactueel-Checklist-QA/0.4 (+read-only evidence runner)" }
  });

  const contentType = response.headers.get("content-type") || "";
  const html = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) ? await readTextLimited(response) : "";
  const observations = [];
  const headers = Object.fromEntries(response.headers.entries());

  observations.push(observation({
    id: "HTTP-001",
    category: "bereikbaarheid",
    title: "Publieke pagina bereikbaar",
    outcome: response.ok ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { requested_url: target.href, final_url: finalUrl, status_code: response.status, redirect_chain: redirectChain },
    evidenceIds: ["EV-HTTP-MAIN"]
  }));

  observations.push(observation({
    id: "HTTP-HTML",
    category: "bereikbaarheid",
    title: "Response is HTML",
    outcome: html ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { content_type: contentType || null },
    evidenceIds: ["EV-HTTP-MAIN"]
  }));

  observations.push(observation({
    id: "TLS-001",
    category: "security",
    title: "Eind-URL gebruikt HTTPS",
    outcome: finalUrl.startsWith("https://") ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { final_url: finalUrl },
    evidenceIds: ["EV-HTTP-MAIN"]
  }));

  const headerLabels = {
    "strict-transport-security": "HSTS",
    "content-security-policy": "Content-Security-Policy",
    "x-content-type-options": "X-Content-Type-Options",
    "referrer-policy": "Referrer-Policy",
    "permissions-policy": "Permissions-Policy"
  };
  for (const [key, label] of Object.entries(headerLabels)) {
    const value = headers[key];
    observations.push(observation({
      id: `HDR-${key.toUpperCase().replace(/[^A-Z0-9]/g, "-")}`,
      category: "security",
      title: `${label} aanwezigheid`,
      outcome: value ? OUTCOME.OK : OUTCOME.ISSUE,
      data: { header: key, value: value || null },
      evidenceIds: ["EV-HTTP-MAIN"],
      note: "De runner observeert alleen aanwezigheid; de Skill/bronnen beoordelen vereiste beleidswaarde en ernst."
    }));
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
  observations.push(observation({
    id: "SEO-001",
    category: "seo",
    title: "HTML-title aanwezigheid",
    outcome: title ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { title: title || null, length: title.length },
    evidenceIds: ["EV-HTTP-MAIN"]
  }));

  const description = findMetaContent(html, "description");
  observations.push(observation({
    id: "SEO-002",
    category: "seo",
    title: "Meta description aanwezigheid",
    outcome: description ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { description: description || null, length: description.length },
    evidenceIds: ["EV-HTTP-MAIN"]
  }));

  const robotsMeta = findMetaContent(html, "robots");
  const noindex = /(?:^|[,\s])noindex(?:[,\s]|$)/i.test(robotsMeta);
  observations.push(observation({
    id: "SEO-INDEX-001",
    category: "seo",
    title: "Meta robots/noindex observatie",
    outcome: noindex ? OUTCOME.INTERPRET : OUTCOME.OK,
    data: { robots_meta: robotsMeta || null, noindex },
    evidenceIds: ["EV-HTTP-MAIN"]
  }));

  const canonical = findCanonical(html, finalUrl);
  observations.push(observation({
    id: "SEO-CANONICAL",
    category: "seo",
    title: "Canonical-link observatie",
    outcome: canonical ? OUTCOME.OK : OUTCOME.INTERPRET,
    data: { canonical },
    evidenceIds: ["EV-HTTP-MAIN"],
    note: "Afwezigheid is niet automatisch een fout; de SEO-bron bepaalt de verwachting voor deze URL."
  }));

  const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
  observations.push(observation({
    id: "HTML-001",
    category: "frontend",
    title: "H1-aanwezigheid",
    outcome: h1Count >= 1 ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { h1_count: h1Count },
    evidenceIds: ["EV-HTTP-MAIN"]
  }));

  const imageCount = countMatches(html, /<img\b[^>]*>/gi);
  const missingAltCount = [...html.matchAll(/<img\b([^>]*)>/gi)].filter((match) => !/\balt\s*=/.test(match[1])).length;
  observations.push(observation({
    id: "A11Y-001",
    category: "accessibility",
    title: "Afbeeldingen met alt-attribuut",
    outcome: missingAltCount === 0 ? OUTCOME.OK : OUTCOME.ISSUE,
    data: { image_count: imageCount, missing_alt_attribute_count: missingAltCount },
    evidenceIds: ["EV-HTTP-MAIN"],
    note: "Aanwezigheid zegt niets over de inhoudelijke juistheid van alt-tekst."
  }));

  const forms = countMatches(html, /<form\b[^>]*>/gi);
  observations.push(observation({
    id: "FORM-001",
    category: "forms",
    title: "Formulierflow functioneel uitgevoerd",
    outcome: forms > 0 ? OUTCOME.NOT_EXECUTED : OUTCOME.NA,
    data: { form_count: forms, submitted: false },
    evidenceIds: ["EV-HTTP-MAIN"],
    note: "De runner verstuurt nooit formulieren."
  }));

  let linkResults = [];
  let robots = null;
  if (level !== "quick") {
    const baseHost = new URL(finalUrl).hostname;
    const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)]
      .map((match) => absoluteUrl(match[1], finalUrl))
      .filter((url) => url && new URL(url).hostname === baseHost);
    const uniqueLinks = [...new Set(hrefs)].slice(0, level === "full" ? 60 : 20);
    linkResults = await Promise.all(uniqueLinks.map((url) => checkLink(url)));
    const broken = linkResults.filter((item) => !item.ok);

    observations.push(observation({
      id: "LINK-001",
      category: "links",
      title: "Interne linksteekproef",
      outcome: broken.length === 0 ? OUTCOME.OK : OUTCOME.ISSUE,
      data: { tested_count: linkResults.length, broken_count: broken.length, broken: broken.slice(0, 20) },
      evidenceIds: ["EV-LINK-SAMPLE"]
    }));

    robots = await collectRobots(finalUrl);
    observations.push(observation({
      id: "SEO-ROBOTS",
      category: "seo",
      title: "robots.txt observatie",
      outcome: robots.blocks_all || !robots.status_code || robots.status_code >= 500 ? OUTCOME.INTERPRET : OUTCOME.OK,
      data: robots,
      evidenceIds: ["EV-ROBOTS"]
    }));
  }

  let browserEvidence;
  try {
    browserEvidence = await runBrowserEvidence(finalUrl, level, artifactRoot);
    observations.push(...browserObservations(browserEvidence, level));
  } catch (error) {
    browserEvidence = { error: error instanceof Error ? error.message : String(error), runs: [] };
    observations.push(observation({
      id: "RUNTIME-BROWSER",
      category: "runtime",
      title: "Chromium browserharness uitgevoerd",
      outcome: OUTCOME.NOT_EXECUTED,
      data: browserEvidence
    }));
  }

  observations.push(observation({
    id: "A11Y-MANUAL",
    category: "accessibility",
    title: "Keyboard, zoom en screenreader",
    outcome: OUTCOME.NOT_EXECUTED,
    data: { automated_runner_can_prove: false },
    note: "Vereist aparte echte browser/input/AT-evidence wanneer de QA-bronnen dit voor de scope verplicht stellen."
  }));

  observations.push(observation({
    id: "RUNTIME-REAL-DEVICE",
    category: "runtime",
    title: "Echt mobiel apparaat / echte Safari-iOS",
    outcome: OUTCOME.NOT_EXECUTED,
    data: { automated_runner_can_prove: false }
  }));

  if (level === "full") {
    observations.push(observation({
      id: "RUNTIME-CROSS-BROWSER",
      category: "runtime",
      title: "Firefox en WebKit/Safari-afdekking",
      outcome: OUTCOME.NOT_EXECUTED,
      data: { chromium: true, firefox: false, webkit: false }
    }));
  }

  return {
    runner: "webactueel-checklist-qa",
    runner_version: "0.4.0",
    contract: "raw-evidence-v1",
    level,
    target: target.href,
    final_url: finalUrl,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    mutation_performed: false,
    runtime_observation: {
      host: "github-actions",
      public_read_only: true,
      network_target: "public-production-url",
      browser_harness: Boolean(browserEvidence?.tool_versions),
      browser_evidence: browserEvidence?.tool_versions || null,
      browser_configuration: browserEvidence?.browser_configuration || null
    },
    network_evidence: {
      main_response: { status_code: response.status, content_type: contentType || null, headers, redirect_chain: redirectChain },
      link_sample: linkResults,
      robots
    },
    browser_evidence: browserEvidence,
    observations,
    limitations: [
      "Publieke read-only observatie; geen ingelogde flow of productie-mutatie.",
      "Geen formele WCAG-conformiteitsclaim.",
      "Axe automatiseert slechts een deel van toegankelijkheid; keyboard, zoom en screenreader zijn aparte tests.",
      "Mobiele Chromium-emulatie is geen echt-device- of echte Safari/iOS-evidence.",
      "Geen formulierinzendingen, betalingen, orders of andere writes.",
      "Synthetische browser-timing vervangt geen echte Core Web Vitals-velddata.",
      "De runner kent geen QA-prioriteit of releasebesluit toe; de Website QA Skill en actieve Drive-bronnen doen dat."
    ]
  };
}
