import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/run-checklist.yml", "utf8");
const browser = fs.readFileSync("src/browser.js", "utf8");

test("public production workflow publishes only the redacted raw JSON result", () => {
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/i);
  assert.match(workflow, /path:\s+results\/runs\/\$\{\{ steps\.request\.outputs\.request_id \}\}\.json/);
  assert.doesNotMatch(workflow, /Upload browser evidence|playwright-report|test-results|artifacts\/runs|screenshots?|traces?|axe[^\n]*\.json/i);
});

test("browser artifacts are opt-in rather than persisted by default", () => {
  assert.match(browser, /CHECKLIST_PERSIST_BROWSER_ARTIFACTS/);
});
