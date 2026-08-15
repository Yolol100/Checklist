import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertPublicUrl } from "./net.js";
import { describeArtifact, writeJsonArtifact } from "./artifacts.js";
import { sanitizeEvidenceText, sanitizeUrlForEvidence, sanitizeUrlList } from "./privacy.js";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;
const playwrightVersion = require("playwright/package.json").version;
const axeVersion = require("axe-core/package.json").version;

const VIEWPORTS = {
  desktop: { width: 1366, height: 768 },
  mobile: { width: 390, height: 844 }
};

const BROWSER_CONFIG = {
  locale: "nl-NL",
  timezoneId: "Europe/Amsterdam",
  reducedMotion: "reduce",
  serviceWorkers: "block",
  webSockets: "blocked",
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

  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = request.url();
    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch {
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

  return { blockedWebSockets };
}

async function waitForMeaningfulReadiness(page) {
  const started = Date.now();
  await page.locator("body").waitFor({
    state: "visible",
    timeout: BROWSER_CONFIG.bodyVisibleTimeoutMs
  });

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
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
    scheduleQuiet();
    maxTimer = setTimeout(() => finish("max_wait_reached"), maxWaitMs);
  }), {
    quietWindowMs: BROWSER_CONFIG.domQuietWindowMs,
    maxWaitMs: BROWSER_CONFIG.domQuietMaxWaitMs
  });

  return {
    body_visible: true,
    strategy: "body-visible + mutation-quiescence",
    quiescence_reason: quiescence.reason,
    quiescence_elapsed_ms: quiescence.elapsed_ms,
    total_elapsed_ms: Date.now() - started
  };
}

function uniqueStrings(values, max = 80) {
  return [...new Set(values.filter(Boolean))].slice(0, max);
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
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

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
    const failure = request.failure();
    requestFailures.push({
      url: sanitizeUrlForEvidence(request.url()),
      error: sanitizeEvidenceText(failure?.errorText || "unknown", 240)
    });
  });
  page.on("request", (request) => {
    if (url.startsWith("https://") && request.url().startsWith("http://")) {
      mixedContentRequests.push(sanitizeUrlForEvidence(request.url()));
    }
  });

  let mainResponse;
  let axeFull;
  let dom;
  let readiness;
  try {
    mainResponse = await page.goto(url, {
      waitUntil: BROWSER_CONFIG.waitUntil,
      timeout: BROWSER_CONFIG.navigationTimeoutMs
    });
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
        } catch {
          return null;
        }
      };
      const internalLinks = anchors.map((node) => {
        try {
          const parsed = new URL(node.href, location.href);
          if (parsed.hostname !== baseHost || !/^https?:$/.test(parsed.protocol)) return null;
          return safeUrl(parsed.href);
        } catch {
          return null;
        }
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

    await page.addScriptTag({ content: axeSource });
    axeFull = await page.evaluate(async () => globalThis.axe.run(document));

    await fs.mkdir(path.join(artifactRoot, baseDir), { recursive: true });
    await page.screenshot({ path: path.join(artifactRoot, screenshotRelative), fullPage: true });
    await writeJsonArtifact(artifactRoot, axeRelative, axeFull);
    await writeJsonArtifact(artifactRoot, domRelative, { readiness, dom });

    artifactEntries.push(await describeArtifact(artifactRoot, screenshotRelative, "screenshot", `${name} full-page screenshot`));
    artifactEntries.push(await describeArtifact(artifactRoot, axeRelative, "report", `${name} volledige axe JSON`));
    artifactEntries.push(await describeArtifact(artifactRoot, domRelative, "report", `${name} DOM/readiness inventaris`));

    return {
      viewport: name,
      viewport_size: viewport,
      status_code: mainResponse?.status() || null,
      final_url: sanitizeUrlForEvidence(page.url()),
      readiness,
      dom,
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
      artifact_entries: artifactEntries
    };
  } finally {
    try {
      await fs.mkdir(path.dirname(path.join(artifactRoot, traceRelative)), { recursive: true });
      await context.tracing.stop({ path: path.join(artifactRoot, traceRelative) });
      artifactEntries.push(await describeArtifact(artifactRoot, traceRelative, "trace", `${name} Playwright trace`));
    } catch {
      // A failed trace must not hide the primary browser result.
    }
    await context.close();
  }
}

export async function runBrowserEvidence(rawUrl, level = "standard", artifactRoot = "artifacts/latest") {
  const target = await assertPublicUrl(rawUrl, { allowQuery: false });
  const browser = await chromium.launch({ headless: true });
  try {
    const names = level === "quick" ? ["desktop"] : ["desktop", "mobile"];
    const runs = [];
    for (const name of names) {
      try {
        runs.push(await inspectViewport(browser, target.href, name, artifactRoot));
      } catch (error) {
        runs.push({
          viewport: name,
          viewport_size: VIEWPORTS[name],
          browser_error: sanitizeEvidenceText(error instanceof Error ? error.message : String(error)),
          artifact_entries: []
        });
      }
    }

    return {
      tool: "playwright+axe-core",
      tool_versions: { playwright: playwrightVersion, axe_core: axeVersion },
      browser: "chromium",
      browser_configuration: BROWSER_CONFIG,
      viewports: VIEWPORTS,
      execution_note: "GitHub Actions voert een synthetische Chromium-browserrun uit tegen de publieke target. DOM-observaties worden pas na zichtbare body + mutation-quiescence verzameld. Service Workers en WebSocket-egress zijn geblokkeerd zodat netwerkinterceptie fail-closed blijft. Mobile is emulatie; dit is geen browser_at-bewijs voor echte Safari/iOS of assistive technology.",
      runs
    };
  } finally {
    await browser.close();
  }
}
