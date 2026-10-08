import assert from "node:assert/strict";
import { test } from "node:test";

import { getNode } from "@/lib/nodes";
import type { WorkflowGraph } from "@/lib/workflow/graph";

import type { RunCursor } from "./cursor";
import { executeWorkflow } from "./execute";
import { graph, loopGraph, TEST_SCOPE } from "./fixtures";
import { planRetry, rerunnable, type RetryPlan, type RetryRefusal } from "./retry";
import { CHECKPOINT_OK, type RunRecorder, type StepRecord } from "./types";

/**
 * **Retry from the failed step — Phase 33, D152.** The phase's validation asks for exactly this:
 * fix the config, retry, and *count the steps* to prove the upstream ones were not executed again.
 * So every test here runs a real graph to a real failure through the engine, plans the retry, and
 * resumes the engine from the plan with a recorder that counts what it started.
 */

function recording() {
  const started: StepRecord[] = [];
  const recorder: RunRecorder = {
    stepStarted: (step) => {
      started.push({ ...step });
    },
    stepFinished: () => {},
    checkpoint: () => CHECKPOINT_OK,
  };
  return { recorder, started };
}

const execute = (
  graphToRun: WorkflowGraph,
  options: {
    input?: unknown;
    recorder?: RunRecorder;
    resume?: { cursor: RunCursor; steps: readonly StepRecord[] };
    deadlineMs?: number;
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
  });

const passesThrough = (type: string) => getNode(type)?.outputs.some((output) => output.key === null) ?? false;

function plan(original: WorkflowGraph, steps: readonly StepRecord[], current = original): RetryPlan | RetryRefusal {
  return planRetry({ original, current, triggerNodeId: "trigger", steps, passesThrough });
}

function planned(result: RetryPlan | RetryRefusal): RetryPlan {
  if ("refused" in result) assert.fail(`expected a plan, was refused: ${result.message}`);
  return result;
}

/** trigger → shape → guard → after, where the guard fails until it is fixed. */
function guarded(fixed: boolean): WorkflowGraph {
  return graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "shape", type: "core.set", config: { fields: { greeting: "hello {{input.name}}" } } },
      {
        id: "guard",
        type: "core.assert",
        config: {
          left: fixed ? "{{input.greeting}}" : "{{input.missing}}",
          operator: "is_not_empty",
          message: "Expected a value and found none.",
        },
      },
      { id: "after", type: "core.log", config: { message: "{{steps.shape.output.greeting}}" } },
    ],
    [
      { source: "trigger", target: "shape" },
      { source: "shape", target: "guard" },
      { source: "guard", target: "after" },
    ],
  );
}

test("a retry starts at the failed step and does not execute the steps before it again", async () => {
  const failed = await execute(guarded(false), { input: { name: "Ada" } });
  assert.equal(failed.status, "failed");

  const retry = planned(plan(guarded(false), failed.steps, guarded(true)));
  assert.equal(retry.from, "guard");
  assert.deepEqual(
    retry.reused.map((step) => [step.nodeId, step.status]),
    [["trigger", "reused"], ["shape", "reused"]],
  );
  assert.deepEqual(retry.cursor.queue, [{ nodeId: "guard", fromSeq: 1 }]);
  assert.deepEqual(retry.cursor.executions, { trigger: 1, shape: 1 });
  assert.equal(retry.cursor.seq, 2);

  const { recorder, started } = recording();
  const resumed = await execute(guarded(true), {
    input: { name: "Ada" },
    recorder,
    resume: { cursor: retry.cursor, steps: retry.reused },
  });

  assert.equal(resumed.status, "succeeded");
  // **The count the phase asks for**: only the failed step and what follows it were executed.
  assert.deepEqual(started.map((step) => step.nodeId), ["guard", "after"]);
  // The failed step was fed what the original's upstream step produced — read out of the reused
  // copy, not the original run — and a reference further back resolved against it too.
  const guard = resumed.steps.find((step) => step.nodeId === "guard")!;
  assert.deepEqual(guard.input, { greeting: "hello Ada" });
  assert.equal(guard.seq, 2);
  assert.equal(guard.iteration, 0);
  const after = resumed.steps.find((step) => step.nodeId === "after")!;
  assert.ok(after.logs.some((log) => log.message.includes("hello Ada")), JSON.stringify(after.logs));
});

test("a reused step keeps what it did and drops when it did it", async () => {
  const failed = await execute(guarded(false), { input: { name: "Ada" } });
  const original = failed.steps.find((step) => step.nodeId === "shape")!;
  const [, shape] = planned(plan(guarded(false), failed.steps)).reused;

  assert.equal(shape.status, "reused");
  assert.deepEqual(shape.output, original.output);
  assert.deepEqual(shape.input, original.input);
  assert.deepEqual(shape.config, original.config);
  assert.deepEqual(shape.logs, original.logs);
  // It ran in the original, not here: no time was spent on it in the retry, and analytics
  // measures a node's latency only from steps with both timestamps.
  assert.equal(shape.startedAt, null);
  assert.equal(shape.finishedAt, null);
  assert.notEqual(original.startedAt, null);
});

