import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertPublicUrl } from "./net.js";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;
const playwrightVersion = require("playwright/package.json").version;
const axeVersion = require("axe-core/package.json").version;

const VIEWPORTS = {
  desktop: { width: 1366, height: 768 },
  mobile: { width: 390, height: 844 }
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

async function inspectViewport(browser, url, name) {
  const viewport = VIEWPORTS[name];
  const context = await browser.newContext({
    viewport,
    locale: "nl-NL",
    timezoneId: "Europe/Amsterdam",
    reducedMotion: "reduce"
  });
  await installPublicRequestGuard(context);

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const mixedContentRequests = [];

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
  try {
    mainResponse = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("load", { timeout: 7_000 }).catch(() => {});
    await page.waitForTimeout(350);

    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(async () => {
      const result = await globalThis.axe.run(document);
      return {
        violations: result.violations,
        passes: result.passes.length,
        incomplete: result.incomplete.length,
        inapplicable: result.inapplicable.length
      };
    });

    const dom = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const html = document.documentElement;
      const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") || null;
      const canonical = document.querySelector('link[rel~="canonical"]')?.href || null;
      const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") || null;
      return {
        title: document.title || null,
        lang: html.getAttribute("lang") || null,
        viewport_meta: viewportMeta,
        canonical,
        robots_meta: robots,
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

    return {
      viewport: name,
      viewport_size: viewport,
      status_code: mainResponse?.status() || null,
      final_url: page.url(),
      dom,
      axe: {
        violation_count: axe.violations.length,
        serious_or_critical_count: axe.violations.filter((item) => ["serious", "critical"].includes(item.impact)).length,
        passes: axe.passes,
        incomplete: axe.incomplete,
        violations: compactAxeViolations(axe.violations)
      },
      console_errors: consoleErrors.slice(0, 20),
      page_errors: pageErrors.slice(0, 20),
      request_failures: requestFailures.slice(0, 20),
      mixed_content_requests: [...new Set(mixedContentRequests)].slice(0, 20)
    };
  } finally {
    await context.close();
  }
}

export async function runBrowserEvidence(rawUrl, level = "standard") {
  const target = await assertPublicUrl(rawUrl, { allowQuery: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const names = level === "quick" ? ["desktop"] : ["desktop", "mobile"];
    const runs = [];
    for (const name of names) {
      try {
        runs.push(await inspectViewport(browser, target.href, name));
      } catch (error) {
        runs.push({
          viewport: name,
          viewport_size: VIEWPORTS[name],
          browser_error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      tool: "playwright+axe-core",
      tool_versions: { playwright: playwrightVersion, axe_core: axeVersion },
      browser: "chromium",
      emulation_note: "De mobile-run is viewport/browseremulatie en bewijst geen echte iPhone, Safari of hardware.",
      runs
    };
  } finally {
    await browser.close();
  }
}
