import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunCursor } from "./cursor";
import { executeWorkflow } from "./execute";
import { graph, TEST_SCOPE } from "./fixtures";
import { Frontier, modeOf } from "./join";
import { planRetry } from "./retry";
import { CHECKPOINT_OK, type RunOutcome, type RunRecorder, type StepRecord } from "./types";

/**
 * **Phase 39's `core.merge` against the real engine** (`CONTRACT.md` → *Merge*, D187).
 *
 * The property under test is the one `ARCHITECTURE.md` carried as a known simplification since
 * Chapter 1: a node two branches lead to ran twice. With a merge it runs once, and *when* it runs is
 * decided by the work list — a merge fires when nothing outstanding can still reach it — which these
 * tests exercise on a parallel diamond, a diamond a Branch made, a race, branches of different
 * lengths, a run put down and resumed in the middle of a join, and a retry whose replay must take
 * its work the way the run did.
 */

const run = (
  g: ReturnType<typeof graph>,
  options: {
    input?: unknown;
    recorder?: RunRecorder;
    resume?: { cursor: RunCursor; steps: readonly StepRecord[] };
  } = {},
): Promise<RunOutcome> =>
  executeWorkflow({
    runId: "run_merge",
    workflowId: "wf_merge",
    scope: TEST_SCOPE,
    graph: g,
    input: options.input ?? {},
    recorder: options.recorder,
    resume: options.resume,
  });

const statusOf = (outcome: RunOutcome, nodeId: string) =>
  outcome.steps.filter((step) => step.nodeId === nodeId).map((step) => step.status);

const ran = (outcome: RunOutcome, nodeId: string) =>
  outcome.steps.filter((step) => step.nodeId === nodeId && step.status === "succeeded");

/** trigger → a, b (side by side) → join → after. */
const diamond = (mode?: "all" | "first") =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "a", type: "core.set", config: { fields: { from: "a" } } },
      { id: "b", type: "core.set", config: { fields: { from: "b" } } },
      { id: "join", type: "core.merge", config: mode ? { mode } : {} },
      { id: "after", type: "core.log", config: { message: "joined {{input.count}}" } },
    ],
    [
      { source: "trigger", target: "a" },
      { source: "trigger", target: "b" },
      { source: "a", target: "join" },
      { source: "b", target: "join" },
      { source: "join", target: "after" },
    ],
  );

test("without a merge, a step two branches lead to runs once per branch", async () => {
  // The Chapter 1 behaviour, kept as the control: the same diamond with a Log where the merge is.
  const outcome = await run(
    graph(
      [
        { id: "trigger", type: "core.manual_trigger" },
        { id: "a", type: "core.set", config: { fields: { from: "a" } } },
        { id: "b", type: "core.set", config: { fields: { from: "b" } } },
        { id: "after", type: "core.log", config: { message: "reached" } },
      ],
      [
        { source: "trigger", target: "a" },
        { source: "trigger", target: "b" },
        { source: "a", target: "after" },
        { source: "b", target: "after" },
      ],
    ),
  );
  assert.equal(outcome.status, "succeeded");
  assert.equal(ran(outcome, "after").length, 2);
});

test("a parallel diamond joined by a merge runs the join once, with both inputs in arrival order", async () => {
  const outcome = await run(diamond());
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(statusOf(outcome, "join"), ["succeeded"]);
  assert.deepEqual(statusOf(outcome, "after"), ["succeeded"]);

  const join = ran(outcome, "join")[0]!;
  assert.deepEqual(join.output, { count: 2, inputs: [{ from: "a" }, { from: "b" }], from: ["a", "b"] });
  assert.deepEqual(join.input, join.output, "the step's input is the joined value, and the node hands it on");
  // The join ran after both branches, never between them.
  const order = outcome.steps.map((step) => step.nodeId);
  assert.ok(order.indexOf("join") > order.indexOf("a") && order.indexOf("join") > order.indexOf("b"), order.join(","));
  assert.equal((ran(outcome, "after")[0]!.input as { count: number }).count, 2);
});