/** trigger → check → happy | sad, where the taken side fails until fixed. */
function branched(fixed: boolean): WorkflowGraph {
  return graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "check", type: "core.branch", config: { left: "{{input.status}}", operator: "equals", right: "ok" } },
      {
        id: "happy",
        type: "core.assert",
        config: { left: fixed ? "yes" : "", operator: "is_not_empty", message: "Happy path is not ready." },
      },
      { id: "sad", type: "core.log", config: { message: "status was not ok" } },
    ],
    [
      { source: "trigger", target: "check" },
      { source: "check", target: "happy", sourceHandle: "true" },
      { source: "check", target: "sad", sourceHandle: "false" },
    ],
  );
}

test("a retry follows the branch the original took, and the other side is still skipped", async () => {
  const failed = await execute(branched(false), { input: { status: "ok" } });
  assert.equal(failed.status, "failed");

  const retry = planned(plan(branched(false), failed.steps, branched(true)));
  assert.deepEqual(retry.cursor.queue, [{ nodeId: "happy", fromSeq: 1 }]);

  const { recorder, started } = recording();
  const resumed = await execute(branched(true), {
    input: { status: "ok" },
    recorder,
    resume: { cursor: retry.cursor, steps: retry.reused },
  });

  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(started.map((step) => step.nodeId), ["happy"]);
  assert.equal(resumed.steps.find((step) => step.nodeId === "sad")?.status, "skipped");
  assert.equal(resumed.steps.find((step) => step.nodeId === "check")?.status, "reused");
});

/** trigger fans out to a then b; a fails before b ever runs. */
function fanned(fixed: boolean): WorkflowGraph {
  return graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "a", type: "core.assert", config: { left: fixed ? "x" : "", operator: "is_not_empty" } },
      { id: "b", type: "core.log", config: { message: "b ran" } },
    ],
    [
      { source: "trigger", target: "a" },
      { source: "trigger", target: "b" },
    ],
  );
}

test("work the original had queued behind the failure is not lost", async () => {
  const failed = await execute(fanned(false));
  assert.equal(failed.status, "failed");
  // The engine records `b` as skipped — it never got there — and its own cursor has lost `a`.
  assert.equal(failed.steps.find((step) => step.nodeId === "b")?.status, "skipped");

  const retry = planned(plan(fanned(false), failed.steps, fanned(true)));
  assert.deepEqual(retry.cursor.queue, [
    { nodeId: "a", fromSeq: 0 },
    { nodeId: "b", fromSeq: 0 },
  ]);

  const { recorder, started } = recording();
  const resumed = await execute(fanned(true), { recorder, resume: { cursor: retry.cursor, steps: retry.reused } });
  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(started.map((step) => step.nodeId), ["a", "b"]);
});

test("a run that failed inside a loop carries on from the pass that failed", async () => {
  // Fails on the second pass through the body: index 1.
  const looping = (fixed: boolean) => {
    const base = loopGraph(3);
    return {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "body"
          ? {
              ...node,
              type: "core.assert",
              config: fixed
                ? { left: "{{input.index}}", operator: "less_than", right: 10 }
                : { left: "{{input.index}}", operator: "less_than", right: 1, message: "Too far." },
            }
          : node,
      ),
    };
  };
  const original = looping(false);
  const failed = await execute(original);
  assert.equal(failed.status, "failed");

  const retry = planned(plan(original, failed.steps, looping(true)));
  assert.equal(retry.from, "body");
  assert.deepEqual(retry.cursor.executions, { trigger: 1, each: 2, body: 1 });

  const { recorder, started } = recording();
  const resumed = await execute(looping(true), { recorder, resume: { cursor: retry.cursor, steps: retry.reused } });
  assert.equal(resumed.status, "succeeded");
  // The second body pass, the third loop pass and body, the loop's done, and after — never the
  // first pass again.
  assert.deepEqual(started.map((step) => `${step.nodeId}#${step.iteration}`), [
    "body#1",
    "each#2",
    "body#2",
    "each#3",
    "after#0",
  ]);
});

test("a switched-off step is replayed the way the engine took it", async () => {
  const offGraph = (fixed: boolean): WorkflowGraph => {
    const base = guarded(fixed);
    return { ...base, nodes: base.nodes.map((node) => (node.id === "shape" ? { ...node, disabled: true } : node)) };
  };
  const failed = await execute(offGraph(false), { input: { name: "Ada" } });
  assert.equal(failed.steps.find((step) => step.nodeId === "shape")?.status, "disabled");

  const retry = planned(plan(offGraph(false), failed.steps, offGraph(true)));
  // It never ran in either run, so it stays `disabled` rather than becoming `reused`.
  assert.equal(retry.reused[1].status, "disabled");
  assert.deepEqual(retry.cursor.queue, [{ nodeId: "guard", fromSeq: 1 }]);
});

