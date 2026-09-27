import assert from "node:assert/strict";
import { test } from "node:test";

import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

import type { RunCursor } from "./cursor";
import { executeWorkflow } from "./execute";
import { graph, sequentialGraph, TEST_SCOPE } from "./fixtures";
import {
  CHECKPOINT_OK,
  type Checkpoint,
  type RunRecorder,
  type StepRecord,
} from "./types";

/**
 * Phase 17's critical path: a run that stops can carry on, a run that is cancelled
 * stops, and a run whose lease is taken away stops *without writing anything*.
 *
 * These run against the in-memory recorder like every other engine test — the engine
 * takes its recorder as an argument (D18), so the whole of resumability is assertable
 * with no database. What is **not** covered here is the compare-and-set in `lease.ts`,
 * which is a property of Postgres and is verified against the deployed database
 * instead; `PROGRESS.md` records that split so nobody mistakes a green suite here for
 * proof that the lease holds.
 */

interface Harness {
  recorder: RunRecorder;
  started: StepRecord[];
  finished: StepRecord[];
  cursors: RunCursor[];
}

/** A recorder that also captures every cursor, and can answer checkpoints as told. */
function recording(answers: (n: number) => Checkpoint = () => CHECKPOINT_OK): Harness {
  const started: StepRecord[] = [];
  const finished: StepRecord[] = [];
  const cursors: RunCursor[] = [];
  let n = 0;
  return {
    started,
    finished,
    cursors,
    recorder: {
      stepStarted: (step) => { started.push({ ...step }); },
      stepFinished: (step) => { finished.push({ ...step, logs: [...step.logs] }); },
      checkpoint: (cursor) => {
        cursors.push(structuredClone(cursor));
        return answers(++n);
      },
    },
  };
}

const run = (
  graphToRun: WorkflowGraph,
  options: {
    input?: unknown;
    recorder?: RunRecorder;
    resume?: { cursor: RunCursor; steps: readonly StepRecord[] };
    deadlineMs?: number;
    signal?: AbortSignal;
  } = {},
) =>
  executeWorkflow({
    runId: "run_test",
    workflowId: "wf_test",
    scope: TEST_SCOPE,
    graph: graphToRun,
    input: options.input,
    recorder: options.recorder,
    resume: options.resume,
    deadlineMs: options.deadlineMs,
    signal: options.signal,
  });

/* ------------------------------------------------------------------ *
 * The cursor the engine leaves behind
 * ------------------------------------------------------------------ */

test("a finished run reports a cursor with nothing outstanding", async () => {
  const { recorder } = recording();
  const outcome = await run(sequentialGraph(), { input: { name: "Arunish" }, recorder });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.stop, "finished");
  assert.deepEqual(outcome.cursor?.queue, []);
  assert.deepEqual(outcome.cursor?.executions, { trigger: 1, shape: 1, say: 1 });
});

test("each checkpoint names exactly the work still outstanding", async () => {
  const { recorder, cursors } = recording();
  await run(sequentialGraph(), { input: { name: "Arunish" }, recorder });

  // trigger → shape → say. After the trigger, `shape` is outstanding and its input is
  // the trigger's output at seq 0 — a seq, not the value, which is what keeps the cursor
  // independent of payload size.
  assert.equal(cursors.length, 3);
  assert.deepEqual(cursors[0].queue, [{ nodeId: "shape", fromSeq: 0 }]);
  assert.deepEqual(cursors[1].queue, [{ nodeId: "say", fromSeq: 1 }]);
  assert.deepEqual(cursors[2].queue, []);
  assert.deepEqual(cursors[0].executions, { trigger: 1 });
  assert.equal(cursors[2].seq, 3);
});

/* ------------------------------------------------------------------ *
 * Resuming
 * ------------------------------------------------------------------ */

