import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertPublicUrl } from "./net.js";
import { describeArtifact, writeJsonArtifact } from "./artifacts.js";
import { sanitizeEvidenceText, sanitizeUrlForEvidence, sanitizeUrlList } from "./privacy.js";
import { startPublicNetworkProxy } from "./public-proxy.js";
import { collectScenarioSignals } from "./scenario-signals.js";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;
const playwrightVersion = require("playwright/package.json").version;
const axeVersion = require("axe-core/package.json").version;
const PERSIST_BROWSER_ARTIFACTS = process.env.CHECKLIST_PERSIST_BROWSER_ARTIFACTS === "1";

const VIEWPORTS = {
  desktop: { width: 1366, height: 768 },
  mobile: { width: 390, height: 844 }
};

const BROWSER_CONFIG = {
  locale: "nl-NL",
  timezoneId: "Europe/Amsterdam",
  reducedMotion: "reduce",
  serviceWorkers: "block",
  httpMethods: ["GET", "HEAD"],
  webSockets: "blocked",
  dnsPinningProxy: true,
  webRtcIpHandlingPolicy: "disable_non_proxied_udp",
  quic: "disabled",
  artifactPersistence: PERSIST_BROWSER_ARTIFACTS ? "explicit-opt-in" : "disabled",
  screenshotStability: {
    animations: "disabled",
    caret: "hide",
    scale: "css"
  },
  waitUntil: "domcontentloaded",
  navigationTimeoutMs: 25_000,
  bodyVisibleTimeoutMs: 8_000,
  domQuietWindowMs: 450,
  domQuietMaxWaitMs: 6_000
};

function compactAxeViolations(violations) {
  return violations.slice(0, 30).map((violation) => ({
    id: violation.id,
    impact: violation.impact || "unknown",
    help: violation.help,
    help_url: sanitizeUrlForEvidence(violation.helpUrl),
    node_count: violation.nodes.length,
    targets: violation.nodes.slice(0, 5).map((node) => node.target)
  }));
}

async function installPublicRequestGuard(context) {
  const blockedWebSockets = [];
  const blockedWriteRequests = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    let parsed;
    try { parsed = new URL(request.url()); } catch {
      await route.abort("blockedbyclient");
      return;
    }
    if (["data:", "blob:", "about:"].includes(parsed.protocol)) {
      await route.continue();
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      await route.abort("blockedbyclient");
      return;
    }
    if (!["GET", "HEAD"].includes(method)) {
      blockedWriteRequests.push({ method, url: sanitizeUrlForEvidence(parsed) });
      await route.abort("blockedbyclient");
      return;
    }
    try {
      await assertPublicUrl(parsed, { allowQuery: !request.isNavigationRequest() });
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  await context.routeWebSocket("**/*", async (webSocketRoute) => {
    blockedWebSockets.push(sanitizeUrlForEvidence(webSocketRoute.url()));
    await webSocketRoute.close({ code: 1008, reason: "Blocked by read-only QA runner" });
  });
  return { blockedWebSockets, blockedWriteRequests };
}

async function waitForMeaningfulReadiness(page) {
  const started = Date.now();
  await page.locator("body").waitFor({ state: "visible", timeout: BROWSER_CONFIG.bodyVisibleTimeoutMs });
  const quiescence = await page.evaluate(({ quietWindowMs, maxWaitMs }) => new Promise((resolve) => {
    let finished = false;
    let quietTimer;
    let maxTimer;
    const startedAt = performance.now();
    const finish = (reason) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      resolve({ reason, elapsed_ms: Math.round(performance.now() - startedAt) });
    };
    const scheduleQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish("dom_quiet"), quietWindowMs);
    };
    const observer = new MutationObserver(scheduleQuiet);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    scheduleQuiet();
    maxTimer = setTimeout(() => finish("max_wait_reached"), maxWaitMs);
  }), { quietWindowMs: BROWSER_CONFIG.domQuietWindowMs, maxWaitMs: BROWSER_CONFIG.domQuietMaxWaitMs });
  return {
    body_visible: true,
    strategy: "body-visible + mutation-quiescence",
    quiescence_reason: quiescence.reason,
    quiescence_elapsed_ms: quiescence.elapsed_ms,
    total_elapsed_ms: Date.now() - started
  };
}