test("a retry of a retry replays its reused steps like the steps they stand for", async () => {
  // Still failing after the first retry: the config was not fixed.
  const failed = await execute(guarded(false), { input: { name: "Ada" } });
  const first = planned(plan(guarded(false), failed.steps));
  const again = await execute(guarded(false), {
    input: { name: "Ada" },
    resume: { cursor: first.cursor, steps: first.reused },
  });
  assert.equal(again.status, "failed");

  const second = planned(plan(guarded(false), again.steps, guarded(true)));
  assert.deepEqual(second.reused.map((step) => step.status), ["reused", "reused"]);
  assert.deepEqual(second.cursor, first.cursor);
});

test("a run that stopped between steps carries on from what it had queued", async () => {
  // Out of time before the guard started: no failed step at all.
  const steps: StepRecord[] = [
    stepOf({ seq: 0, nodeId: "trigger", nodeType: "core.manual_trigger", output: { name: "Ada" } }),
    stepOf({ seq: 1, nodeId: "shape", nodeType: "core.set", output: { greeting: "hello Ada" } }),
    stepOf({ seq: 2, nodeId: "guard", nodeType: "core.assert", status: "skipped" }),
    stepOf({ seq: 3, nodeId: "after", nodeType: "core.log", status: "skipped" }),
  ];
  const retry = planned(plan(guarded(true), steps));
  assert.deepEqual(retry.cursor.queue, [{ nodeId: "guard", fromSeq: 1 }]);
  assert.equal(retry.cursor.seq, 2);
});

test("a step the sweeper closed mid-flight is where a retry starts", async () => {
  const steps: StepRecord[] = [
    stepOf({ seq: 0, nodeId: "trigger", nodeType: "core.manual_trigger", output: {} }),
    stepOf({ seq: 1, nodeId: "shape", nodeType: "core.set", status: "running", output: null }),
  ];
  const retry = planned(plan(guarded(true), steps));
  assert.equal(retry.from, "shape");
  assert.deepEqual(retry.reused.map((step) => step.nodeId), ["trigger"]);
  assert.equal(retry.cursor.seq, 1);
});

test("a run that failed before its first step retries from the trigger, reusing nothing", () => {
  const retry = planned(plan(guarded(true), []));
  assert.deepEqual(retry.reused, []);
  assert.deepEqual(retry.cursor, { queue: [{ nodeId: "trigger", fromSeq: null }], executions: {}, seq: 0 });
});

test("a retry is refused when the step it would start at is gone from the workflow", async () => {
  const failed = await execute(guarded(false), { input: { name: "Ada" } });
  const without = guarded(true);
  const current = {
    ...without,
    nodes: without.nodes.filter((node) => node.id !== "guard"),
    edges: without.edges.filter((edge) => edge.source !== "guard" && edge.target !== "guard"),
  };
  const refused = plan(guarded(false), failed.steps, current);
  assert.ok("refused" in refused);
  assert.equal(refused.refused, "node_gone");
  assert.match(refused.message, /"guard" is no longer in the workflow/);
});

test("a history that does not replay on the graph is refused, never guessed at", async () => {
  const failed = await execute(guarded(false), { input: { name: "Ada" } });
  // The graph it "ran" — say the snapshot was pruned and the live graph rewired since.
  const rewired = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "guard", type: "core.assert", config: { left: "x", operator: "is_not_empty" } },
      { id: "shape", type: "core.set", config: { fields: {} } },
    ],
    [
      { source: "trigger", target: "guard" },
      { source: "guard", target: "shape" },
    ],
  );
  const refused = plan(rewired, failed.steps);
  assert.ok("refused" in refused);
  assert.equal(refused.refused, "history_mismatch");
});

test("a run whose every reached step finished has nothing to retry", () => {
  const steps: StepRecord[] = [
    stepOf({ seq: 0, nodeId: "trigger", nodeType: "core.manual_trigger", output: {} }),
    stepOf({ seq: 1, nodeId: "shape", nodeType: "core.set", output: {} }),
    stepOf({ seq: 2, nodeId: "guard", nodeType: "core.assert", output: {} }),
    stepOf({ seq: 3, nodeId: "after", nodeType: "core.log", output: {} }),
  ];
  const refused = plan(guarded(true), steps);
  assert.ok("refused" in refused);
  assert.equal(refused.refused, "nothing_left");
});

test("only a finished run may be started again", () => {
  assert.deepEqual(
    ["queued", "running", "waiting", "succeeded", "failed", "cancelled"].filter(rerunnable),
    ["succeeded", "failed", "cancelled"],
  );
});

function stepOf(overrides: Partial<StepRecord> & Pick<StepRecord, "seq" | "nodeId" | "nodeType">): StepRecord {
  return {
    iteration: 0,
    status: "succeeded",
    config: null,
    input: null,
    output: null,
    branch: null,
    logs: [],
    error: null,
    startedAt: "2026-10-08T00:00:00.000Z",
    finishedAt: "2026-10-08T00:00:01.000Z",
    ...overrides,
  };
}
