import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const browser = fs.readFileSync("src/browser.js", "utf8");

test("scenario signals extend rather than replace rich browser evidence", () => {
  assert.match(browser, /body-visible \+ mutation-quiescence/);
  assert.match(browser, /navigation_timing/);
  assert.match(browser, /inventory/);
  assert.match(browser, /internal_links/);
  assert.match(browser, /scenario_signals:\s*scenarios/);
  assert.match(browser, /passes:\s*axeFull\.passes\.length/);
  assert.match(browser, /incomplete:\s*axeFull\.incomplete\.length/);
  assert.match(browser, /inapplicable:\s*axeFull\.inapplicable\.length/);
  assert.match(browser, /writeJsonArtifact\(artifactRoot,\s*domRelative,\s*\{\s*readiness,\s*dom,\s*scenarios\s*\}\)/);
  assert.match(browser, /describeArtifact\(artifactRoot,\s*axeRelative/);
  assert.match(browser, /describeArtifact\(artifactRoot,\s*domRelative/);
});

test("persisted browser screenshots use deterministic Playwright settings", () => {
  assert.match(browser, /screenshotStability/);
  assert.match(browser, /animations:\s*"disabled"/);
  assert.match(browser, /caret:\s*"hide"/);
  assert.match(browser, /scale:\s*"css"/);
  assert.match(browser, /page\.screenshot\(\{[^}]*\.\.\.BROWSER_CONFIG\.screenshotStability/);
});