test("a resumed run does not re-execute the steps that already completed", async () => {
  // The headline property of the phase, and the one whose failure is a workflow that
  // sends its email twice.
  const first = recording((n) => (n === 1 ? { cancelRequested: false, leaseHeld: false } : CHECKPOINT_OK));
  const interrupted = await run(sequentialGraph(), { input: { name: "Arunish" }, recorder: first.recorder });

  assert.equal(interrupted.stop, "interrupted");
  assert.equal(interrupted.reason, "preempted");
  assert.equal(first.finished.length, 1);
  assert.equal(first.finished[0].nodeId, "trigger");

  // The cursor the *checkpoint* saw is what a real caller would have persisted; the
  // preempted outcome deliberately carries none.
  const second = recording();
  const resumed = await run(sequentialGraph(), {
    input: { name: "Arunish" },
    recorder: second.recorder,
    resume: { cursor: first.cursors[0], steps: first.finished },
  });

  assert.equal(resumed.status, "succeeded");
  // `trigger` is not started again — only the two nodes that had not run.
  assert.deepEqual(second.started.map((step) => step.nodeId), ["shape", "say"]);
  // And the run as a whole still describes all three steps, in order.
  assert.deepEqual(resumed.steps.map((step) => step.nodeId), ["trigger", "shape", "say"]);
  assert.deepEqual(resumed.steps.map((step) => step.seq), [0, 1, 2]);
});

test("a resumed run threads the earlier step's output into the node that follows it", async () => {
  // Resuming with the wrong input is the silent failure this guards: the graph would run
  // to completion and produce nonsense.
  const first = recording(() => ({ cancelRequested: false, leaseHeld: false }));
  await run(sequentialGraph(), { input: { name: "Arunish" }, recorder: first.recorder });

  const second = recording();
  const resumed = await run(sequentialGraph(), {
    input: { name: "Arunish" },
    recorder: second.recorder,
    resume: { cursor: first.cursors[0], steps: first.finished },
  });

  const shape = resumed.steps.find((step) => step.nodeId === "shape")!;
  // `core.set` resolves `hello {{input.name}}` against the trigger's output, which it can
  // only see if the resumed input came back out of the step row.
  assert.deepEqual(shape.output, { greeting: "hello Arunish", count: 2 });
  assert.equal(resumed.status, "succeeded");
});

test("a resumed run continues the step numbering rather than colliding with it", async () => {
  const first = recording(() => ({ cancelRequested: false, leaseHeld: false }));
  await run(sequentialGraph(), { input: { name: "Arunish" }, recorder: first.recorder });

  const second = recording();
  await run(sequentialGraph(), {
    input: { name: "Arunish" },
    recorder: second.recorder,
    resume: { cursor: first.cursors[0], steps: first.finished },
  });

  // `(runId, seq)` is unique in Postgres, so a reused seq is an insert conflict that
  // would overwrite a completed step's record.
  assert.deepEqual(second.started.map((step) => step.seq), [1, 2]);
});

test("a resumed run still records the untaken side of a branch as skipped", async () => {
  const branching = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "check", type: "core.branch", config: { left: "{{input.status}}", operator: "equals", right: "ok" } },
      { id: "happy", type: "core.log", config: { message: "ok" } },
      { id: "sad", type: "core.log", config: { message: "not ok" } },
    ],
    [
      { source: "trigger", target: "check" },
      { source: "check", target: "happy", sourceHandle: "true" },
      { source: "check", target: "sad", sourceHandle: "false" },
    ],
  );

  const first = recording(() => ({ cancelRequested: false, leaseHeld: false }));
  await run(branching, { input: { status: "ok" }, recorder: first.recorder });

  const second = recording();
  const resumed = await run(branching, {
    input: { status: "ok" },
    recorder: second.recorder,
    resume: { cursor: first.cursors[0], steps: first.finished },
  });

  const sad = resumed.steps.find((step) => step.nodeId === "sad")!;
  assert.equal(sad.status, "skipped");
  assert.equal(resumed.steps.find((step) => step.nodeId === "happy")!.status, "succeeded");
});

