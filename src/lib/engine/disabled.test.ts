import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkflowGraph } from "@/lib/workflow/graph";

import type { RunCursor } from "./cursor";
import { executeWorkflow, GraphInvalidError, MAX_NODE_EXECUTIONS } from "./execute";
import { branchGraph, graph, loopGraph, sequentialGraph, TEST_SCOPE } from "./fixtures";
import { CHECKPOINT_OK, type Checkpoint, type RunRecorder, type StepRecord } from "./types";
import { validateGraph } from "./validate";

/**
 * **Switched-off nodes — Phase 30, `CONTRACT.md` → *Disabled nodes*.** The contract was
 * written before this code, and these tests are its clauses, one by one:
 *
 *  - a switched-off node is never executed
 *  - with a default output it passes its input straight through
 *  - a branch, a switch or a loop — no default output — stops its path
 *  - the trigger cannot be switched off
 *  - its step is `disabled`, with no timestamps, and its output is its input
 *  - it still counts towards the bounds, and a resumed run reads what it passed on
 */

function recording(answers: (n: number) => Checkpoint = () => CHECKPOINT_OK) {
  const started: StepRecord[] = [];
  const finished: StepRecord[] = [];
  const cursors: RunCursor[] = [];
  let n = 0;
  const recorder: RunRecorder = {
    stepStarted: (step) => { started.push({ ...step }); },
    stepFinished: (step) => { finished.push({ ...step, logs: [...step.logs] }); },
    checkpoint: (cursor) => {
      cursors.push(structuredClone(cursor));
      return answers(++n);
    },
  };
  return { recorder, started, finished, cursors };
}

const run = (
  graphToRun: WorkflowGraph,
  options: {
    input?: unknown;
    recorder?: RunRecorder;
    resume?: { cursor: RunCursor; steps: readonly StepRecord[] };
    allowWait?: boolean;
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
    allowWait: options.allowWait,
  });

/** The same graph with these nodes switched off. */
function off(source: WorkflowGraph, ...ids: string[]): WorkflowGraph {
  return {
    ...source,
    nodes: source.nodes.map((node) => (ids.includes(node.id) ? { ...node, disabled: true } : node)),
  };
}

const stepOf = (steps: readonly StepRecord[], nodeId: string) =>
  steps.filter((step) => step.nodeId === nodeId);

/* ------------------------------------------------------------------ *
 * Pass-through
 * ------------------------------------------------------------------ */

test("a switched-off node passes its input straight through to the next node", async () => {
  // trigger → shape → say, with `shape` off. `say` receives the trigger's output, exactly
  // as `shape` would have — not `shape`'s fields, which were never computed.
  const outcome = await run(off(sequentialGraph(), "shape"), { input: { name: "Arunish" } });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(outcome.steps.map((step) => [step.nodeId, step.status]), [
    ["trigger", "succeeded"],
    ["shape", "disabled"],
    ["say", "succeeded"],
  ]);

  const [trigger] = stepOf(outcome.steps, "trigger");
  const [shape] = stepOf(outcome.steps, "shape");
  const [say] = stepOf(outcome.steps, "say");
  assert.deepEqual(shape.input, trigger.output);
  assert.deepEqual(shape.output, shape.input, "its output is its input");
  assert.deepEqual(say.input, trigger.output);
  // `say` logs `{{input.greeting}}`, which only `shape` would have produced.
  assert.equal(say.logs[0]?.message, "");
});

test("a switched-off step never ran: no timestamps, no config, one line saying why", async () => {
  const outcome = await run(off(sequentialGraph(), "shape"), { input: { name: "x" } });
  const [shape] = stepOf(outcome.steps, "shape");

  assert.equal(shape.startedAt, null);
  assert.equal(shape.finishedAt, null);
  assert.equal(shape.config, null, "its config was never resolved");
  assert.equal(shape.branch, null);
  assert.equal(shape.error, null);
  assert.equal(shape.logs.length, 1);
  assert.match(shape.logs[0].message, /Switched off — not run\. Its input was passed on unchanged\./);
});

