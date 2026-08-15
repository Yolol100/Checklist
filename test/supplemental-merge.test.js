import test from "node:test";
import assert from "node:assert/strict";
import { mergeObservation } from "../src/supplemental-merge.js";

test("adds a new supplemental observation", () => {
  const observations = [];
  assert.equal(mergeObservation(observations, { id: "NEW", outcome: "observed_ok", evidence_ids: ["EV-1"] }), "added");
  assert.equal(observations.length, 1);
});

test("promotes an unexecuted placeholder when explicitly allowed", () => {
  const observations = [{ id: "RUNTIME-CROSS-BROWSER", outcome: "not_executed", evidence_ids: [] }];
  const proven = { id: "RUNTIME-CROSS-BROWSER", outcome: "observed_ok", evidence_ids: ["EV-BROWSER-FIREFOX-DESKTOP", "EV-BROWSER-WEBKIT-DESKTOP"] };
  assert.equal(mergeObservation(observations, proven, { replaceNotExecutedPlaceholder: true }), "replaced");
  assert.deepEqual(observations, [proven]);
});

test("rejects replacing an already evidenced observation", () => {
  const observations = [{ id: "RUNTIME-CROSS-BROWSER", outcome: "not_executed", evidence_ids: ["EV-OLD"] }];
  assert.throws(() => mergeObservation(observations, { id: "RUNTIME-CROSS-BROWSER", outcome: "observed_ok", evidence_ids: ["EV-NEW"] }, { replaceNotExecutedPlaceholder: true }), /dubbele observatie/);
});

test("rejects replacing a completed observation", () => {
  const observations = [{ id: "RUNTIME-CROSS-BROWSER", outcome: "observed_ok", evidence_ids: [] }];
  assert.throws(() => mergeObservation(observations, { id: "RUNTIME-CROSS-BROWSER", outcome: "observed_ok", evidence_ids: ["EV-NEW"] }, { replaceNotExecutedPlaceholder: true }), /dubbele observatie/);
});

test("keeps strict duplicate protection by default", () => {
  const observations = [{ id: "DUP", outcome: "not_executed", evidence_ids: [] }];
  assert.throws(() => mergeObservation(observations, { id: "DUP", outcome: "observed_ok", evidence_ids: [] }), /dubbele observatie/);
});