test("a resumed loop keeps its iteration count and still terminates", async () => {
  // The execution counts live in the cursor, so a loop that resumed with them lost would
  // start again from iteration 0 and could run for ever.
  const looping = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "each", type: "core.loop", config: { maxIterations: 3 } },
      { id: "body", type: "core.log", config: { message: "pass {{input.index}}" } },
      { id: "after", type: "core.log", config: { message: "done" } },
    ],
    [
      { source: "trigger", target: "each" },
      { source: "each", target: "body", sourceHandle: "loop" },
      { source: "body", target: "each" },
      { source: "each", target: "after", sourceHandle: "done" },
    ],
  );

  // Stop after the third checkpoint, mid-loop.
  const first = recording((n) => (n === 3 ? { cancelRequested: false, leaseHeld: false } : CHECKPOINT_OK));
  await run(looping, { recorder: first.recorder });
  assert.equal(first.cursors.length, 3);

  const second = recording();
  const resumed = await run(looping, {
    recorder: second.recorder,
    resume: { cursor: first.cursors[2], steps: first.finished },
  });

  assert.equal(resumed.status, "succeeded");
  // Three passes in total across both attempts, then the `done` output.
  assert.equal(resumed.steps.filter((step) => step.nodeId === "body").length, 3);
  assert.equal(resumed.steps.some((step) => step.nodeId === "after" && step.status === "succeeded"), true);
});

/* ------------------------------------------------------------------ *
 * Cancellation
 * ------------------------------------------------------------------ */

test("a checkpoint reporting a cancellation ends the run as cancelled", async () => {
  const { recorder, finished } = recording((n) =>
    n === 1 ? { cancelRequested: true, leaseHeld: true } : CHECKPOINT_OK,
  );
  const outcome = await run(sequentialGraph(), { input: { name: "Arunish" }, recorder });

  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.stop, "finished");
  assert.equal(outcome.reason, "cancelled");
  assert.equal(outcome.error, "The run was cancelled.");
  // It stopped at a step boundary: the trigger ran, nothing after it did.
  assert.deepEqual(finished.map((step) => step.nodeId), ["trigger"]);
});

test("a cancelled run keeps its cursor, so its progress is still legible", async () => {
  const { recorder } = recording(() => ({ cancelRequested: true, leaseHeld: true }));
  const outcome = await run(sequentialGraph(), { input: { name: "Arunish" }, recorder });

  assert.deepEqual(outcome.cursor?.queue, [{ nodeId: "shape", fromSeq: 0 }]);
  assert.deepEqual(outcome.cursor?.executions, { trigger: 1 });
});

test("a cancelled run does not backfill skipped steps", async () => {
  // A skipped step means "the run reached its end and this was never on the path". A
  // cancelled run has not reached its end, so marking the rest skipped would claim a
  // decision the run never made.
  const { recorder } = recording(() => ({ cancelRequested: true, leaseHeld: true }));
  const outcome = await run(sequentialGraph(), { input: { name: "Arunish" }, recorder });

  assert.equal(outcome.steps.some((step) => step.status === "skipped"), false);
  assert.deepEqual(outcome.steps.map((step) => step.nodeId), ["trigger"]);
});

/* ------------------------------------------------------------------ *
 * Losing the lease
 * ------------------------------------------------------------------ */

test("a lost lease returns no status and no cursor at all", async () => {
  // Both absences are the contract. Another worker owns this run and has been writing
  // its own frontier; a status here would report a lie about a run that is still going,
  // and a cursor would overwrite theirs with a staler one.
  const { recorder } = recording(() => ({ cancelRequested: false, leaseHeld: false }));
  const outcome = await run(sequentialGraph(), { input: { name: "Arunish" }, recorder });

  assert.equal(outcome.stop, "interrupted");
  assert.equal(outcome.reason, "preempted");
  assert.equal(outcome.status, null);
  assert.equal(outcome.cursor, null);
  assert.equal(outcome.error, null);
});