test("a diamond a Branch made does not wait for the side that was never chosen", async () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "check", type: "core.branch", config: { left: "{{input.ok}}", operator: "equals", right: "yes" } },
      { id: "yes", type: "core.set", config: { fields: { side: "yes" } } },
      { id: "no", type: "core.set", config: { fields: { side: "no" } } },
      { id: "join", type: "core.merge" },
      { id: "after", type: "core.log", config: { message: "done" } },
    ],
    [
      { source: "trigger", target: "check" },
      { source: "check", target: "yes", sourceHandle: "true" },
      { source: "check", target: "no", sourceHandle: "false" },
      { source: "yes", target: "join" },
      { source: "no", target: "join" },
      { source: "join", target: "after" },
    ],
  );

  for (const [ok, side, skipped] of [
    ["yes", "yes", "no"],
    ["nope", "no", "yes"],
  ] as const) {
    const outcome = await run(g, { input: { ok } });
    assert.equal(outcome.status, "succeeded", outcome.error ?? "");
    const join = ran(outcome, "join")[0]!;
    assert.equal((join.output as { count: number }).count, 1, `${ok}: waited for a side that was never chosen`);
    assert.deepEqual((join.output as { inputs: unknown[] }).inputs, [{ side }]);
    assert.deepEqual(statusOf(outcome, skipped), ["skipped"]);
    assert.equal(ran(outcome, "after").length, 1);
  }
});

test("first mode runs on the first branch and ignores the rest — once, with the branch that won", async () => {
  const outcome = await run(diamond("first"));
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(statusOf(outcome, "join"), ["succeeded"]);
  assert.deepEqual(statusOf(outcome, "after"), ["succeeded"]);
  assert.deepEqual(ran(outcome, "join")[0]!.output, { count: 1, inputs: [{ from: "a" }], from: ["a"] });
});

test("branches of different lengths: the join waits for the slow one, and keeps arrival order", async () => {
  // trigger → fast → join, and trigger → s1 → s2 → s3 → join. The fast branch arrives first by far.
  const outcome = await run(
    graph(
      [
        { id: "trigger", type: "core.manual_trigger" },
        { id: "fast", type: "core.set", config: { fields: { v: "fast" } } },
        { id: "s1", type: "core.set", config: { fields: { v: 1 } } },
        { id: "s2", type: "core.set", config: { fields: { v: 2 } } },
        { id: "s3", type: "core.set", config: { fields: { v: "slow" } } },
        { id: "join", type: "core.merge" },
      ],
      [
        { source: "trigger", target: "fast" },
        { source: "trigger", target: "s1" },
        { source: "s1", target: "s2" },
        { source: "s2", target: "s3" },
        { source: "fast", target: "join" },
        { source: "s3", target: "join" },
      ],
    ),
  );
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(statusOf(outcome, "join"), ["succeeded"]);
  assert.deepEqual(ran(outcome, "join")[0]!.output, {
    count: 2,
    inputs: [{ v: "fast" }, { v: "slow" }],
    from: ["fast", "s3"],
  });
  // The run's output is the merge's, since nothing runs after it.
  assert.deepEqual(outcome.output, ran(outcome, "join")[0]!.output);
});

test("a merge with one branch into it runs once, with that branch", async () => {
  const outcome = await run(
    graph(
      [
        { id: "trigger", type: "core.manual_trigger" },
        { id: "only", type: "core.set", config: { fields: { v: 1 } } },
        { id: "join", type: "core.merge" },
      ],
      [
        { source: "trigger", target: "only" },
        { source: "only", target: "join" },
      ],
    ),
  );
  assert.deepEqual(ran(outcome, "join")[0]!.output, { count: 1, inputs: [{ v: 1 }], from: ["only"] });
});

test("a merge inside a loop body joins once on every pass", async () => {
  // loop → body-a, body-b → join → back to the loop. Three passes, three joins of two.
  const outcome = await run(
    graph(
      [
        { id: "trigger", type: "core.manual_trigger" },
        { id: "each", type: "core.loop", config: { maxIterations: 3 } },
        { id: "a", type: "core.set", config: { fields: { side: "a", i: "{{input.index}}" } } },
        { id: "b", type: "core.set", config: { fields: { side: "b", i: "{{input.index}}" } } },
        { id: "join", type: "core.merge" },
        { id: "end", type: "core.log", config: { message: "end" } },
      ],
      [
        { source: "trigger", target: "each" },
        { source: "each", target: "a", sourceHandle: "loop" },
        { source: "each", target: "b", sourceHandle: "loop" },
        { source: "a", target: "join" },
        { source: "b", target: "join" },
        { source: "join", target: "each" },
        { source: "each", target: "end", sourceHandle: "done" },
      ],
    ),
    { input: { items: [1, 2, 3] } },
  );
  assert.equal(outcome.status, "succeeded", outcome.error ?? "");
  const joins = ran(outcome, "join");
  assert.equal(joins.length, 3);
  for (const join of joins) assert.equal((join.output as { count: number }).count, 2);
  assert.equal(ran(outcome, "end").length, 1);
});

test("a merge that is switched off hands the joined value straight on", async () => {
  const g = diamond();
  g.nodes.find((node) => node.id === "join")!.disabled = true;
  const outcome = await run(g);
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(statusOf(outcome, "join"), ["disabled"]);
  assert.equal(ran(outcome, "after").length, 1, "off, it still joins the branches — the node after it runs once");
});

