import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const checklist = fs.readFileSync("src/checklist.js", "utf8");
const runner = fs.readFileSync("src/run.js", "utf8");

test("automatic internal-link probes are HEAD-only with no GET fallback", () => {
  const match = checklist.match(/async function checkLink[\s\S]*?\n}\n\nasync function collectRobots/);
  assert.ok(match, "checkLink function not found");
  assert.match(match[0], /method:\s*["']HEAD["']/);
  assert.doesNotMatch(match[0], /method:\s*["']GET["']/);
  assert.match(match[0], /conclusive/);
});

test("public raw runner strips detailed DOM inventory text before serialization", () => {
  assert.match(runner, /inventory_summary/);
  assert.match(runner, /delete\s+run\.dom\.inventory|run\.dom\.inventory\s*=\s*undefined/);
});