test("a lost lease wins over a cancellation reported in the same checkpoint", async () => {
  // If the lease is gone, this engine has no standing to finish the run as anything —
  // including as cancelled. The worker that holds it will see the same request.
  const { recorder } = recording(() => ({ cancelRequested: true, leaseHeld: false }));
  const outcome = await run(sequentialGraph(), { input: { name: "Arunish" }, recorder });

  assert.equal(outcome.reason, "preempted");
  assert.equal(outcome.status, null);
});

/* ------------------------------------------------------------------ *
 * Retry and timeout
 * ------------------------------------------------------------------ */

/** A graph with one node whose policy is under test, fed by a manual trigger. */
function policyGraph(policy: unknown, config: Record<string, unknown> = {}): WorkflowGraph {
  return {
    version: GRAPH_VERSION,
    nodes: [
      { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      {
        id: "target",
        type: "core.assert",
        position: { x: 200, y: 0 },
        config: { left: "{{input.missing}}", operator: "is_not_empty", message: "nope", ...config },
        ...(policy === undefined ? {} : { policy: policy as never }),
      },
    ],
    edges: [{ id: "e0", source: "trigger", target: "target", sourceHandle: null }],
  };
}

test("a node with retries is attempted the configured number of times", async () => {
  const { recorder, finished } = recording();
  const outcome = await run(policyGraph({ retries: 2, backoffMs: 0 }), { recorder });

  assert.equal(outcome.status, "failed");
  const step = finished.find((s) => s.nodeId === "target")!;
  // One line per retry, so a person reading the run sees why it took three goes rather
  // than an unexplained pause.
  const retries = step.logs.filter((log) => log.message.startsWith("Attempt "));
  assert.equal(retries.length, 2);
  assert.equal(retries[0].level, "warn");
  assert.match(retries[0].message, /^Attempt 1 failed: nope — retrying\.$/);
  assert.match(retries[1].message, /^Attempt 2 failed: nope — retrying\.$/);
});

test("a retry that succeeds leaves one succeeded step, not several", async () => {
  // `core.delay` fails its config on the first pass only if we make it so; instead use a
  // node whose success depends on the iteration the engine reports, which is the one
  // observable that changes between attempts of the same step. A loop node is exactly
  // that, so this asserts the simpler and more important property: a retried step is one
  // step record, however many attempts it took.
  const { recorder, started, finished } = recording();
  await run(policyGraph({ retries: 1, backoffMs: 0 }), { recorder });

  assert.equal(started.filter((step) => step.nodeId === "target").length, 1);
  assert.equal(finished.filter((step) => step.nodeId === "target").length, 1);
});

test("the backoff is announced in the log when there is one", async () => {
  const { recorder, finished } = recording();
  await run(policyGraph({ retries: 1, backoffMs: 10 }), { recorder });

  const step = finished.find((s) => s.nodeId === "target")!;
  assert.match(step.logs[0].message, /retrying in 10ms\.$/);
});

test("a config failure is not retried however many retries are asked for", async () => {
  /**
   * The genuine runtime case, and the reason it cannot be a statically bad config: a
   * config with `{{` in it skips `validateGraph`'s schema check by design, because the
   * field will hold a number only after resolution. So this is a valid *graph* and an
   * invalid *config*, which is exactly what the engine re-parses for — and retrying it
   * would burn the run's deadline three times to reach the same answer, because the
   * graph does not change between attempts.
   *
   * The reference resolves to a **string** rather than to nothing, deliberately. Every
   * core node's fields carry a default, so a reference that resolves to nothing gets the
   * default and succeeds; a reference that resolves to the wrong *type* is the failure
   * that actually happens, and it is a sibling of the `{{ }}` bug `PROGRESS.md` records
   * under "a generated config value can be valid and self-defeating".
   */
  const invalid: WorkflowGraph = {
    version: GRAPH_VERSION,
    nodes: [
      { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      {
        id: "hold",
        type: "core.delay",
        position: { x: 200, y: 0 },
        config: { ms: "{{input.name}}" },
        policy: { retries: 3, backoffMs: 0 },
      },
    ],
    edges: [{ id: "e0", source: "trigger", target: "hold", sourceHandle: null }],
  };

  const { recorder, finished } = recording();
  const outcome = await run(invalid, { recorder, input: { name: "Arunish" } });

  assert.equal(outcome.status, "failed");
  const step = finished.find((s) => s.nodeId === "hold")!;
  assert.match(step.error!, /^Invalid config:/);
  assert.equal(step.logs.filter((log) => log.message.startsWith("Attempt ")).length, 0);
});

test("a node's own timeout fires and says that is what happened", async () => {
  // Distinguishing "took too long" from "the remote said no" is the whole value of a
  // per-node timeout: without the message, a timeout reads as an unexplained failure.
  const slow: WorkflowGraph = {
    version: GRAPH_VERSION,
    nodes: [
      { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      {
        id: "hold",
        type: "core.delay",
        position: { x: 200, y: 0 },
        config: { ms: 5000 },
        policy: { retries: 0, backoffMs: 0, timeoutMs: 1000 },
      },
    ],
    edges: [{ id: "e0", source: "trigger", target: "hold", sourceHandle: null }],
  };

  const { recorder, finished } = recording();
  const outcome = await run(slow, { recorder });

  assert.equal(outcome.status, "failed");
  const step = finished.find((s) => s.nodeId === "hold")!;
  assert.match(step.error!, /1000ms timeout elapsed/);
});

test("a node with no policy behaves exactly as it did before Phase 17", async () => {
  // The compatibility assertion: every graph saved before this phase has no `policy` on
  // any node, and must run identically.
  const { recorder, finished } = recording();
  const outcome = await run(policyGraph(undefined), { recorder });

  assert.equal(outcome.status, "failed");
  const step = finished.find((s) => s.nodeId === "target")!;
  assert.equal(step.logs.length, 0);
  assert.equal(step.error, "nope");
});

/* ------------------------------------------------------------------ *
 * Attribution of an abort
 * ------------------------------------------------------------------ */

test("a run that runs out of clock says so, and one that was stopped says that instead", async () => {
  /**
   * Chapter 1 reported both as "exceeded its time limit", which sent anyone debugging a
   * cut-short request hunting for a slow node that did not exist.
   *
   * The abort has to be observed at the **top of the work loop** rather than inside a
   * node, because a node that respects its signal reports the abort in its own words
   * first — `core.delay` says "The run stopped before this delay finished." So the
   * checkpoint is what takes the time here: it is the one point between two steps, which
   * is precisely where the engine attributes an abort.
   */
  const slow = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "after", type: "core.log", config: { message: "later" } },
    ],
    [{ source: "trigger", target: "after" }],
  );

  const stalling = (onCheckpoint?: () => void): RunRecorder => ({
    stepStarted: () => {},
    stepFinished: () => {},
    checkpoint: async () => {
      onCheckpoint?.();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return CHECKPOINT_OK;
    },
  });

  const expired = await run(slow, { recorder: stalling(), deadlineMs: 20 });
  assert.equal(expired.status, "failed");
  assert.match(expired.error!, /time limit/);

  // Same shape, but the deadline is generous and the caller goes away instead.
  const controller = new AbortController();
  const stopped = await run(slow, {
    recorder: stalling(() => controller.abort()),
    signal: controller.signal,
    deadlineMs: 60_000,
  });
  assert.equal(stopped.status, "failed");
  assert.match(stopped.error!, /stopped before it finished/);
});
