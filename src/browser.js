import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertPublicUrl } from "./net.js";
import { describeArtifact, writeJsonArtifact } from "./artifacts.js";

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
  waitUntil: "domcontentloaded",
  navigationTimeoutMs: 25_000,
  loadTimeoutMs: 7_000
};

function compactAxeViolations(violations) {
  return violations.slice(0, 30).map((violation) => ({
    id: violation.id,
    impact: violation.impact || "unknown",
    help: violation.help,
    help_url: violation.helpUrl,
    node_count: violation.nodes.length,
    targets: violation.nodes.slice(0, 5).map((node) => node.target)
  }));
}

async function installPublicRequestGuard(context) {
  const allowedHosts = new Set();
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch {
      await route.abort("blockedbyclient");
      return;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      await route.continue();
      return;
    }

    try {
      if (!allowedHosts.has(parsed.hostname)) {
        await assertPublicUrl(parsed, { allowQuery: true });
        allowedHosts.add(parsed.hostname);
      }
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

async function inspectViewport(browser, url, name, artifactRoot) {
  const viewport = VIEWPORTS[name];
  const context = await browser.newContext({
    viewport,
    locale: BROWSER_CONFIG.locale,
    timezoneId: BROWSER_CONFIG.timezoneId,
    reducedMotion: BROWSER_CONFIG.reducedMotion
  });
  await installPublicRequestGuard(context);
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

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 500)));
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    requestFailures.push({ url: request.url(), error: failure?.errorText || "unknown" });
  });
  page.on("request", (request) => {
    if (url.startsWith("https://") && request.url().startsWith("http://")) {
      mixedContentRequests.push(request.url());
    }
  });

  let mainResponse;
  let axeFull;
  let dom;
  try {
    mainResponse = await page.goto(url, {
      waitUntil: BROWSER_CONFIG.waitUntil,
      timeout: BROWSER_CONFIG.navigationTimeoutMs
    });
    await page.waitForLoadState("load", { timeout: BROWSER_CONFIG.loadTimeoutMs }).catch(() => {});

    await page.addScriptTag({ content: axeSource });
    axeFull = await page.evaluate(async () => globalThis.axe.run(document));

    dom = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const html = document.documentElement;
      return {
        title: document.title || null,
        lang: html.getAttribute("lang") || null,
        viewport_meta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || null,
        canonical: document.querySelector('link[rel~="canonical"]')?.href || null,
        robots_meta: document.querySelector('meta[name="robots"]')?.getAttribute("content") || null,
        h1_count: document.querySelectorAll("h1").length,
        form_count: document.querySelectorAll("form").length,
        interactive_count: document.querySelectorAll("a,button,input,select,textarea,[tabindex]").length,
        navigation_timing: navigation ? {
          ttfb_ms: Math.round(navigation.responseStart - navigation.requestStart),
          dom_content_loaded_ms: Math.round(navigation.domContentLoadedEventEnd - navigation.startTime),
          load_ms: navigation.loadEventEnd ? Math.round(navigation.loadEventEnd - navigation.startTime) : null,
          transfer_size: navigation.transferSize || null,
          encoded_body_size: navigation.encodedBodySize || null
        } : null
      };
    });

    await fs.mkdir(path.join(artifactRoot, baseDir), { recursive: true });
    await page.screenshot({ path: path.join(artifactRoot, screenshotRelative), fullPage: true });
    await writeJsonArtifact(artifactRoot, axeRelative, axeFull);

    artifactEntries.push(await describeArtifact(artifactRoot, screenshotRelative, "screenshot", `${name} full-page screenshot`));
    artifactEntries.push(await describeArtifact(artifactRoot, axeRelative, "report", `${name} volledige axe JSON`));

    return {
      viewport: name,
      viewport_size: viewport,
      status_code: mainResponse?.status() || null,
      final_url: page.url(),
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
      mixed_content_requests: [...new Set(mixedContentRequests)].slice(0, 20),
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
  const target = await assertPublicUrl(rawUrl, { allowQuery: true });
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
          browser_error: error instanceof Error ? error.message : String(error),
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
      execution_note: "GitHub Actions voert een synthetische Chromium-browserrun uit tegen de publieke target. Mobile is emulatie; dit is geen browser_at-bewijs voor echte Safari/iOS of assistive technology.",
      runs
    };
  } finally {
    await browser.close();
  }
}
