import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialCursor,
  readCursor,
  rehydrate,
  runCursorSchema,
  snapshotCursor,
} from "./cursor";
import type { StepRecord } from "./types";

/**
 * The cursor is what makes a run resumable, so its failure mode is a run that resumes
 * *wrongly* — re-running a node that already sent an email, or feeding a node the wrong
 * upstream output. Those are silent, so they are asserted here rather than left to the
 * deployed walk.
 */

function step(overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    seq: 0,
    nodeId: "a",
    nodeType: "core.log",
    iteration: 0,
    status: "succeeded",
    config: null,
    input: null,
    output: null,
    branch: null,
    logs: [],
    error: null,
    startedAt: "2026-09-27T00:00:00.000Z",
    finishedAt: "2026-09-27T00:00:01.000Z",
    ...overrides,
  };
}

test("a fresh cursor holds only the trigger, whose input is the run's own", () => {
  const cursor = initialCursor("trigger");
  assert.deepEqual(cursor, {
    queue: [{ nodeId: "trigger", fromSeq: null }],
    executions: {},
    seq: 0,
  });
});

test("a cursor round-trips through its schema", () => {
  const cursor = {
    queue: [{ nodeId: "b", fromSeq: 3 }],
    executions: { a: 1, b: 2 },
    seq: 4,
  };
  assert.deepEqual(runCursorSchema.parse(JSON.parse(JSON.stringify(cursor))), cursor);
});

test("an unreadable cursor is absent, not an error", () => {
  // The consequence of getting this wrong is the reason it is a test: a malformed
  // frontier trusted as valid would execute an arbitrary node with arbitrary input.
  // Starting over is wasteful; starting wrong is a bug nothing reports.
  assert.equal(readCursor(null), null);
  assert.equal(readCursor(undefined), null);
  assert.equal(readCursor("not a cursor"), null);
  assert.equal(readCursor({ queue: "nope", executions: {}, seq: 0 }), null);
  assert.equal(readCursor({ queue: [{ nodeId: "a" }], executions: {}, seq: 0 }), null);
  assert.equal(readCursor({ queue: [], executions: { a: -1 }, seq: 0 }), null);
  assert.equal(readCursor({ queue: [], executions: {}, seq: 1.5 }), null);
});

test("a readable cursor comes back intact", () => {
  const cursor = { queue: [{ nodeId: "b", fromSeq: 0 }], executions: { a: 1 }, seq: 1 };
  assert.deepEqual(readCursor(cursor), cursor);
});

test("rehydrate rebuilds node outputs from the step rows, not from the cursor", () => {
  // This is the property that keeps the cursor small: outputs live in `run_step`, so a
  // 200 KB HTTP response is never written into the run row once per step.
  const steps = [
    step({ seq: 0, nodeId: "trigger", output: { in: 1 } }),
    step({ seq: 1, nodeId: "fetch", output: { body: "big" } }),
  ];
  const state = rehydrate({ queue: [{ nodeId: "next", fromSeq: 1 }], executions: { trigger: 1, fetch: 1 }, seq: 2 }, steps);

  assert.deepEqual(state.outputs.get("trigger"), { in: 1 });
  assert.deepEqual(state.outputs.get("fetch"), { body: "big" });
  assert.deepEqual(state.bySeq.get(1), { body: "big" });
  assert.deepEqual(state.lastOutput, { body: "big" });
  assert.deepEqual([...state.executions], [["trigger", 1], ["fetch", 1]]);
});

test("a looped node's output is its most recent pass, not its first", () => {
  const steps = [
    step({ seq: 0, nodeId: "each", output: { index: 0 } }),
    step({ seq: 1, nodeId: "each", iteration: 1, output: { index: 1 } }),
  ];
  const state = rehydrate({ queue: [], executions: { each: 2 }, seq: 2 }, steps);
  assert.deepEqual(state.outputs.get("each"), { index: 1 });
});

test("a failed or skipped step contributes no output", () => {
  const steps = [
    step({ seq: 0, nodeId: "trigger", output: { ok: true } }),
    step({ seq: 1, nodeId: "boom", status: "failed", output: null, error: "nope" }),
    step({ seq: 2, nodeId: "never", status: "skipped" }),
  ];
  const state = rehydrate({ queue: [], executions: { trigger: 1 }, seq: 3 }, steps);
  assert.equal(state.outputs.has("boom"), false);
  assert.equal(state.outputs.has("never"), false);
  assert.deepEqual(state.lastOutput, { ok: true });
});

test("a step a retry carried over hands its output on like the step it stands for", () => {
  // Phase 33. A retry's `reused` copy of a finished step is what the steps after it read, and
  // `{{steps.shape.output}}` resolves against it — without it, a retry would feed its first new
  // step `null`.
  const steps = [
    step({ seq: 0, nodeId: "trigger", status: "reused", output: { name: "Ada" }, startedAt: null, finishedAt: null }),
    step({ seq: 1, nodeId: "shape", status: "reused", output: { greeting: "hi" }, startedAt: null, finishedAt: null }),
  ];
  const state = rehydrate({ queue: [{ nodeId: "guard", fromSeq: 1 }], executions: { trigger: 1, shape: 1 }, seq: 2 }, steps);
  assert.deepEqual(state.bySeq.get(1), { greeting: "hi" });
  assert.deepEqual(state.outputs.get("shape"), { greeting: "hi" });
  assert.deepEqual(state.lastOutput, { greeting: "hi" });
});

test("seq never goes backwards behind the rows that already exist", () => {
  // A cursor write lost while its step row landed would otherwise reuse a seq, and
  // `(runId, seq)` is unique — the insert would conflict and the resumed run would
  // overwrite a completed step's record.
  const steps = [step({ seq: 0 }), step({ seq: 1 }), step({ seq: 2 })];
  const state = rehydrate({ queue: [], executions: {}, seq: 1 }, steps);
  assert.equal(state.seq, 3);
});

test("seq is the cursor's when it is ahead of the rows", () => {
  // The opposite direction: a step that was started and whose row is present at seq 0
  // while the cursor says 1 means the cursor is the authority.
  const state = rehydrate({ queue: [], executions: {}, seq: 5 }, [step({ seq: 0 })]);
  assert.equal(state.seq, 5);
});

test("rehydrating with no steps at all starts from zero", () => {
  const state = rehydrate(initialCursor("trigger"), []);
  assert.equal(state.seq, 0);
  assert.equal(state.lastOutput, null);
  assert.deepEqual(state.queue, [{ nodeId: "trigger", fromSeq: null }]);
});

test("snapshotCursor is the inverse of rehydrate's view of the frontier", () => {
  const queue = [{ nodeId: "b", fromSeq: 1 }];
  const executions = new Map([["a", 2]]);
  const snapshot = snapshotCursor({ queue, executions, seq: 7 });
  assert.deepEqual(snapshot, { queue, executions: { a: 2 }, seq: 7 });

  const state = rehydrate(snapshot, []);
  assert.deepEqual(state.queue, queue);
  assert.deepEqual([...state.executions], [...executions]);
  assert.equal(state.seq, 7);
});

test("snapshotCursor copies the queue rather than aliasing it", () => {
  // The engine mutates its queue in place with `shift`/`push`. A snapshot that aliased
  // it would be silently rewritten between being taken and being written.
  const queue = [{ nodeId: "b", fromSeq: null }];
  const snapshot = snapshotCursor({ queue, executions: new Map(), seq: 0 });
  queue.pop();
  assert.equal(snapshot.queue.length, 1);
});
