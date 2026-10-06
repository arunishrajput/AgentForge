import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunCursor } from "./cursor";
import { executeWorkflow } from "./execute";
import { graph, TEST_SCOPE } from "./fixtures";
import { CHECKPOINT_OK, type RunRecorder, type StepRecord } from "./types";

/**
 * Phase 26's critical path in the engine: a long `core.delay` puts the run down, and a
 * resumed run picks it back up exactly where it stopped.
 *
 * Like the rest of the engine suite this runs against an in-memory recorder (D18). What
 * it cannot cover — the suspend write, the claim of a `waiting` run against `wakeAt`, the
 * Cloud Tasks delivery — is a property of Postgres and the queue, and is verified on the
 * deployed service by `scripts/verify-timers.mjs`.
 */

function recording() {
  const started: StepRecord[] = [];
  const finished: StepRecord[] = [];
  const cursors: RunCursor[] = [];
  const recorder: RunRecorder = {
    stepStarted: (step) => { started.push({ ...step }); },
    stepFinished: (step) => { finished.push({ ...step, logs: [...step.logs] }); },
    checkpoint: (cursor) => {
      cursors.push(structuredClone(cursor));
      return CHECKPOINT_OK;
    },
  };
  return { recorder, started, finished, cursors };
}

/** trigger → wait (two hours) → log. The shape every assertion below is about. */
const waitingGraph = () =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "hold", type: "core.delay", config: { amount: 2, unit: "hours" } },
      { id: "after", type: "core.log", config: { message: "woke with {{input.topic}}" } },
    ],
    [
      { source: "trigger", target: "hold" },
      { source: "hold", target: "after" },
    ],
  );

const run = (
  options: {
    recorder?: RunRecorder;
    allowWait?: boolean;
    resume?: { cursor: RunCursor; steps: readonly StepRecord[] };
    graph?: ReturnType<typeof graph>;
  } = {},
) =>
  executeWorkflow({
    runId: "run_wait",
    workflowId: "wf_wait",
    scope: TEST_SCOPE,
    graph: options.graph ?? waitingGraph(),
    input: { topic: "invoices" },
    recorder: options.recorder,
    allowWait: options.allowWait ?? true,
    resume: options.resume,
  });

test("a long delay stops the engine with the run waiting, not finished", async () => {
  const { recorder } = recording();
  const before = Date.now();
  const outcome = await run({ recorder });

  assert.equal(outcome.stop, "waiting");
  assert.equal(outcome.status, null, "a waiting run's status is the caller's to write");
  assert.ok(Math.abs(Date.parse(outcome.wakeAt!) - (before + 7_200_000)) < 5_000);
  // Nothing after the delay ran: the run put itself down at the delay.
  assert.deepEqual(
    outcome.steps.map((step) => [step.nodeId, step.status]),
    [
      ["trigger", "succeeded"],
      ["hold", "running"],
    ],
  );
});

test("the paused step keeps its output, and its successors are already queued", async () => {
  const outcome = await run();
  const hold = outcome.steps.find((step) => step.nodeId === "hold")!;

  // A delay passes its input through, so its output is final the moment it pauses.
  assert.deepEqual(hold.output, { topic: "invoices" });
  assert.equal(hold.finishedAt, null, "it finishes when the run wakes, so its duration is the wait");

  // The cursor carries the pause marker and the work that follows it.
  assert.deepEqual(outcome.cursor!.queue, [{ nodeId: "after", fromSeq: hold.seq }]);
  assert.deepEqual(outcome.cursor!.wait, { seq: hold.seq, until: outcome.wakeAt });
  assert.equal(outcome.cursor!.executions.hold, 1, "the delay counts as executed");
});

test("a pause writes no checkpoint of its own — the suspend is the one write", async () => {
  const { recorder, cursors } = recording();
  await run({ recorder });
  // One checkpoint, after the trigger. The delay's frontier goes out with the suspend,
  // under the same lease guard, rather than as a second statement.
  assert.equal(cursors.length, 1);
});