test("a switched-off node is never executed — not even one that would fail", async () => {
  // `core.assert` configured to fail on every input. Switched off, the run succeeds: the
  // node's `execute` was not called, which is the whole promise of the switch — nothing
  // is sent, posted, written or asked of a model.
  const guarded = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      {
        id: "guard",
        type: "core.assert",
        config: { left: "{{input.missing}}", operator: "is_not_empty", message: "Always fails." },
      },
      { id: "after", type: "core.log", config: { message: "reached" } },
    ],
    [
      { source: "trigger", target: "guard" },
      { source: "guard", target: "after" },
    ],
  );

  const live = await run(guarded, { input: {} });
  assert.equal(live.status, "failed", "the control: switched on, it fails");

  const { recorder, started } = recording();
  const outcome = await run(off(guarded, "guard"), { input: {}, recorder });
  assert.equal(outcome.status, "succeeded");
  assert.equal(stepOf(outcome.steps, "after")[0]?.status, "succeeded");
  // Announced only as finished: a step that never ran never started.
  assert.equal(started.some((step) => step.nodeId === "guard"), false);
});

test("a switched-off node with a config that could never parse does not stop the run", async () => {
  // `fields` must be an object. On, validation refuses the graph before anything runs;
  // off, the config is never read, so there is nothing to refuse.
  const broken = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "shape", type: "core.set", config: { fields: "not an object" } },
      { id: "say", type: "core.log", config: { message: "done" } },
    ],
    [
      { source: "trigger", target: "shape" },
      { source: "shape", target: "say" },
    ],
  );
  await assert.rejects(run(broken), GraphInvalidError, "the control");
  assert.equal((await run(off(broken, "shape"))).status, "succeeded");
});

test("a reference to a switched-off node reads what passed through it", async () => {
  const referencing = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "shape", type: "core.set", config: { fields: { greeting: "hi" } } },
      {
        id: "say",
        type: "core.log",
        config: { message: "name={{steps.shape.output.name}} greeting={{steps.shape.output.greeting}}" },
      },
    ],
    [
      { source: "trigger", target: "shape" },
      { source: "shape", target: "say" },
    ],
  );
  const outcome = await run(off(referencing, "shape"), { input: { name: "Ada" } });
  // `name` came in and went straight out; `greeting` was only ever going to be computed.
  assert.equal(stepOf(outcome.steps, "say")[0]?.logs[0]?.message, "name=Ada greeting=");
});

test("a run ending on a switched-off node takes its output from what passed through", async () => {
  const outcome = await run(off(sequentialGraph(), "say"), { input: { name: "Ada" } });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(outcome.output, stepOf(outcome.steps, "shape")[0]?.output);
});

test("a switched-off long delay passes through at once rather than pausing the run", async () => {
  const waiting = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "wait", type: "core.delay", config: { amount: 2, unit: "days" } },
      { id: "after", type: "core.log", config: { message: "no wait" } },
    ],
    [
      { source: "trigger", target: "wait" },
      { source: "wait", target: "after" },
    ],
  );
  // With no queue a long delay fails its step (Phase 26) — the control.
  assert.equal((await run(waiting, { allowWait: false })).status, "failed");

  const outcome = await run(off(waiting, "wait"), { allowWait: false });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.stop, "finished");
  assert.equal(stepOf(outcome.steps, "after")[0]?.status, "succeeded");
});

/* ------------------------------------------------------------------ *
 * Nodes with no default output stop their path
 * ------------------------------------------------------------------ */

test("a switched-off branch stops its path: neither side runs", async () => {
  // There is no neutral answer to "true or false?", and taking either would send the run
  // somewhere nobody chose.
  const outcome = await run(off(branchGraph(), "check"), { input: { status: "ok" } });

  assert.equal(outcome.status, "succeeded");
  const [check] = stepOf(outcome.steps, "check");
  assert.equal(check.status, "disabled");
  assert.match(check.logs[0].message, /no neutral answer, so nothing after it runs from here/);
  assert.equal(stepOf(outcome.steps, "happy")[0]?.status, "skipped");
  assert.equal(stepOf(outcome.steps, "sad")[0]?.status, "skipped");
});

test("a switched-off switch stops its path, Otherwise included", async () => {
  const switching = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "route", type: "core.switch", config: { value: "{{input.kind}}", cases: [] } },
      { id: "fallback", type: "core.log", config: { message: "otherwise" } },
    ],
    [
      { source: "trigger", target: "route" },
      { source: "route", target: "fallback", sourceHandle: "else" },
    ],
  );
  assert.equal(stepOf((await run(switching, { input: { kind: "x" } })).steps, "fallback")[0]?.status, "succeeded", "the control");

  const outcome = await run(off(switching, "route"), { input: { kind: "x" } });
  assert.equal(stepOf(outcome.steps, "route")[0]?.status, "disabled");
  assert.equal(stepOf(outcome.steps, "fallback")[0]?.status, "skipped");
});