test("a merge tested on its own is fed one value and joins it as the one branch it is", async () => {
  const outcome = await executeWorkflow({
    runId: "run_merge",
    workflowId: "wf_merge",
    scope: TEST_SCOPE,
    graph: diamond(),
    input: {},
    test: { scope: "node", nodeId: "join" },
    seed: { input: { v: 7 }, outputs: new Map(), trigger: {} },
  });
  assert.equal(outcome.status, "succeeded", outcome.error ?? "");
  assert.deepEqual(ran(outcome, "join")[0]!.output, { count: 1, inputs: [{ v: 7 }], from: [] });
});

/* ------------------------------------------------------------------ *
 * Put down and resumed in the middle of a join
 * ------------------------------------------------------------------ */

/** trigger → fast → join, and trigger → s1 → s2 → join: `fast` waits at the join while `s1` and `s2` run. */
const uneven = (guard?: string) =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "fast", type: "core.set", config: { fields: { v: "fast" } } },
      { id: "s1", type: "core.set", config: { fields: { v: 1 } } },
      guard === undefined
        ? { id: "s2", type: "core.set", config: { fields: { v: "slow" } } }
        : { id: "s2", type: "core.assert", config: { left: guard, operator: "is_not_empty", message: "Needs a value." } },
      { id: "join", type: "core.merge" },
      { id: "after", type: "core.log", config: { message: "after" } },
    ],
    [
      { source: "trigger", target: "fast" },
      { source: "trigger", target: "s1" },
      { source: "s1", target: "s2" },
      { source: "fast", target: "join" },
      { source: "s2", target: "join" },
      { source: "join", target: "after" },
    ],
  );

test("a run stopped while a merge holds a branch resumes with it held, and the join is the same", async () => {
  const checkpoints: Array<{ cursor: RunCursor; steps: StepRecord[] }> = [];
  const finished: StepRecord[] = [];
  const recorder: RunRecorder = {
    stepStarted: () => {},
    stepFinished: (step) => { finished.push(structuredClone(step)); },
    checkpoint: (cursor) => {
      checkpoints.push({ cursor: structuredClone(cursor), steps: structuredClone(finished) });
      return CHECKPOINT_OK;
    },
  };
  const whole = await run(uneven(), { recorder });
  assert.equal(whole.status, "succeeded");

  // `fast` reached the join while `s1`'s branch still had a step to run: the merge is holding it.
  const holding = checkpoints.find((checkpoint) => Object.keys(checkpoint.cursor.joins ?? {}).length > 0);
  assert.ok(holding, "some checkpoint carries a merge's held branch");
  assert.deepEqual(Object.keys(holding.cursor.joins!), ["join"]);
  assert.equal(holding.cursor.joins!.join!.held.length, 1);
  assert.equal(holding.cursor.joins!.join!.fired, false);
  // The cursor stays small: a seq per held branch, never the value it carried.
  assert.ok(JSON.stringify(holding.cursor).length < 400, JSON.stringify(holding.cursor));

  const resumed = await run(uneven(), { resume: { cursor: holding.cursor, steps: holding.steps } });
  assert.equal(resumed.status, "succeeded", resumed.error ?? "");
  assert.deepEqual(ran(resumed, "join")[0]!.output, ran(whole, "join")[0]!.output, "the same join, resumed or not");
  assert.equal(ran(resumed, "join").length, 1);
  assert.equal(ran(resumed, "after").length, 1);
  // The final cursor carries no merge state: nothing is outstanding.
  assert.equal(resumed.cursor?.joins, undefined);
});

/* ------------------------------------------------------------------ *
 * The retry's replay takes its work the way the run did
 * ------------------------------------------------------------------ */

/** trigger → a, b → join → guard(assert on {{trigger.ok}}) → after. Fails at `guard` unless ok. */
const guarded = (assertValue: string) =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "a", type: "core.set", config: { fields: { from: "a" } } },
      { id: "b", type: "core.set", config: { fields: { from: "b" } } },
      { id: "join", type: "core.merge" },
      { id: "guard", type: "core.assert", config: { left: assertValue, operator: "is_not_empty", message: "Needs a value." } },
      { id: "after", type: "core.log", config: { message: "after" } },
    ],
    [
      { source: "trigger", target: "a" },
      { source: "trigger", target: "b" },
      { source: "a", target: "join" },
      { source: "b", target: "join" },
      { source: "join", target: "guard" },
      { source: "guard", target: "after" },
    ],
  );

