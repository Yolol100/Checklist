import { runBrowserEvidence } from "./browser.js";
import { assertPublicUrl, readTextLimited, safeFetch } from "./net.js";

const STATUS = {
  PASS: "Geslaagd",
  FAIL: "Mislukt",
  BLOCKED: "Geblokkeerd",
  TODO: "Te controleren",
  NA: "Niet van toepassing"
};

const PRIORITY = {
  CRITICAL: "Kritiek",
  HIGH: "Hoog",
  MEDIUM: "Midden",
  LOW: "Laag"
};

const SOURCE_REFS = {
  bereikbaarheid: ["01-qa-proces-en-severity.md", "11-evidence-levels-runtime-matrix.md"],
  security: ["08-security-en-technische-risicos.md"],
  seo: ["04-seo-indexatie-en-migratie.md"],
  frontend: ["02-frontend-responsive-accessibility.md"],
  accessibility: ["02-frontend-responsive-accessibility.md", "88-playwright-axe-adapter.md"],
  forms: ["03-formulieren-email-en-crm.md"],
  links: ["04-seo-indexatie-en-migratie.md"],
  performance: ["06-wordpress-elementor-en-performance.md", "82-tool-en-browsermatrix.md"],
  runtime: ["11-evidence-levels-runtime-matrix.md", "82-tool-en-browsermatrix.md"]
};

const REQUIRED_SECURITY_HEADERS = [
  ["strict-transport-security", "HSTS", PRIORITY.HIGH],
  ["content-security-policy", "Content-Security-Policy", PRIORITY.MEDIUM],
  ["x-content-type-options", "X-Content-Type-Options", PRIORITY.MEDIUM],
  ["referrer-policy", "Referrer-Policy", PRIORITY.MEDIUM],
  ["permissions-policy", "Permissions-Policy", PRIORITY.LOW]
];