async function inspectViewport(browser, url, name, artifactRoot) {
  const viewport = VIEWPORTS[name];
  const context = await browser.newContext({
    viewport,
    locale: BROWSER_CONFIG.locale,
    timezoneId: BROWSER_CONFIG.timezoneId,
    reducedMotion: BROWSER_CONFIG.reducedMotion,
    serviceWorkers: BROWSER_CONFIG.serviceWorkers
  });
  const networkGuard = await installPublicRequestGuard(context);
  if (PERSIST_BROWSER_ARTIFACTS) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const mixedContentRequests = [];
  const artifactEntries = [];
  const baseDir = path.join("browser", name);
  const traceRelative = path.join(baseDir, "trace.zip");
  const screenshotRelative = path.join(baseDir, "page.png");
  const axeRelative = path.join(baseDir, "axe.json");
  const domRelative = path.join(baseDir, "dom-inventory.json");

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(sanitizeEvidenceText(message.text()));
  });
  page.on("pageerror", (error) => pageErrors.push(sanitizeEvidenceText(error.message)));
  page.on("requestfailed", (request) => {
    requestFailures.push({ url: sanitizeUrlForEvidence(request.url()), error: sanitizeEvidenceText(request.failure()?.errorText || "unknown", 240) });
  });
  page.on("request", (request) => {
    if (url.startsWith("https://") && request.url().startsWith("http://")) mixedContentRequests.push(sanitizeUrlForEvidence(request.url()));
  });

  let mainResponse;
  let axeFull;
  let dom;
  let readiness;
  try {
    mainResponse = await page.goto(url, { waitUntil: BROWSER_CONFIG.waitUntil, timeout: BROWSER_CONFIG.navigationTimeoutMs });
    readiness = await waitForMeaningfulReadiness(page);
    dom = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const html = document.documentElement;
      const anchors = [...document.querySelectorAll("a[href]")];
      const images = [...document.querySelectorAll("img")];
      const controls = [...document.querySelectorAll("button,input,select,textarea")];
      const baseHost = location.hostname;
      const safeUrl = (value) => {
        try {
          const parsed = new URL(value, location.href);
          if (!/^https?:$/.test(parsed.protocol)) return null;
          parsed.username = "";
          parsed.password = "";
          parsed.search = "";
          parsed.hash = "";
          return parsed.href;
        } catch { return null; }
      };
      let queryInternalLinkCount = 0;
      const internalLinks = anchors.map((node) => {
        try {
          const parsed = new URL(node.href, location.href);
          if (parsed.hostname !== baseHost || !/^https?:$/.test(parsed.protocol)) return null;
          if (parsed.search) {
            queryInternalLinkCount += 1;
            return null;
          }
          parsed.hash = "";
          return parsed.href;
        } catch { return null; }
      }).filter(Boolean);
      const inventory = {
        links: anchors.slice(0, 30).map((node) => ({
          text: (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
          href: safeUrl(node.href),
          aria_label: node.getAttribute("aria-label") || null
        })),
        buttons: [...document.querySelectorAll("button")].slice(0, 30).map((node) => ({
          text: (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
          aria_label: node.getAttribute("aria-label") || null,
          type: node.getAttribute("type") || null
        })),
        form_controls: controls.slice(0, 40).map((node) => ({
          tag: node.tagName.toLowerCase(),
          type: node.getAttribute("type") || null,
          name: node.getAttribute("name") || null,
          aria_label: node.getAttribute("aria-label") || null,
          placeholder: node.getAttribute("placeholder") || null
        }))
      };
      return {
        document_ready_state: document.readyState,
        title: document.title || null,
        description: document.querySelector('meta[name="description"]')?.getAttribute("content") || null,
        lang: html.getAttribute("lang") || null,
        viewport_meta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || null,
        canonical: safeUrl(document.querySelector('link[rel~="canonical"]')?.href || null),
        robots_meta: document.querySelector('meta[name="robots"]')?.getAttribute("content") || null,
        h1_count: document.querySelectorAll("h1").length,
        form_count: document.querySelectorAll("form").length,
        image_count: images.length,
        missing_alt_attribute_count: images.filter((node) => !node.hasAttribute("alt")).length,
        interactive_count: document.querySelectorAll("a,button,input,select,textarea,[tabindex]").length,
        internal_links: [...new Set(internalLinks)].slice(0, 80),
        internal_links_with_query_count: queryInternalLinkCount,
        inventory,
        navigation_timing: navigation ? {
          ttfb_ms: Math.round(navigation.responseStart - navigation.requestStart),
          dom_content_loaded_ms: Math.round(navigation.domContentLoadedEventEnd - navigation.startTime),
          load_ms: navigation.loadEventEnd ? Math.round(navigation.loadEventEnd - navigation.startTime) : null,
          transfer_size: navigation.transferSize || null,
          encoded_body_size: navigation.encodedBodySize || null
        } : null
      };
    });

    const scenarios = await page.evaluate(collectScenarioSignals);

    await page.addScriptTag({ content: axeSource });
    axeFull = await page.evaluate(async () => globalThis.axe.run(document));

    if (PERSIST_BROWSER_ARTIFACTS) {
      await fs.mkdir(path.join(artifactRoot, baseDir), { recursive: true });
      await page.screenshot({ path: path.join(artifactRoot, screenshotRelative), fullPage: true, ...BROWSER_CONFIG.screenshotStability });
      await writeJsonArtifact(artifactRoot, axeRelative, axeFull);
      await writeJsonArtifact(artifactRoot, domRelative, { readiness, dom, scenarios });
      artifactEntries.push(await describeArtifact(artifactRoot, screenshotRelative, "screenshot", `${name} full-page screenshot`));
      artifactEntries.push(await describeArtifact(artifactRoot, axeRelative, "report", `${name} volledige axe JSON`));
      artifactEntries.push(await describeArtifact(artifactRoot, domRelative, "report", `${name} DOM/readiness/scenario inventaris`));
    }

    return {
      viewport: name,
      viewport_size: viewport,
      status_code: mainResponse?.status() || null,
      final_url: sanitizeUrlForEvidence(page.url()),
      readiness,
      dom,
      scenario_signals: scenarios,
      axe: {
        violation_count: axeFull.violations.length,
        serious_or_critical_count: axeFull.violations.filter((item) => ["serious", "critical"].includes(item.impact)).length,
        passes: axeFull.passes.length,
        incomplete: axeFull.incomplete.length,
        inapplicable: axeFull.inapplicable.length,
        violations: compactAxeViolations(axeFull.violations)
      },
      console_errors: consoleErrors.slice(0, 20),
      page_errors: pageErrors.slice(0, 20),
      request_failures: requestFailures.slice(0, 20),
      mixed_content_requests: sanitizeUrlList(mixedContentRequests, 20),
      websocket_requests: sanitizeUrlList(networkGuard.blockedWebSockets, 20),
      blocked_write_requests: networkGuard.blockedWriteRequests.slice(0, 20),
      artifacts_persisted: PERSIST_BROWSER_ARTIFACTS,
      artifact_entries: artifactEntries
    };
  } finally {
    if (PERSIST_BROWSER_ARTIFACTS) {
      try {
        await fs.mkdir(path.dirname(path.join(artifactRoot, traceRelative)), { recursive: true });
        await context.tracing.stop({ path: path.join(artifactRoot, traceRelative) });
        artifactEntries.push(await describeArtifact(artifactRoot, traceRelative, "trace", `${name} Playwright trace`));
      } catch {
        // A failed trace must not hide the primary browser result.
      }
    }
    await context.close();
  }
}

