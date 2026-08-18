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

test("all production workflows have read-only repository permissions", () => {
  for (const file of workflowFiles) {
    const source = read(file);
    assert.match(source, /permissions:\s*\n\s+contents:\s+read/);
    assert.doesNotMatch(source, /contents:\s+write/);
  }
});

test("runtime request and policy workflows never target main", () => {
  for (const file of [".github/workflows/run-checklist.yml", ".github/workflows/finalize-checklist.yml"]) {
    const source = read(file);
    assert.match(source, /branches:\s*\n\s+- ['"]runtime\/\*\*['"]/);
    assert.doesNotMatch(source, /branches:\s*\n\s+- main/);
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

test("runtime workflows require exactly one queue file and no bundled code changes", () => {
  for (const file of [".github/workflows/run-checklist.yml", ".github/workflows/finalize-checklist.yml"]) {
    const source = read(file);
    assert.match(source, /TOTAL_FILES=.*git show/);
    assert.match(source, /TOTAL_FILES" -ne 1/);
  }
});

test("raw production workflow publishes immutable JSON only as a run-scoped artifact", () => {
  const run = read(".github/workflows/run-checklist.yml");
  assert.match(run, /actions\/upload-artifact@[a-f0-9]{40}/i);
  assert.match(run, /results\/runs\/\$\{\{ steps\.request\.outputs\.request_id \}\}\.json/);
  assert.doesNotMatch(run, /git add[^\n]*results\/runs/);
  assert.doesNotMatch(run, /git push/);
  assert.match(run, /CHECKLIST_PERSIST_BROWSER_ARTIFACTS:\s*["']0["']/);
});

test("formal workflow publishes manifest only as a run-scoped artifact", () => {
  const finalize = read(".github/workflows/finalize-checklist.yml");
  assert.match(finalize, /actions\/upload-artifact@[a-f0-9]{40}/i);
  assert.match(finalize, /steps\.policy\.outputs\.formal_path/);
  assert.doesNotMatch(finalize, /git add/);
  assert.doesNotMatch(finalize, /git push/);
});

test("browser safety blocks bypass protocols and pins HTTP(S) through the local public proxy", () => {
  const browser = read("src/browser.js");
  const proxy = read("src/public-proxy.js");
  const network = read("src/net.js");
  assert.match(browser, /serviceWorkers\s*:\s*["']block["']/);
  assert.match(browser, /routeWebSocket\(/);
  assert.match(browser, /startPublicNetworkProxy\(/);
  assert.match(browser, /force-webrtc-ip-handling-policy=disable_non_proxied_udp/);
  assert.match(browser, /--disable-quic/);
  assert.match(browser, /CHECKLIST_PERSIST_BROWSER_ARTIFACTS/);
  assert.doesNotMatch(browser, /const allowedHosts = new Set\(\)/);
  assert.match(proxy, /resolvePublicHost\(/);
  assert.match(proxy, /net\.connect\(\{ host: address/);
  assert.match(network, /requester\(current, addresses/);
});

test("browser request guard is read-only at HTTP method level", () => {
  const browser = read("src/browser.js");
  assert.match(browser, /request\.method\(\)/);
  assert.match(browser, /\["GET",\s*"HEAD"\]/);
  assert.match(browser, /blockedWriteRequests/);
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