function finding({ id, category, title, status, priority, evidence, recommendation, confidence = "Bevestigd", sourceRefs }) {
  return {
    id,
    category,
    title,
    status,
    priority,
    confidence,
    source_refs: sourceRefs || SOURCE_REFS[category] || [],
    evidence,
    recommendation
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
    let result = await safeFetch(url, { method: "HEAD", timeoutMs, headers: { "user-agent": "Webactueel-Checklist-QA/0.3 (+read-only public QA)" } });
    if (result.response.status === 405 || result.response.status === 403) {
      result = await safeFetch(url, { method: "GET", timeoutMs, headers: { "user-agent": "Webactueel-Checklist-QA/0.3 (+read-only public QA)" } });
    }
    return { url, final_url: result.finalUrl, status: result.response.status, ok: result.response.status < 400 };
  } catch (error) {
    return { url, status: null, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function releaseDecision(findings) {
  const criticalFail = findings.some((item) => item.status === STATUS.FAIL && item.priority === PRIORITY.CRITICAL);
  const highFail = findings.some((item) => item.status === STATUS.FAIL && item.priority === PRIORITY.HIGH);
  const blocked = findings.some((item) => item.status === STATUS.BLOCKED || item.status === STATUS.TODO);
  if (criticalFail) return "No-go";
  if (highFail) return "Go na fixes";
  if (blocked) return "Conditional GO";
  return "Source GO";
}

async function collectRobots(finalUrl) {
  const robotsUrl = new URL("/robots.txt", finalUrl);
  try {
    const { response, finalUrl: observedUrl } = await safeFetch(robotsUrl, {
      method: "GET",
      timeoutMs: 8000,
      headers: { "user-agent": "Webactueel-Checklist-QA/0.3 (+read-only public QA)" }
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

function addBrowserFindings(findings, browserEvidence, level) {
  const successful = browserEvidence.runs.filter((run) => !run.browser_error);
  if (!successful.length) {
    findings.push(finding({
      id: "RUNTIME-BROWSER",
      category: "runtime",
      title: "Browserharness uitgevoerd",
      status: STATUS.BLOCKED,
      priority: PRIORITY.HIGH,
      confidence: "Handmatig testen nodig",
      evidence: { errors: browserEvidence.runs.map((run) => run.browser_error).filter(Boolean) },
      recommendation: "Herstel de Playwright-runtime en voer dezelfde browsercheck opnieuw uit."
    }));
    return;
  }

  findings.push(finding({
    id: "RUNTIME-BROWSER",
    category: "runtime",
    title: "Chromium browserharness uitgevoerd",
    status: STATUS.PASS,
    priority: PRIORITY.LOW,
    evidence: { browser: browserEvidence.browser, tool_versions: browserEvidence.tool_versions, viewports: successful.map((run) => run.viewport) },
    recommendation: "Gebruik deze evidence als browserharness-bewijs; niet als bewijs voor echte Safari/iOS of assistive technology."
  }));

  const totalViolations = successful.reduce((sum, run) => sum + (run.axe?.violation_count || 0), 0);
  const serious = successful.reduce((sum, run) => sum + (run.axe?.serious_or_critical_count || 0), 0);
  findings.push(finding({
    id: "A11Y-AUTO",
    category: "accessibility",
    title: "Geautomatiseerde axe-controle",
    status: totalViolations === 0 ? STATUS.PASS : STATUS.FAIL,
    priority: serious > 0 ? PRIORITY.HIGH : totalViolations > 0 ? PRIORITY.MEDIUM : PRIORITY.LOW,
    evidence: {
      violation_count: totalViolations,
      serious_or_critical_count: serious,
      by_viewport: successful.map((run) => ({ viewport: run.viewport, ...run.axe }))
    },
    recommendation: totalViolations === 0 ? "Geen axe-overtreding gevonden; voer de verplichte handmatige toegankelijkheidstests nog steeds uit." : "Laat de accessibility/frontend-eigenaar de bevestigde axe-bevindingen beoordelen en hertest daarna."
  }));

  const desktop = successful.find((run) => run.viewport === "desktop") || successful[0];
  findings.push(finding({
    id: "HTML-LANG",
    category: "accessibility",
    title: "HTML-taal is ingesteld",
    status: desktop.dom?.lang ? STATUS.PASS : STATUS.FAIL,
    priority: desktop.dom?.lang ? PRIORITY.LOW : PRIORITY.MEDIUM,
    evidence: { lang: desktop.dom?.lang || null },
    recommendation: desktop.dom?.lang ? "Controleer of de taalwaarde inhoudelijk klopt." : "Stel een correcte lang-waarde in op het html-element."
  }));

  findings.push(finding({
    id: "RESP-001",
    category: "frontend",
    title: "Viewport-meta aanwezig",
    status: desktop.dom?.viewport_meta ? STATUS.PASS : STATUS.FAIL,
    priority: desktop.dom?.viewport_meta ? PRIORITY.LOW : PRIORITY.MEDIUM,
    evidence: { viewport_meta: desktop.dom?.viewport_meta || null },
    recommendation: desktop.dom?.viewport_meta ? "Geen actie voor aanwezigheid; beoordeel responsive gedrag apart." : "Voeg een correcte viewport-meta toe en hertest mobiel."
  }));

  const consoleCount = successful.reduce((sum, run) => sum + run.console_errors.length + run.page_errors.length, 0);
  findings.push(finding({
    id: "JS-001",
    category: "frontend",
    title: "Geen browserconsole- of page-errors in de testload",
    status: consoleCount === 0 ? STATUS.PASS : STATUS.FAIL,
    priority: consoleCount === 0 ? PRIORITY.LOW : PRIORITY.MEDIUM,
    evidence: { by_viewport: successful.map((run) => ({ viewport: run.viewport, console_errors: run.console_errors, page_errors: run.page_errors })) },
    recommendation: consoleCount === 0 ? "Geen actie voor deze run." : "Onderzoek de console/page-errors en hertest dezelfde viewports."
  }));

  const mixed = successful.flatMap((run) => run.mixed_content_requests || []);
  findings.push(finding({
    id: "TLS-MIXED-CONTENT",
    category: "security",
    title: "Geen onversleutelde HTTP-subrequests op HTTPS-pagina",
    status: mixed.length === 0 ? STATUS.PASS : STATUS.FAIL,
    priority: mixed.length === 0 ? PRIORITY.LOW : PRIORITY.HIGH,
    evidence: { count: mixed.length, urls: [...new Set(mixed)].slice(0, 20) },
    recommendation: mixed.length === 0 ? "Geen actie voor deze browserrun." : "Vervang onveilige subresources door HTTPS en hertest."
  }));

  findings.push(finding({
    id: "PERF-LAB-OBS",
    category: "performance",
    title: "Browserlab-timing verzameld",
    status: STATUS.PASS,
    priority: PRIORITY.LOW,
    evidence: { by_viewport: successful.map((run) => ({ viewport: run.viewport, navigation_timing: run.dom?.navigation_timing || null })) },
    recommendation: "Gebruik deze timings alleen diagnostisch; beoordeel echte Core Web Vitals met geschikte velddata wanneer vereist."
  }));

  const mobile = successful.find((run) => run.viewport === "mobile");
  findings.push(finding({
    id: "RUNTIME-MOBILE-EMU",
    category: "runtime",
    title: "Mobiele browseremulatie uitgevoerd",
    status: level === "quick" ? STATUS.NA : mobile ? STATUS.PASS : STATUS.BLOCKED,
    priority: mobile ? PRIORITY.LOW : PRIORITY.MEDIUM,
    confidence: mobile ? "Bevestigd" : level === "quick" ? "Bevestigd" : "Handmatig testen nodig",
    evidence: { viewport: mobile?.viewport_size || null, emulation: true },
    recommendation: level === "quick" ? "Niet opgenomen in quick." : mobile ? "Gebruik dit voor layout/clientgedrag, niet als echt-devicebewijs." : "Herstel de mobiele browserrun of test handmatig."
  }));
}

export async function runChecklist(rawUrl, level = "standard") {
  const startedAt = new Date().toISOString();
  const target = await assertPublicUrl(rawUrl, { allowQuery: false });
  const { response, finalUrl, redirectChain } = await safeFetch(target, {
    method: "GET",
    allowQuery: false,
    timeoutMs: 15_000,
    headers: { "user-agent": "Webactueel-Checklist-QA/0.3 (+read-only public QA)" }
  });

  const contentType = response.headers.get("content-type") || "";
  const html = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) ? await readTextLimited(response) : "";
  const findings = [];
  const headers = Object.fromEntries(response.headers.entries());

  findings.push(finding({
    id: "HTTP-001",
    category: "bereikbaarheid",
    title: "Publieke pagina is bereikbaar",
    status: response.ok ? STATUS.PASS : STATUS.FAIL,
    priority: response.status >= 500 ? PRIORITY.CRITICAL : PRIORITY.HIGH,
    evidence: { requested_url: target.href, final_url: finalUrl, status_code: response.status, redirect_chain: redirectChain },
    recommendation: response.ok ? "Geen actie." : "Herstel de HTTP-fout en hertest dezelfde URL."
  }));

  findings.push(finding({
    id: "HTTP-HTML",
    category: "bereikbaarheid",
    title: "Response is HTML",
    status: html ? STATUS.PASS : STATUS.FAIL,
    priority: html ? PRIORITY.LOW : PRIORITY.HIGH,
    evidence: { content_type: contentType || null },
    recommendation: html ? "Geen actie." : "Controleer of de aangeleverde URL een webpagina is en geen bestand/API-response."
  }));

  findings.push(finding({
    id: "TLS-001",
    category: "security",
    title: "Eind-URL gebruikt HTTPS",
    status: finalUrl.startsWith("https://") ? STATUS.PASS : STATUS.FAIL,
    priority: PRIORITY.HIGH,
    evidence: { final_url: finalUrl },
    recommendation: finalUrl.startsWith("https://") ? "Geen actie." : "Forceer HTTPS en controleer redirects en mixed content."
  }));

  for (const [key, label, priority] of REQUIRED_SECURITY_HEADERS) {
    const value = headers[key];
    findings.push(finding({
      id: `HDR-${key.toUpperCase().replace(/[^A-Z0-9]/g, "-")}`,
      category: "security",
      title: `${label} aanwezig`,
      status: value ? STATUS.PASS : STATUS.FAIL,
      priority,
      evidence: { header: key, value: value || null },
      recommendation: value ? "Geen actie voor aanwezigheid; beoordeel de beleidswaarde inhoudelijk." : `Beoordeel en configureer ${label} passend voor de site.`
    }));
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
  findings.push(finding({
    id: "SEO-001",
    category: "seo",
    title: "HTML-title aanwezig",
    status: title ? STATUS.PASS : STATUS.FAIL,
    priority: PRIORITY.HIGH,
    evidence: { title: title || null, length: title.length },
    recommendation: title ? "Controleer inhoud en zoekintentie in de SEO-skill." : "Voeg een unieke, beschrijvende title toe."
  }));

  const description = findMetaContent(html, "description");
  findings.push(finding({
    id: "SEO-002",
    category: "seo",
    title: "Meta description aanwezig",
    status: description ? STATUS.PASS : STATUS.FAIL,
    priority: PRIORITY.MEDIUM,
    evidence: { description: description || null, length: description.length },
    recommendation: description ? "Beoordeel kwaliteit in de SEO-skill." : "Voeg een relevante meta description toe."
  }));

  const robotsMeta = findMetaContent(html, "robots");
  const noindex = /(?:^|[,\s])noindex(?:[,\s]|$)/i.test(robotsMeta);
  findings.push(finding({
    id: "SEO-INDEX-001",
    category: "seo",
    title: "Geen expliciete meta noindex gevonden",
    status: noindex ? STATUS.TODO : STATUS.PASS,
    priority: noindex ? PRIORITY.HIGH : PRIORITY.LOW,
    confidence: noindex ? "Handmatig testen nodig" : "Bevestigd",
    evidence: { robots_meta: robotsMeta || null, noindex },
    recommendation: noindex ? "Bevestig of noindex bedoeld is voor deze URL en omgeving voordat je een releaseclaim doet." : "Controleer indexeerbaarheid verder via robots, headers en Search Console wanneer relevant."
  }));

  const canonical = findCanonical(html, finalUrl);
  findings.push(finding({
    id: "SEO-CANONICAL",
    category: "seo",
    title: "Canonical-link aanwezig",
    status: canonical ? STATUS.PASS : STATUS.TODO,
    priority: canonical ? PRIORITY.LOW : PRIORITY.MEDIUM,
    confidence: canonical ? "Bevestigd" : "Handmatig testen nodig",
    evidence: { canonical },
    recommendation: canonical ? "Beoordeel of de canonical naar de bedoelde voorkeurs-URL wijst." : "Beoordeel of deze pagina een canonical-link nodig heeft."
  }));

  const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
  findings.push(finding({
    id: "HTML-001",
    category: "frontend",
    title: "Pagina bevat een H1",
    status: h1Count >= 1 ? STATUS.PASS : STATUS.FAIL,
    priority: PRIORITY.MEDIUM,
    evidence: { h1_count: h1Count },
    recommendation: h1Count >= 1 ? "Controleer semantiek en inhoud handmatig." : "Voeg een betekenisvolle H1 toe."
  }));

  const imageCount = countMatches(html, /<img\b[^>]*>/gi);
  const missingAltCount = [...html.matchAll(/<img\b([^>]*)>/gi)].filter((match) => !/\balt\s*=/.test(match[1])).length;
  findings.push(finding({
    id: "A11Y-001",
    category: "accessibility",
    title: "Afbeeldingen hebben een alt-attribuut",
    status: missingAltCount === 0 ? STATUS.PASS : STATUS.FAIL,
    priority: missingAltCount > 0 ? PRIORITY.HIGH : PRIORITY.LOW,
    evidence: { image_count: imageCount, missing_alt_attribute_count: missingAltCount },
    recommendation: missingAltCount === 0 ? "Beoordeel de alt-teksten inhoudelijk; lege alt kan correct zijn." : "Voeg per afbeelding een passend alt-attribuut toe en hertest."
  }));

  const forms = countMatches(html, /<form\b[^>]*>/gi);
  findings.push(finding({
    id: "FORM-001",
    category: "forms",
    title: "Formulieren functioneel getest",
    status: forms > 0 ? STATUS.TODO : STATUS.NA,
    priority: forms > 0 ? PRIORITY.HIGH : PRIORITY.LOW,
    confidence: forms > 0 ? "Handmatig testen nodig" : "Bevestigd",
    evidence: { form_count: forms, submitted: false },
    recommendation: forms > 0 ? "Test goed pad, foutpad, validatie, ontvangst en privacy in een veilige runtime. Deze runner verstuurt niets." : "Geen formulier op deze pagina gevonden."
  }));

  if (level !== "quick") {
    const baseHost = new URL(finalUrl).hostname;
    const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)]
      .map((match) => absoluteUrl(match[1], finalUrl))
      .filter((url) => url && new URL(url).hostname === baseHost);
    const uniqueLinks = [...new Set(hrefs)].slice(0, level === "full" ? 60 : 20);
    const linkResults = await Promise.all(uniqueLinks.map((url) => checkLink(url)));
    const broken = linkResults.filter((item) => !item.ok);

    findings.push(finding({
      id: "LINK-001",
      category: "links",
      title: "Interne linksteekproef geeft geen HTTP-fout",
      status: broken.length === 0 ? STATUS.PASS : STATUS.FAIL,
      priority: broken.length > 0 ? PRIORITY.MEDIUM : PRIORITY.LOW,
      evidence: { tested_count: linkResults.length, broken_count: broken.length, broken: broken.slice(0, 20) },
      recommendation: broken.length === 0 ? "Vergroot de crawl wanneer de scope een volledige site-audit vereist." : "Herstel of verwijder gebroken links en hertest."
    }));

    const robots = await collectRobots(finalUrl);
    findings.push(finding({
      id: "SEO-ROBOTS",
      category: "seo",
      title: "robots.txt geobserveerd",
      status: robots.status_code && robots.status_code < 500 ? STATUS.PASS : STATUS.TODO,
      priority: robots.blocks_all ? PRIORITY.HIGH : PRIORITY.LOW,
      confidence: robots.blocks_all ? "Handmatig testen nodig" : "Bevestigd",
      evidence: robots,
      recommendation: robots.blocks_all ? "Bevestig of de algemene blokkade bedoeld is voor deze omgeving." : "Gebruik dit als observatie; 404 is niet automatisch een SEO-fout."
    }));
  }

  let browserEvidence;
  try {
    browserEvidence = await runBrowserEvidence(finalUrl, level);
    addBrowserFindings(findings, browserEvidence, level);
  } catch (error) {
    browserEvidence = { error: error instanceof Error ? error.message : String(error) };
    findings.push(finding({
      id: "RUNTIME-BROWSER",
      category: "runtime",
      title: "Browserharness uitgevoerd",
      status: STATUS.BLOCKED,
      priority: PRIORITY.HIGH,
      confidence: "Handmatig testen nodig",
      evidence: browserEvidence,
      recommendation: "Herstel Playwright/Chromium en hertest."
    }));
  }

  findings.push(finding({
    id: "A11Y-MANUAL",
    category: "accessibility",
    title: "Keyboard, zoom en screenreader getest",
    status: STATUS.BLOCKED,
    priority: PRIORITY.HIGH,
    confidence: "Handmatig testen nodig",
    evidence: { automated_runner_can_prove: false },
    recommendation: "Voer keyboard-, zoom- en passende screenreadertests uit op een echte browser/AT-combinatie."
  }));

  findings.push(finding({
    id: "RUNTIME-REAL-DEVICE",
    category: "runtime",
    title: "Echt mobiel apparaat / echte Safari-iOS gecontroleerd",
    status: STATUS.BLOCKED,
    priority: PRIORITY.MEDIUM,
    confidence: "Handmatig testen nodig",
    evidence: { automated_runner_can_prove: false },
    recommendation: "Gebruik echt apparaatbewijs wanneer dit voor de wijziging of releaseclaim vereist is."
  }));

  if (level === "full") {
    findings.push(finding({
      id: "RUNTIME-CROSS-BROWSER",
      category: "runtime",
      title: "Firefox en WebKit/Safari-afdekking gecontroleerd",
      status: STATUS.BLOCKED,
      priority: PRIORITY.MEDIUM,
      confidence: "Handmatig testen nodig",
      evidence: { chromium: true, firefox: false, webkit: false },
      recommendation: "Voeg Firefox/WebKit toe of lever passend echt-browserbewijs voor een volledige browsermatrix."
    }));
  }

  const decision = releaseDecision(findings);
  const summary = {
    passed: findings.filter((item) => item.status === STATUS.PASS).length,
    failed: findings.filter((item) => item.status === STATUS.FAIL).length,
    blocked: findings.filter((item) => item.status === STATUS.BLOCKED).length,
    to_check: findings.filter((item) => item.status === STATUS.TODO).length,
    not_applicable: findings.filter((item) => item.status === STATUS.NA).length
  };

  return {
    schema_version: "0.2",
    runner: "webactueel-checklist-qa",
    runner_version: "0.3.0",
    level,
    target: target.href,
    final_url: finalUrl,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    evidence_level: "production_observation",
    runtime: {
      host: "github-actions",
      public_read_only: true,
      browser_evidence: browserEvidence?.tool_versions || null
    },
    mutation_performed: false,
    decision,
    decision_scope: "Runneradvies op uitgevoerde evidence; de website-qa-checklist Skill en actieve Drive-bronnen bepalen de uiteindelijke QA/releaseclaim.",
    summary,
    findings,
    limitations: [
      "Dit is publieke read-only observatie; geen ingelogde flow of productie-mutatie.",
      "Geen formele WCAG-conformiteitsclaim.",
      "Axe automatiseert slechts een deel van toegankelijkheid; keyboard, zoom en screenreader blijven aparte tests.",
      "Mobiele Playwright-emulatie is geen echt-device- of echte Safari/iOS-evidence.",
      "Geen formulierinzendingen, betalingen, orders of andere writes.",
      "Browserlab-timing is diagnostisch en vervangt geen echte Core Web Vitals-velddata."
    ]
  };
}

export { STATUS, PRIORITY };