test("a retry of a run that failed after a merge reuses the join and starts at the step that failed", async () => {
  const original = guarded("{{trigger.missing}}");
  const failed = await run(original);
  assert.equal(failed.status, "failed");

  const plan = planRetry({
    original,
    current: original,
    triggerNodeId: "trigger",
    steps: failed.steps,
    passesThrough: () => true,
  });
  assert.ok(!("refused" in plan), "refused" in plan ? plan.message : "");
  assert.equal(plan.from, "guard");
  assert.deepEqual(plan.reused.map((step) => step.nodeId), ["trigger", "a", "b", "join"]);
  assert.equal(plan.cursor.joins, undefined, "the join finished, so nothing is held");

  // The fix: the guard now reads something that exists. The retry runs only what is left.
  const fixed = guarded("{{input.from}}");
  const retried = await run(fixed, { resume: { cursor: plan.cursor, steps: plan.reused } });
  assert.equal(retried.status, "succeeded", retried.error ?? "");
  assert.deepEqual(retried.steps.filter((step) => step.status === "reused").map((step) => step.nodeId), ["trigger", "a", "b", "join"]);
  assert.equal(ran(retried, "join").length, 0, "the join was reused, not run again");
  assert.equal(ran(retried, "after").length, 1);
});

test("a retry of a run that failed on one branch before the join keeps what the merge held", async () => {
  // `fast` has reached the join, and is held there, when the slow branch's guard fails.
  const original = uneven("{{trigger.missing}}");
  const failed = await run(original);
  assert.equal(failed.status, "failed");
  assert.equal(failed.steps.find((step) => step.nodeId === "s2")!.status, "failed");

  const plan = planRetry({
    original,
    current: uneven("{{trigger.present}}"),
    triggerNodeId: "trigger",
    steps: failed.steps,
    passesThrough: () => true,
  });
  assert.ok(!("refused" in plan), "refused" in plan ? plan.message : "");
  assert.equal(plan.from, "s2");
  assert.deepEqual(plan.reused.map((step) => step.nodeId), ["trigger", "fast", "s1"]);
  // The replay held `fast`'s arrival exactly as the run did, and put the failed step back first.
  assert.deepEqual(plan.cursor.joins, { join: { held: [plan.reused.find((step) => step.nodeId === "fast")!.seq], fired: false } });
  assert.deepEqual(plan.cursor.queue.map((item) => item.nodeId), ["s2"]);

  const retried = await run(uneven("{{trigger.present}}"), {
    input: { present: "x" },
    resume: { cursor: plan.cursor, steps: plan.reused },
  });
  assert.equal(retried.status, "succeeded", retried.error ?? "");
  const join = ran(retried, "join");
  assert.equal(join.length, 1, "joined once, after the branch that failed was retried");
  assert.equal((join[0]!.output as { count: number }).count, 2);
  assert.deepEqual((join[0]!.output as { from: string[] }).from, ["fast", "s2"]);
  assert.equal(ran(retried, "after").length, 1);
});

/* ------------------------------------------------------------------ *
 * The work list on its own
 * ------------------------------------------------------------------ */

test("a Frontier holds a merge's arrivals until nothing that can reach it is outstanding", () => {
  const g = diamond();
  const queue = [
    { nodeId: "join", fromSeq: 1 },
    { nodeId: "b", fromSeq: 0 },
    { nodeId: "join", fromSeq: 2 },
  ];
  const frontier = new Frontier({ graph: g, queue });

  // First arrival is held; `b` is outstanding and can reach the merge, so the merge waits and `b` runs.
  assert.equal(frontier.next()?.item.nodeId, "b");
  // Now the second arrival is taken, nothing else can reach it, and it fires with both.
  const fired = frontier.next();
  assert.equal(fired?.item.nodeId, "join");
  assert.deepEqual(fired?.merged, { mode: "all", fromSeqs: [1, 2] });
  assert.equal(frontier.next(), undefined);
  assert.deepEqual(frontier.joins, {}, "a merge that fired leaves no state behind");
});

test("a Frontier does not fire a merge while the approval it waits on could still reach it", () => {
  const g = diamond();
  let awaited: string | null = "a";
  const frontier = new Frontier({ graph: g, queue: [{ nodeId: "join", fromSeq: 1 }], waiting: () => awaited });
  assert.equal(frontier.next(), undefined, "held: `a` has not delivered");
  assert.deepEqual(frontier.joins.join?.held, [1]);
  awaited = null;
  assert.deepEqual(frontier.next()?.merged, { mode: "all", fromSeqs: [1] });
});

test("a merge's mode is read off its config, and anything but first is all", () => {
  const g = diamond("first");
  assert.equal(modeOf(g, "join"), "first");
  assert.equal(modeOf(diamond(), "join"), "all");
  assert.equal(modeOf(g, "a"), null);
  assert.equal(modeOf(g, "no-such-node"), null);
});
