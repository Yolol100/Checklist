import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const checklist = fs.readFileSync("src/checklist.js", "utf8");
const supplemental = fs.readFileSync("src/supplemental.js", "utf8");
const runner = fs.readFileSync("src/run.js", "utf8");

test("automatic internal-link probes are HEAD-first with GET fallback only for 403/405", () => {
  const match = checklist.match(/async function checkLink[\s\S]*?\n}\n\nasync function collectRobots/);
  assert.ok(match, "checkLink function not found");
  assert.match(match[0], /method:\s*["']HEAD["']/);
  assert.match(match[0], /status\s*===\s*405\s*\|\|\s*result\.response\.status\s*===\s*403/);
  assert.match(match[0], /method:\s*["']GET["']/);
  assert.doesNotMatch(match[0], /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("supplemental link probing stays GET/HEAD-only and queryless", () => {
  const match = supplemental.match(/async function probeLink[\s\S]*?\n}\n\nasync function boundedLinkScan/);
  assert.ok(match, "supplemental probeLink function not found");
  assert.match(match[0], /method:\s*["']HEAD["']/);
  assert.match(match[0], /\[403,\s*405\]\.includes/);
  assert.match(match[0], /method:\s*["']GET["']/);
  assert.match(match[0], /allowQuery:\s*false/);
  assert.doesNotMatch(match[0], /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("public raw runner strips detailed DOM inventory text before serialization", () => {
  assert.match(runner, /inventory_summary/);
  assert.match(runner, /delete\s+run\.dom\.inventory|run\.dom\.inventory\s*=\s*undefined/);
});
