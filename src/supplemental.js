import fs from "node:fs/promises";
import { firefox, webkit } from "playwright";
import { assertPublicUrl, readTextLimited, safeFetch } from "./net.js";
import { sanitizeEvidenceText, sanitizeUrlForEvidence } from "./privacy.js";
import { startPublicNetworkProxy } from "./public-proxy.js";
import { assertRequestContract } from "./contracts.js";

const requestPath = process.argv[2];
if (!requestPath) throw new Error("request path ontbreekt");
const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
assertRequestContract(request);
const target = await assertPublicUrl(request.url, { allowQuery: false });

async function installGuard(context) {
  const blockedWrites = [];
  await context.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    let url;
    try { url = new URL(req.url()); } catch { await route.abort("blockedbyclient"); return; }
    if (["data:", "blob:", "about:"].includes(url.protocol)) { await route.continue(); return; }
    if (!["http:", "https:"].includes(url.protocol)) { await route.abort("blockedbyclient"); return; }
    if (!["GET", "HEAD"].includes(method)) {
      blockedWrites.push({ method, url: sanitizeUrlForEvidence(url) });
      await route.abort("blockedbyclient");
      return;
    }
    try {
      await assertPublicUrl(url, { allowQuery: !req.isNavigationRequest() });
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  return blockedWrites;
}

async function runBrowser(name, browserType, proxyUrl) {
  let browser;
  try {
    browser = await browserType.launch({ headless: true, proxy: { server: proxyUrl } });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: "nl-NL",
      timezoneId: "Europe/Amsterdam",
      reducedMotion: "reduce",
      serviceWorkers: "block"
    });
    const blockedWrites = await installGuard(context);
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(sanitizeEvidenceText(message.text())); });
    page.on("pageerror", (error) => pageErrors.push(sanitizeEvidenceText(error.message)));
    const response = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.locator("body").waitFor({ state: "visible", timeout: 8_000 });
    const dom = await page.evaluate(() => ({
      title: document.title || null,
      lang: document.documentElement.getAttribute("lang") || null,
      h1_count: document.querySelectorAll("h1").length,
      form_count: document.querySelectorAll("form").length,
      image_count: document.images.length,
      missing_alt_attribute_count: [...document.images].filter((image) => !image.hasAttribute("alt")).length,
      viewport_meta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || null
    }));
    const result = {
      browser: name,
      viewport: "desktop",
      viewport_size: { width: 1366, height: 768 },
      status_code: response?.status() || null,
      final_url: sanitizeUrlForEvidence(page.url()),
      dom,
      console_errors: consoleErrors.slice(0, 20),
      page_errors: pageErrors.slice(0, 20),
      blocked_write_requests: blockedWrites.slice(0, 20),
      execution_mode: "synthetic",
      evidence_level: "controlled_runtime",
      limitation: `${name} via Playwright is synthetisch controlled-runtime bewijs en bewijst geen echt apparaat, branded Safari/iOS of assistive technology.`
    };
    await context.close();
    return result;
  } catch (error) {
    return { browser: name, viewport: "desktop", browser_error: sanitizeEvidenceText(error instanceof Error ? error.message : String(error), 300) };
  } finally {
    await browser?.close().catch(() => {});
  }
}

function extractLinks(html, baseUrl) {
  const out = new Set();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (!/^https?:$/.test(url.protocol) || url.origin !== baseUrl.origin || url.search) continue;
      url.hash = "";
      out.add(url.href);
    } catch {}
  }
  return [...out];
}

async function probeLink(url) {
  try {
    let result = await safeFetch(url, { method: "HEAD", allowQuery: false, timeoutMs: 7_000, headers: { "user-agent": "Webactueel-Checklist-QA/0.7 (+read-only supplemental runner)" } });
    if ([403, 405].includes(result.response.status)) {
      result = await safeFetch(url, { method: "GET", allowQuery: false, timeoutMs: 7_000, headers: { "user-agent": "Webactueel-Checklist-QA/0.7 (+read-only supplemental runner)" } });
    }
    return { url: sanitizeUrlForEvidence(url), final_url: sanitizeUrlForEvidence(result.finalUrl), status: result.response.status, ok: result.response.status < 400 };
  } catch (error) {
    return { url: sanitizeUrlForEvidence(url), status: null, ok: false, error: sanitizeEvidenceText(error instanceof Error ? error.message : String(error), 240) };
  }
}

async function boundedLinkScan(startUrl) {
  const maxPages = 25;
  const maxLinks = 250;
  const queue = [startUrl.href];
  const seenPages = new Set();
  const discovered = new Set([startUrl.href]);
  while (queue.length && seenPages.size < maxPages && discovered.size < maxLinks) {
    const current = queue.shift();
    if (seenPages.has(current)) continue;
    seenPages.add(current);
    try {
      const { response, finalUrl } = await safeFetch(current, { method: "GET", allowQuery: false, timeoutMs: 10_000, headers: { "user-agent": "Webactueel-Checklist-QA/0.7 (+bounded link discovery)" } });
      const type = response.headers.get("content-type") || "";
      if (response.status >= 400 || !/(?:text\/html|application\/xhtml\+xml)/i.test(type)) continue;
      const html = await readTextLimited(response, 1_000_000);
      for (const link of extractLinks(html, new URL(finalUrl))) {
        if (discovered.size >= maxLinks) break;
        if (!discovered.has(link)) {
          discovered.add(link);
          if (seenPages.size + queue.length < maxPages) queue.push(link);
        }
      }
    } catch {}
  }
  const links = [...discovered].slice(0, maxLinks);
  const results = [];
  for (let i = 0; i < links.length; i += 8) {
    results.push(...await Promise.all(links.slice(i, i + 8).map(probeLink)));
  }
  const broken = results.filter((item) => !item.ok);
  return {
    mode: "bounded_same_origin_queryless",
    page_discovery_limit: maxPages,
    link_probe_limit: maxLinks,
    pages_discovered: seenPages.size,
    links_tested: results.length,
    broken_count: broken.length,
    broken: broken.slice(0, 30),
    limitation: "Dit is een begrensde same-origin queryless linkscan, geen onbeperkte crawl van iedere mogelijke URL of state."
  };
}

const runCrossBrowser = request.level !== "quick" || request.task_type === "release_verification";
const runDeep = request.level === "full" || request.task_type === "release_verification";
const output = {
  schema_version: "qa-supplemental-v1",
  request_id: request.request_id,
  target_url: sanitizeUrlForEvidence(target),
  level: request.level,
  task_type: request.task_type,
  cross_browser: [],
  link_scan: null,
  limitations: []
};

if (runCrossBrowser) {
  const proxy = await startPublicNetworkProxy();
  try {
    output.cross_browser = await Promise.all([
      runBrowser("firefox", firefox, proxy.url),
      runBrowser("webkit", webkit, proxy.url)
    ]);
  } finally {
    await proxy.close();
  }
} else {
  output.limitations.push("Firefox/WebKit supplement is niet uitgevoerd in quick-profiel.");
}

if (runDeep) output.link_scan = await boundedLinkScan(target);
else output.limitations.push("Bounded deep link scan is alleen actief voor full of release_verification.");

await fs.mkdir("results", { recursive: true });
await fs.writeFile("results/supplemental.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Supplemental QA: browsers=${output.cross_browser.length}, links=${output.link_scan?.links_tested || 0}`);
