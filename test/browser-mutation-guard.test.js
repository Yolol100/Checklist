import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const browser = fs.readFileSync("src/browser.js", "utf8");

test("browser request guard blocks all non-GET/HEAD methods before network", () => {
  assert.match(browser, /request\.method\(\)/);
  assert.match(browser, /\["GET",\s*"HEAD"\]/);
  assert.match(browser, /blocked_write_requests|blockedWriteRequests/);
});
