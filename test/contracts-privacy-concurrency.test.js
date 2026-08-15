import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertRequestContract, assertSafeIdentifier } from "../src/contracts.js";
import { mapWithConcurrency } from "../src/concurrency.js";
import { sanitizeEvidenceText, sanitizeUrlForEvidence } from "../src/privacy.js";

const fixture = JSON.parse(fs.readFileSync("requests/current.json", "utf8"));
const clone = (value) => structuredClone(value);

test("safe identifiers prevent traversal, aliases and unsafe filenames", () => {
  for (const value of ["../evil", "a/b", "a b", "ab", "x".repeat(81), ".hidden", "-leading"]) {
    assert.throws(() => assertSafeIdentifier(value, "id"), /id moet/);
  }
  for (const value of ["abc", "QA-123", "run_1.2"] ) assert.equal(assertSafeIdentifier(value), value);
});

test("current source-bound fixture satisfies strict request contract", () => {
  assert.equal(assertRequestContract(clone(fixture)).request_id, fixture.request_id);
});

test("request contract rejects invalid levels and target environments", () => {
  const invalidLevel = clone(fixture);
  invalidLevel.level = "everything";
  assert.throws(() => assertRequestContract(invalidLevel), /level moet/);
  const invalidEnvironment = clone(fixture);
  invalidEnvironment.target_environment = "unknown";
  assert.throws(() => assertRequestContract(invalidEnvironment), /target_environment/);
});

test("request contract rejects duplicate sources and unbound source hashes", () => {
  const duplicate = clone(fixture);
  duplicate.source_context.selected_sources.push(duplicate.source_context.selected_sources[0]);
  assert.throws(() => assertRequestContract(duplicate), /duplicaten/);
  const extraHash = clone(fixture);
  extraHash.source_context.source_hashes["support/not-selected.md"] = "a".repeat(64);
  assert.throws(() => assertRequestContract(extraHash), /niet-geselecteerde bronnen/);
});

test("release verification fails closed when release gate sources are missing", () => {
  const release = clone(fixture);
  release.task_type = "release_verification";
  assert.throws(() => assertRequestContract(release), /Bronpreflight onvolledig/);
});

test("evidence URL sanitization removes credentials, queries and fragments", () => {
  assert.equal(sanitizeUrlForEvidence("https://user:pass@example.com/path?token=secret#frag"), "https://example.com/path");
});

test("evidence text sanitization redacts URL queries, bearer tokens and token parameters", () => {
  const input = "failed https://example.com/a?token=secret Bearer abcdefghijklmnopqrstuvwxyz access_token=xyz";
  const output = sanitizeEvidenceText(input);
  assert.doesNotMatch(output, /secret|abcdefghijklmnopqrstuvwxyz|access_token=xyz/);
  assert.match(output, /https:\/\/example\.com\/a/);
  assert.match(output, /Bearer \[redacted\]/);
});

test("bounded concurrency never exceeds the requested worker count and preserves order", async () => {
  let active = 0;
  let maxActive = 0;
  const values = Array.from({ length: 20 }, (_, index) => index);
  const result = await mapWithConcurrency(values, 3, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active -= 1;
    return value * 2;
  });
  assert.ok(maxActive <= 3, `observed ${maxActive} concurrent workers`);
  assert.deepEqual(result, values.map((value) => value * 2));
});

test("bounded concurrency rejects invalid limits", async () => {
  await assert.rejects(() => mapWithConcurrency([1], 0, async (value) => value), /positive integer/);
});
