import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const workflowFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/run-checklist.yml",
  ".github/workflows/finalize-checklist.yml"
];

test("all external GitHub actions use immutable 40-char commit SHAs", () => {
  for (const file of workflowFiles) {
    const source = read(file);
    for (const line of source.split(/\r?\n/).filter((line) => /uses:\s+actions\//.test(line))) {
      assert.match(line, /uses:\s+actions\/[A-Za-z0-9_-]+@[a-f0-9]{40}(?:\s+#.*)?$/i, `${file}: ${line.trim()}`);
    }
  }
});

test("CI has read-only repository permissions", () => {
  const source = read(".github/workflows/ci.yml");
  assert.match(source, /permissions:\s*\n\s+contents:\s+read/);
  assert.doesNotMatch(source, /contents:\s+write/);
});

test("dependency install is lockfile-only and lifecycle scripts are disabled", () => {
  for (const file of workflowFiles) {
    const source = read(file);
    assert.match(source, /npm ci --ignore-scripts --no-audit --no-fund/);
    assert.doesNotMatch(source, /\bnpx\s+playwright\s+install/);
    if (/Install Chromium/.test(source)) assert.match(source, /node node_modules\/playwright\/cli\.js install/);
  }
});

test("production requests and policies use unique queue paths instead of shared current slots", () => {
  const run = read(".github/workflows/run-checklist.yml");
  const finalize = read(".github/workflows/finalize-checklist.yml");
  assert.match(run, /requests\/queue\/\*\.json/);
  assert.doesNotMatch(run, /paths:[\s\S]{0,100}requests\/current\.json/);
  assert.match(finalize, /policy\/queue\/\*\.json/);
  assert.doesNotMatch(finalize, /paths:[\s\S]{0,100}policy\/current\.json/);
});

test("production evidence commits immutable JSON only and uploads browser artifacts", () => {
  const run = read(".github/workflows/run-checklist.yml");
  assert.match(run, /upload-artifact@[a-f0-9]{40}/i);
  assert.match(run, /retention-days:\s+(?:7|14|30)/);
  assert.doesNotMatch(run, /git add[^\n]*artifacts\/runs/);
  assert.match(run, /git add[^\n]*results\/runs/);
  assert.doesNotMatch(run, /git add[^\n]*results\/latest\.json/);
});

test("write workflows rebase before push to survive concurrent independent runs", () => {
  for (const file of [".github/workflows/run-checklist.yml", ".github/workflows/finalize-checklist.yml"]) {
    const source = read(file);
    assert.match(source, /git pull --rebase origin main/);
    assert.match(source, /git push origin HEAD:main/);
  }
});

test("browser safety blocks service workers and websocket egress", () => {
  const source = read("src/browser.js");
  assert.match(source, /serviceWorkers\s*:\s*["']block["']/);
  assert.match(source, /routeWebSocket\(/);
  assert.doesNotMatch(source, /const allowedHosts = new Set\(\)/);
});

test("runner fails closed on invalid scan levels rather than silently downgrading", () => {
  const source = read("src/run.js");
  assert.doesNotMatch(source, /includes\(request\.level\)\s*\?\s*request\.level\s*:\s*["']standard["']/);
  assert.match(source, /assertRequestContract|assertRequestEnvelope|validateRequest/);
});

test("formalizer derives browser capabilities instead of hardcoding success", () => {
  const source = read("src/finalize.js");
  assert.doesNotMatch(source, /public_browser:\s*true/);
  assert.doesNotMatch(source, /browser_harness:\s*true/);
});