test("a switched-off loop stops its path: no body, and nothing after Done", async () => {
  const outcome = await run(off(loopGraph(3), "each"));

  assert.equal(outcome.status, "succeeded");
  assert.equal(stepOf(outcome.steps, "each").length, 1);
  assert.equal(stepOf(outcome.steps, "each")[0]?.status, "disabled");
  assert.equal(stepOf(outcome.steps, "body")[0]?.status, "skipped");
  assert.equal(stepOf(outcome.steps, "after")[0]?.status, "skipped");
});

test("a node after a stopped path still runs when another path reaches it", async () => {
  // trigger → check (off) → sad, and trigger → sad directly. The direct edge still reaches it.
  const twoWays = branchGraph();
  twoWays.edges.push({ id: "direct", source: "trigger", target: "sad", sourceHandle: null });
  const outcome = await run(off(twoWays, "check"), { input: { status: "ok" } });
  assert.equal(stepOf(outcome.steps, "sad")[0]?.status, "succeeded");
  assert.equal(stepOf(outcome.steps, "happy")[0]?.status, "skipped");
});

/* ------------------------------------------------------------------ *
 * The trigger, and the bounds
 * ------------------------------------------------------------------ */

test("the trigger cannot be switched off: the graph is reported and does not run", async () => {
  const offTrigger = off(sequentialGraph(), "trigger");
  const validation = validateGraph(offTrigger);

  assert.equal(validation.valid, false);
  const problem = validation.problems.find((candidate) => candidate.code === "disabled_trigger");
  assert.ok(problem, JSON.stringify(validation.problems));
  assert.equal(problem.nodeId, "trigger");
  // It names the control the author probably wanted.
  assert.match(problem.message, /Active switch/);

  await assert.rejects(run(offTrigger), GraphInvalidError);
});

test("validation does not check a switched-off node's config, and still checks its edges", () => {
  const broken = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "shape", type: "core.set", config: { fields: "not an object" } },
    ],
    [{ source: "trigger", target: "shape" }],
  );
  assert.ok(validateGraph(broken).problems.some((problem) => problem.code === "invalid_config"));
  assert.deepEqual(validateGraph(off(broken, "shape")).problems, []);

  // An edge out of an output the node does not have is still wrong when it is off — the
  // run routes through it, so its shape has to be right.
  const misrouted = off(broken, "shape");
  misrouted.edges.push({ id: "bad", source: "shape", target: "trigger", sourceHandle: "nope" });
  const codes = validateGraph(misrouted).problems.map((problem) => problem.code);
  assert.ok(codes.includes("unknown_output_handle"), codes.join(","));
});

test("a switched-off node in a loop body is a step on every pass, and the loop still ends", async () => {
  const outcome = await run(off(loopGraph(3), "body"));

  assert.equal(outcome.status, "succeeded");
  const body = stepOf(outcome.steps, "body");
  assert.equal(body.length, 3, "one step per pass");
  assert.ok(body.every((step) => step.status === "disabled"));
  assert.deepEqual(body.map((step) => step.iteration), [0, 1, 2]);
  assert.equal(stepOf(outcome.steps, "after")[0]?.status, "succeeded");
  assert.equal(outcome.cursor?.executions.body, 3, "it counts towards the per-node cap");
  assert.ok(MAX_NODE_EXECUTIONS > 3);
});

/* ------------------------------------------------------------------ *
 * Resuming
 * ------------------------------------------------------------------ */

test("a run resumed after a switched-off step hands the next node what it passed on", async () => {
  // Preempted at the checkpoint after `shape` (the second step), so `say` is outstanding in
  // the cursor with `shape`'s seq — and must find the passed-through value in the step rows.
  const graphOff = off(sequentialGraph(), "shape");
  const first = recording((n) => (n === 2 ? { leaseHeld: false, cancelRequested: false } : CHECKPOINT_OK));
  const interrupted = await run(graphOff, { input: { name: "Ada" }, recorder: first.recorder });
  assert.equal(interrupted.stop, "interrupted");
  assert.deepEqual(first.cursors[1].queue, [{ nodeId: "say", fromSeq: 1 }]);

  const resumed = await run(graphOff, {
    input: { name: "Ada" },
    resume: { cursor: first.cursors[1], steps: first.finished },
  });
  assert.equal(resumed.status, "succeeded");
  const [say] = stepOf(resumed.steps, "say");
  assert.deepEqual(say.input, stepOf(first.finished, "trigger")[0]?.output);
  assert.deepEqual(resumed.output, say.output);
});
