import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isPrivateIp } from "../src/net.js";

const read = (file) => fs.readFileSync(file, "utf8");

test("reserved/documentation IPv4 ranges are blocked", () => {
  for (const address of ["192.0.2.1", "198.51.100.7", "203.0.113.9"]) {
    assert.equal(isPrivateIp(address), true, `${address} must be treated as non-public`);
  }
});

test("Playwright network guard blocks service workers", () => {
  const source = read("src/browser.js");
  assert.match(source, /serviceWorkers\s*:\s*["']block["']/);
});

test("GitHub Actions are pinned to immutable full commit SHAs", () => {
  for (const file of [
    ".github/workflows/ci.yml",
    ".github/workflows/run-checklist.yml",
    ".github/workflows/finalize-checklist.yml"
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /uses:\s+actions\/[A-Za-z0-9_-]+@v\d+/g, `${file} still uses a mutable major tag`);
  }
});

test("production workflow does not commit browser artifacts into public git history", () => {
  const source = read(".github/workflows/run-checklist.yml");
  assert.doesNotMatch(source, /git add[^\n]*artifacts\/runs/);
  assert.match(source, /upload-artifact/);
});
