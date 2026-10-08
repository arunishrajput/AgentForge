import assert from "node:assert/strict";
import { test } from "node:test";

import type { Run } from "./client";
import { adoptStarted } from "./run-stream";

const run = (id: string, steps: number): Run =>
  ({
    id,
    workflowId: "wf",
    status: steps === 0 ? "queued" : "running",
    steps: Array.from({ length: steps }, (_, seq) => ({ seq, nodeId: `n${seq}`, status: "reused" })),
  }) as unknown as Run;

test("a queued start's answer does not erase what the stream already has of the same run", () => {
  // Phase 33: the retry's snapshot — two reused steps — arrived before the 202 did.
  const streamed = run("retry", 2);
  assert.equal(adoptStarted(streamed, run("retry", 0)), streamed);
  assert.equal(adoptStarted(streamed, run("retry", 0)).steps?.length, 2);
});

test("it replaces a different run, or nothing", () => {
  const started = run("retry", 0);
  assert.equal(adoptStarted(run("original", 4), started), started);
  assert.equal(adoptStarted(null, started), started);
});