export async function runBrowserEvidence(rawUrl, level = "standard", artifactRoot = "artifacts/latest") {
  const target = await assertPublicUrl(rawUrl, { allowQuery: false });
  const proxy = await startPublicNetworkProxy();
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: proxy.url },
    args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-quic"]
  });
  try {
    const names = level === "quick" ? ["desktop"] : ["desktop", "mobile"];
    const runs = [];
    for (const name of names) {
      try {
        runs.push(await inspectViewport(browser, target.href, name, artifactRoot));
      } catch (error) {
        runs.push({ viewport: name, viewport_size: VIEWPORTS[name], browser_error: sanitizeEvidenceText(error instanceof Error ? error.message : String(error)), artifacts_persisted: false, artifact_entries: [] });
      }
    }
    return {
      tool: "playwright+axe-core+scenario-signals",
      tool_versions: { playwright: playwrightVersion, axe_core: axeVersion },
      browser: "chromium",
      browser_configuration: BROWSER_CONFIG,
      viewports: VIEWPORTS,
      execution_note: `GitHub Actions voert een synthetische Chromium-browserrun uit tegen de publieke target. DOM-observaties worden pas na zichtbare body + mutation-quiescence verzameld. De read-only scenario-signalen voegen formulier-, consent-, keyboard-, dialog-, responsive- en commerce-observaties toe zonder formulierinzending, betaling of andere write. HTTP(S)-egress gaat via een lokale DNS-pinning proxy; alleen GET/HEAD zijn toegestaan en Service Workers, WebSocket-egress, non-proxied WebRTC UDP en QUIC zijn geblokkeerd. Bij expliciet gepersisteerde screenshots worden animaties uitgeschakeld, de tekstcaret verborgen en CSS-pixel scaling gebruikt om regressieruis te beperken. Volledige screenshots/traces/axe/DOM-artifacts worden ${PERSIST_BROWSER_ARTIFACTS ? "expliciet lokaal gepersisteerd" : "niet gepersisteerd in publieke modus"}. Mobile is emulatie; dit is geen browser_at-bewijs voor echte Safari/iOS of assistive technology.`,
      runs
    };
  } finally {
    await browser.close();
    await proxy.close();
  }
}
