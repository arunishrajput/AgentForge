import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowGraphSchema } from "@/lib/workflow/graph";

import { executeWorkflow, GraphInvalidError, MAX_NODE_EXECUTIONS } from "./execute";
import {
  branchGraph,
  failingGraph,
  graph,
  loopGraph,
  sequentialGraph,
} from "./fixtures";
import type { RunRecorder, StepRecord } from "./types";
import { validateGraph } from "./validate";

/**
 * Critical-path tests — the ones whose failure breaks the demo (CLAUDE.md →
 * "Testing expectations"). The engine takes its recorder as an argument, so these
 * run with no database and no network.
 */
function recording(): { recorder: RunRecorder; started: StepRecord[]; finished: StepRecord[] } {
  const started: StepRecord[] = [];
  const finished: StepRecord[] = [];
  return {
    started,
    finished,
    recorder: {
      stepStarted: (step) => { started.push({ ...step }); },
      stepFinished: (step) => { finished.push({ ...step }); },
      heartbeat: () => {},
    },
  };
}

const run = (graphToRun: ReturnType<typeof sequentialGraph>, input?: unknown, recorder?: RunRecorder) =>
  executeWorkflow({
    runId: "run_test",
    workflowId: "wf_test",
    ownerId: "user_test",
    graph: graphToRun,
    input,
    recorder,
  });

test("a workflow graph round-trips through its schema losslessly", () => {
  const original = branchGraph();
  const reparsed = workflowGraphSchema.parse(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(reparsed, original);
  // Positions are contract: a reload that scrambles the layout is a broken round-trip.
  assert.deepEqual(
    reparsed.nodes.map((node) => node.position),
    original.nodes.map((node) => node.position),
  );
});

test("a sequential run threads output from node to node", async () => {
  const { recorder, started, finished } = recording();
  const outcome = await run(sequentialGraph(), { name: "Arunish" }, recorder);

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.error, null);

  const order = outcome.steps.map((step) => step.nodeId);
  assert.deepEqual(order, ["trigger", "shape", "say"]);

  const shape = outcome.steps.find((step) => step.nodeId === "shape")!;
  assert.deepEqual(shape.output, { greeting: "hello Arunish", count: 2 });

  const say = outcome.steps.find((step) => step.nodeId === "say")!;
  assert.equal(say.logs[0]?.message, "hello Arunish");

  // Every executed step is announced before it is completed — Phase 5's stream
  // depends on this ordering.
  assert.equal(started.length, 3);
  assert.equal(finished.length, 3);
});

test("a branch takes one side and records the other as skipped", async () => {
  const taken = await run(branchGraph(), { status: "ok" });
  assert.equal(taken.status, "succeeded");
  assert.equal(taken.steps.find((step) => step.nodeId === "check")!.branch, "true");
  assert.equal(taken.steps.find((step) => step.nodeId === "happy")!.status, "succeeded");
  assert.equal(taken.steps.find((step) => step.nodeId === "sad")!.status, "skipped");

  const other = await run(branchGraph(), { status: "broken" });
  assert.equal(other.steps.find((step) => step.nodeId === "check")!.branch, "false");
  assert.equal(other.steps.find((step) => step.nodeId === "sad")!.status, "succeeded");
  assert.equal(other.steps.find((step) => step.nodeId === "happy")!.status, "skipped");
});

test("a bounded loop terminates and runs its body exactly the configured number of times", async () => {
  const outcome = await run(loopGraph(3));

  assert.equal(outcome.status, "succeeded");

  const bodyRuns = outcome.steps.filter(
    (step) => step.nodeId === "body" && step.status === "succeeded",
  );
  assert.equal(bodyRuns.length, 3);
  assert.deepEqual(
    bodyRuns.map((step) => step.iteration),
    [0, 1, 2],
  );

  // The loop node runs once per iteration plus a final pass that leaves via "done".
  const loopSteps = outcome.steps.filter((step) => step.nodeId === "each");
  assert.equal(loopSteps.length, 4);
  assert.equal(loopSteps.at(-1)!.branch, "done");
  assert.equal(outcome.steps.find((step) => step.nodeId === "after")!.status, "succeeded");
});

test("the loop cap is not configurable past the hard limit", () => {
  const overshoot = loopGraph(9999);
  const problems = validateGraph(overshoot).problems;
  assert.ok(
    problems.some((problem) => problem.code === "invalid_config"),
    "a maxIterations above the hard cap must be rejected at validation",
  );
});

test("a runaway cycle is stopped by the per-node execution cap", async () => {
  // A loop whose body never lets it finish: the body edges back in, and the loop
  // node is re-entered with a fresh iteration each time because the body resets
  // nothing. The cap is what guarantees termination regardless.
  const runaway = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "each", type: "core.loop", config: { maxIterations: 25 } },
      { id: "body", type: "core.log", config: { message: "spin" } },
    ],
    [
      { source: "trigger", target: "each" },
      { source: "each", target: "body", sourceHandle: "loop" },
      { source: "body", target: "each" },
    ],
  );

  const outcome = await run(runaway);
  const bodyRuns = outcome.steps.filter((step) => step.nodeId === "body");
  assert.ok(
    bodyRuns.length <= MAX_NODE_EXECUTIONS,
    `body ran ${bodyRuns.length} times, above the cap of ${MAX_NODE_EXECUTIONS}`,
  );
});

test("a node failure fails the run, records the error, and stops execution", async () => {
  const outcome = await run(failingGraph(), {});

  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /Expected a value and found none\./);

  const guard = outcome.steps.find((step) => step.nodeId === "guard")!;
  assert.equal(guard.status, "failed");
  assert.equal(guard.error, "Expected a value and found none.");
  assert.ok(guard.finishedAt, "a failed step still records when it finished");

  // Nothing downstream ran.
  assert.equal(outcome.steps.find((step) => step.nodeId === "never")!.status, "skipped");
});

test("every step snapshots the config it actually ran with", async () => {
  const outcome = await run(sequentialGraph(), { name: "Arunish" });
  const say = outcome.steps.find((step) => step.nodeId === "say")!;

  // The stored graph holds "{{input.greeting}}"; the step must hold the resolved
  // value, because there is no workflow versioning to reconstruct it from later.
  assert.deepEqual(say.config, { message: "hello Arunish", level: "info" });
});

test("an unrunnable graph is rejected before any step exists", async () => {
  const noTrigger = graph([{ id: "lonely", type: "core.log" }], []);
  await assert.rejects(() => run(noTrigger), GraphInvalidError);
});
