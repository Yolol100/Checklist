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

const REQUIRED_SECURITY_HEADERS = [
  ["strict-transport-security", "HSTS"],
  ["content-security-policy", "Content-Security-Policy"],
  ["x-content-type-options", "X-Content-Type-Options"],
  ["referrer-policy", "Referrer-Policy"]
];

function finding({ id, category, title, status, priority, evidence, recommendation, confidence = "Bevestigd" }) {
  return { id, category, title, status, priority, confidence, evidence, recommendation };
}

function textMatch(html, regex) {
  const match = html.match(regex);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function countMatches(html, regex) {
  return [...html.matchAll(regex)].length;
}

function absoluteUrl(href, base) {
  try {
    const url = new URL(href, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function checkLink(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { url, status: response.status, ok: response.status < 400 };
  } catch (error) {
    return { url, status: null, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function releaseDecision(findings) {
  const criticalFail = findings.some((f) => f.status === STATUS.FAIL && f.priority === PRIORITY.CRITICAL);
  const highFail = findings.some((f) => f.status === STATUS.FAIL && f.priority === PRIORITY.HIGH);
  const blocked = findings.some((f) => f.status === STATUS.BLOCKED || f.status === STATUS.TODO);

  if (criticalFail) return "No-go";
  if (highFail) return "Go na fixes";
  if (blocked) return "Conditional GO";
  return "Source GO";
}

export async function runChecklist(rawUrl, level = "standard") {
  const startedAt = new Date().toISOString();
  const target = new URL(rawUrl);
  if (!/^https?:$/.test(target.protocol)) throw new Error("Alleen http- en https-URL's zijn toegestaan.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  let html = "";

  try {
    response = await fetch(target.href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Webactueel-Checklist-QA/0.1 (+read-only public QA)" }
    });
    html = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const findings = [];
  const finalUrl = response.url || target.href;
  const headers = Object.fromEntries(response.headers.entries());

  findings.push(finding({
    id: "HTTP-001",
    category: "bereikbaarheid",
    title: "Publieke pagina is bereikbaar",
    status: response.ok ? STATUS.PASS : STATUS.FAIL,
    priority: response.status >= 500 ? PRIORITY.CRITICAL : PRIORITY.HIGH,
    evidence: { requested_url: target.href, final_url: finalUrl, status_code: response.status },
    recommendation: response.ok ? "Geen actie." : "Herstel de HTTP-fout en hertest dezelfde URL."
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

  for (const [key, label] of REQUIRED_SECURITY_HEADERS) {
    const value = headers[key];
    findings.push(finding({
      id: `HDR-${key.toUpperCase().replace(/[^A-Z0-9]/g, "-")}`,
      category: "security",
      title: `${label} aanwezig`,
      status: value ? STATUS.PASS : STATUS.FAIL,
      priority: key === "strict-transport-security" ? PRIORITY.HIGH : PRIORITY.MEDIUM,
      evidence: { header: key, value: value || null },
      recommendation: value ? "Geen actie." : `Beoordeel en configureer ${label} passend voor de site.`
    }));
  }

  const title = textMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  findings.push(finding({
    id: "SEO-001",
    category: "seo",
    title: "HTML-title aanwezig",
    status: title ? STATUS.PASS : STATUS.FAIL,
    priority: PRIORITY.HIGH,
    evidence: { title: title || null, length: title.length },
    recommendation: title ? "Controleer inhoud en zoekintentie in de SEO-skill." : "Voeg een unieke, beschrijvende title toe."
  }));

  const description = textMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) ||
    textMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  findings.push(finding({
    id: "SEO-002",
    category: "seo",
    title: "Meta description aanwezig",
    status: description ? STATUS.PASS : STATUS.FAIL,
    priority: PRIORITY.MEDIUM,
    evidence: { description: description || null, length: description.length },
    recommendation: description ? "Beoordeel kwaliteit in de SEO-skill." : "Voeg een relevante meta description toe."
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
  const missingAltCount = [...html.matchAll(/<img\b([^>]*)>/gi)].filter((m) => !/\balt\s*=/.test(m[1])).length;
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
    const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)]
      .map((m) => absoluteUrl(m[1], finalUrl))
      .filter(Boolean);
    const uniqueLinks = [...new Set(hrefs)].slice(0, level === "full" ? 40 : 15);
    const linkResults = await Promise.all(uniqueLinks.map((url) => checkLink(url)));
    const broken = linkResults.filter((item) => !item.ok);

    findings.push(finding({
      id: "LINK-001",
      category: "links",
      title: "Steekproef van links geeft geen HTTP-fout",
      status: broken.length === 0 ? STATUS.PASS : STATUS.FAIL,
      priority: broken.length > 0 ? PRIORITY.MEDIUM : PRIORITY.LOW,
      evidence: { tested_count: linkResults.length, broken_count: broken.length, broken: broken.slice(0, 10) },
      recommendation: broken.length === 0 ? "Vergroot de crawl bij een volledige audit." : "Herstel of verwijder gebroken links en hertest."
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

  const decision = releaseDecision(findings);
  const summary = {
    passed: findings.filter((f) => f.status === STATUS.PASS).length,
    failed: findings.filter((f) => f.status === STATUS.FAIL).length,
    blocked: findings.filter((f) => f.status === STATUS.BLOCKED).length,
    to_check: findings.filter((f) => f.status === STATUS.TODO).length,
    not_applicable: findings.filter((f) => f.status === STATUS.NA).length
  };

  return {
    schema_version: "0.1",
    runner: "webactueel-checklist-qa",
    runner_version: "0.1.0",
    level,
    target: target.href,
    final_url: finalUrl,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    evidence_level: "production_observation",
    mutation_performed: false,
    decision,
    summary,
    findings,
    limitations: [
      "Dit is publieke read-only observatie; geen ingelogde flow of productie-mutatie.",
      "Geen formele WCAG-conformiteitsclaim.",
      "Geen echte device- of assistive-technology-evidence.",
      "Geen formulierinzendingen, betalingen, orders of andere writes."
    ]
  };
}

export { STATUS, PRIORITY };