test("where nothing could wake it, a long wait fails its step and says why", async () => {
  // Local development and CI have no queue. Holding a request open for two hours is not
  // an option, and pretending the wait happened would be worse.
  const { recorder } = recording();
  const outcome = await run({ recorder, allowWait: false });

  assert.equal(outcome.stop, "finished");
  assert.equal(outcome.status, "failed");
  const hold = outcome.steps.find((step) => step.nodeId === "hold")!;
  assert.equal(hold.status, "failed");
  assert.match(hold.error!, /wait 2 hours/);
  assert.match(hold.error!, /no queue is configured/);
  assert.match(hold.error!, /up to 10 seconds run in place/);
});

test("waking finishes the paused step first, then carries on with its output", async () => {
  const first = await run();

  const { recorder, finished } = recording();
  const resumed = await run({
    recorder,
    resume: { cursor: first.cursor!, steps: first.steps },
  });

  assert.equal(resumed.stop, "finished");
  assert.equal(resumed.status, "succeeded");

  const hold = resumed.steps.find((step) => step.nodeId === "hold")!;
  assert.equal(hold.status, "succeeded");
  assert.ok(hold.finishedAt, "finished on wake");
  assert.equal(hold.logs.at(-1)?.message, "Done waiting.");

  // The step after the delay read the delay's output, which is the run's input passed on.
  const after = resumed.steps.find((step) => step.nodeId === "after")!;
  assert.equal(after.status, "succeeded");
  assert.deepEqual(after.input, { topic: "invoices" });

  // The paused step's completion was recorded, then the next node — in that order.
  assert.deepEqual(
    finished.map((step) => [step.nodeId, step.status]),
    [
      ["hold", "succeeded"],
      ["after", "succeeded"],
    ],
  );
});

test("a wake whose predecessor already finished the step does not finish it twice", async () => {
  // A previous wake may finish the delay step and lose its container before the next
  // checkpoint rewrote the cursor. The cursor still says `wait`; the step already says
  // `succeeded`. The engine must carry on rather than record the step a second time.
  const first = await run();
  const alreadyDone = first.steps.map((step) =>
    step.nodeId === "hold"
      ? { ...step, status: "succeeded" as const, finishedAt: new Date().toISOString() }
      : step,
  );

  const { recorder, finished } = recording();
  const resumed = await run({ recorder, resume: { cursor: first.cursor!, steps: alreadyDone } });

  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(
    finished.map((step) => step.nodeId),
    ["after"],
    "only the work after the delay is recorded",
  );
});

test("a run may wait more than once, and each wake leaves the next pause intact", async () => {
  const twice = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "first", type: "core.delay", config: { amount: 1, unit: "hours" } },
      { id: "second", type: "core.delay", config: { amount: 1, unit: "days" } },
      { id: "done", type: "core.log", config: { message: "both waits over" } },
    ],
    [
      { source: "trigger", target: "first" },
      { source: "first", target: "second" },
      { source: "second", target: "done" },
    ],
  );

  const pausedOnce = await run({ graph: twice });
  assert.equal(pausedOnce.stop, "waiting");

  const pausedTwice = await run({
    graph: twice,
    resume: { cursor: pausedOnce.cursor!, steps: pausedOnce.steps },
  });
  assert.equal(pausedTwice.stop, "waiting");
  const second = pausedTwice.steps.find((step) => step.nodeId === "second")!;
  assert.equal(pausedTwice.cursor!.wait!.seq, second.seq, "the new pause, not the old one");

  const finished = await run({
    graph: twice,
    resume: { cursor: pausedTwice.cursor!, steps: pausedTwice.steps },
  });
  assert.equal(finished.status, "succeeded");
  assert.deepEqual(
    finished.steps.map((step) => [step.nodeId, step.status]),
    [
      ["trigger", "succeeded"],
      ["first", "succeeded"],
      ["second", "succeeded"],
      ["done", "succeeded"],
    ],
  );
});
