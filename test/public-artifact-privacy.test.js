import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/run-checklist.yml", "utf8");
const browser = fs.readFileSync("src/browser.js", "utf8");

test("public production workflow never publishes browser traces/screenshots/full axe artifacts", () => {
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /Upload browser evidence/);
});

test("browser artifacts are opt-in rather than persisted by default", () => {
  assert.match(browser, /CHECKLIST_PERSIST_BROWSER_ARTIFACTS/);
});
