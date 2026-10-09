import assert from "node:assert/strict";
import { test } from "node:test";

import { formatUtcShort } from "@/lib/format/date";

import { handledWords, originWords, retryTally, shortRunId, TRIGGER_WORDS } from "./words";

test("a run's origin reads as a phrase with the run it came from", () => {
  assert.equal(originWords({ runId: "0bcf25b7-0849-400f-82b9-05049265b713", kind: "retry" }), "Retry of 0bcf25b7");
  assert.equal(originWords({ runId: "0bcf25b7-0849", kind: "rerun" }), "Re-run of 0bcf25b7");
  assert.equal(originWords(null), null);
});

test("every trigger has a word", () => {
  assert.deepEqual(Object.keys(TRIGGER_WORDS).sort(), ["agent", "error", "manual", "schedule", "webhook", "workflow"]);
  // Phase 37: started by another workflow's failure — said as what it is, not as "Error".
  assert.equal(TRIGGER_WORDS.error, "Failure");
  assert.equal(shortRunId("abcdefghijk"), "abcdefgh");
});

test("a retry's tally counts what it carried over apart from what it ran", () => {
  const tally = retryTally([
    { status: "reused" },
    { status: "reused" },
    { status: "succeeded" },
    { status: "failed" },
    { status: "skipped" },
    { status: "disabled" },
  ]);
  assert.deepEqual(tally, { reused: 2, ran: 2 });
});

test("a short timestamp keeps the zone and drops the year", () => {
  assert.equal(formatUtcShort("2026-10-08T09:05:00Z"), "8 Oct, 09:05 UTC");
  assert.equal(formatUtcShort("2026-01-01T00:00:00Z"), "1 Jan, 00:00 UTC");
});

test("a run that handled errors says how many, and one that handled none says nothing", () => {
  assert.equal(handledWords(0), null);
  assert.equal(handledWords(undefined), null);
  assert.equal(handledWords(1), "1 error handled");
  assert.equal(handledWords(3), "3 errors handled");
});
