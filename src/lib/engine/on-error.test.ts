import assert from "node:assert/strict";
import { test } from "node:test";

import { getNode } from "@/lib/nodes";
import type { WorkflowGraph } from "@/lib/workflow/graph";

import { rehydrate, type RunCursor } from "./cursor";
import { executeWorkflow } from "./execute";
import { graph, TEST_SCOPE } from "./fixtures";
import { ERROR_HANDLE, nodePolicySchema, onErrorOf, outputsOf, readPolicy, type NodePolicy } from "./policy";
import { planRetry, type RetryPlan, type RetryRefusal } from "./retry";
import { CHECKPOINT_OK, type RunRecorder, type StepRecord } from "./types";
import { validateGraph } from "./validate";

/**
 * **The on-error policy — Phase 37, `CONTRACT.md` → *On-error policy* (D173–D175).** The contract's
 * clauses, one by one, against the real engine:
 *
 *  - `stop` — and absent — fails the run, as every run did before this phase
 *  - `continue` records the step `handled` and carries on out of the default output with the error
 *    as the node's output; a node with no default output stops its path there
 *  - `route` leaves by Error; with nothing connected to Error the run fails
 *  - retries are spent first; a trigger always stops
 *  - the Error handle exists only while the policy routes (validation)
 *  - a resumed run and a retry read a handled step as the value it handed on
 */

function recording() {
  const started: StepRecord[] = [];
  const finished: StepRecord[] = [];
  const recorder: RunRecorder = {
    stepStarted: (step) => {
      started.push({ ...step });
    },
    stepFinished: (step) => {
      finished.push({ ...step, logs: [...step.logs] });
    },
    checkpoint: () => CHECKPOINT_OK,
  };
  return { recorder, started, finished };
}

const run = (
  graphToRun: WorkflowGraph,
  options: { input?: unknown; recorder?: RunRecorder; resume?: { cursor: RunCursor; steps: readonly StepRecord[] } } = {},
) =>
  executeWorkflow({
    runId: "run_test",
    workflowId: "wf_test",
    scope: TEST_SCOPE,
    graph: graphToRun,
    input: options.input,
    recorder: options.recorder,
    resume: options.resume,
  });

/** The same graph with this node's policy set. */
function withPolicy(source: WorkflowGraph, nodeId: string, policy: Partial<NodePolicy>): WorkflowGraph {
  return {
    ...source,
    nodes: source.nodes.map((node) =>
      node.id === nodeId ? { ...node, policy: nodePolicySchema.parse({ ...node.policy, ...policy }) } : node,
    ),
  };
}

const only = (steps: readonly StepRecord[], nodeId: string) => {
  const found = steps.filter((step) => step.nodeId === nodeId);
  assert.equal(found.length, 1, `exactly one step for ${nodeId}`);
  return found[0];
};

/**
 * trigger → guard (an assert that fails) → after, and guard's Error output → alert.
 * `after` reads what guard handed on; `alert` reads the error.
 */
const guarded = (options: { errorEdge?: boolean } = {}): WorkflowGraph =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      {
        id: "guard",
        type: "core.assert",
        config: { left: "{{input.total}}", operator: "is_not_empty", message: "No total on the order." },
      },
      { id: "after", type: "core.log", config: { message: "after: {{input.error}}" } },
      { id: "alert", type: "core.log", config: { message: "alert: {{steps.guard.output.error}}" } },
    ],
    [
      { source: "trigger", target: "guard" },
      { source: "guard", target: "after" },
      ...(options.errorEdge === false ? [] : [{ source: "guard", target: "alert", sourceHandle: ERROR_HANDLE }]),
    ],
  );

/* ------------------------------------------------------------------ *
 * stop — the default, unchanged
 * ------------------------------------------------------------------ */

test("with no policy a failure fails the run, exactly as before Phase 37", async () => {
  // No Error edge: a graph without a routing policy may not have one.
  const outcome = await run(guarded({ errorEdge: false }), { input: {} });
  assert.equal(outcome.status, "failed");
  assert.equal(only(outcome.steps, "guard").status, "failed");
  assert.equal(only(outcome.steps, "after").status, "skipped");
  assert.match(outcome.error ?? "", /No total on the order/);
});

test("stop, said out loud, is the same as saying nothing", async () => {
  const outcome = await run(withPolicy(guarded({ errorEdge: false }), "guard", { onError: "stop" }), { input: {} });
  assert.equal(outcome.status, "failed");
  assert.equal(only(outcome.steps, "guard").status, "failed");
});

/* ------------------------------------------------------------------ *
 * continue
 * ------------------------------------------------------------------ */

test("continue records the step handled and carries on with the error as its output", async () => {
  const graphToRun = withPolicy(guarded({ errorEdge: false }), "guard", { onError: "continue" });
  const outcome = await run(graphToRun, { input: {} });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.error, null);

  const guard = only(outcome.steps, "guard");
  assert.equal(guard.status, "handled");
  assert.equal(guard.error, "No total on the order.");
  assert.deepEqual(guard.output, { error: "No total on the order.", nodeId: "guard" });
  assert.equal(guard.branch, null);
  assert.ok(guard.startedAt && guard.finishedAt, "it ran, so it has timestamps");
  assert.ok(guard.logs.some((line) => line.level === "warn" && /carried the run on/.test(line.message)));

  // The next node received the error as its input.
  const after = only(outcome.steps, "after");
  assert.equal(after.status, "succeeded");
  assert.deepEqual(after.input, { error: "No total on the order.", nodeId: "guard" });
  assert.equal((after.config as { message: string }).message, "after: No total on the order.");
});

test("continue on a node that chooses the run's way stops its path, and the run still succeeds", async () => {
  // D133's rule for the same question: a Branch has no neutral exit. Its config fails at run time
  // (the operator is a reference that resolves to nothing it knows), so validation cannot see it.
  const graphToRun = withPolicy(
    graph(
      [
        { id: "trigger", type: "core.manual_trigger" },
        { id: "check", type: "core.branch", config: { left: "x", operator: "{{input.op}}", right: "x" } },
        { id: "yes", type: "core.log", config: { message: "yes" } },
        { id: "no", type: "core.log", config: { message: "no" } },
        { id: "also", type: "core.log", config: { message: "a parallel path still runs" } },
      ],
      [
        { source: "trigger", target: "check" },
        { source: "trigger", target: "also" },
        { source: "check", target: "yes", sourceHandle: "true" },
        { source: "check", target: "no", sourceHandle: "false" },
      ],
    ),
    "check",
    { onError: "continue" },
  );
  assert.equal(validateGraph(graphToRun).valid, true);

  const outcome = await run(graphToRun, { input: { op: "bogus" } });
  assert.equal(outcome.status, "succeeded");
  const check = only(outcome.steps, "check");
  assert.equal(check.status, "handled");
  assert.match(check.error ?? "", /Invalid config/);
  assert.ok(check.logs.some((line) => /no default output/.test(line.message)));
  assert.equal(only(outcome.steps, "yes").status, "skipped");
  assert.equal(only(outcome.steps, "no").status, "skipped");
  assert.equal(only(outcome.steps, "also").status, "succeeded");
});

test("a node's retries are spent before its on-error policy answers", async () => {
  const graphToRun = withPolicy(guarded({ errorEdge: false }), "guard", {
    onError: "continue",
    retries: 2,
    backoffMs: 0,
  });
  const { recorder, started } = recording();
  const outcome = await run(graphToRun, { input: {}, recorder });

  const guard = only(outcome.steps, "guard");
  assert.equal(guard.status, "handled");
  // One step that took three attempts — not three steps.
  assert.equal(started.filter((step) => step.nodeId === "guard").length, 1);
  assert.equal(guard.logs.filter((line) => /^Attempt \d failed/.test(line.message)).length, 2);
});

/* ------------------------------------------------------------------ *
 * route
 * ------------------------------------------------------------------ */

test("route sends a failure down Error, and the default path is not taken", async () => {
  const graphToRun = withPolicy(guarded(), "guard", { onError: "route" });
  assert.equal(validateGraph(graphToRun).valid, true, "an Error edge is legal while the policy routes");

  const outcome = await run(graphToRun, { input: {} });
  assert.equal(outcome.status, "succeeded");

  const guard = only(outcome.steps, "guard");
  assert.equal(guard.status, "handled");
  assert.equal(guard.branch, ERROR_HANDLE);
  assert.ok(guard.logs.some((line) => /Error output/.test(line.message)));

  const alert = only(outcome.steps, "alert");
  assert.equal(alert.status, "succeeded");
  assert.equal((alert.config as { message: string }).message, "alert: No total on the order.");
  assert.equal(only(outcome.steps, "after").status, "skipped");
});

test("route on a node that succeeds takes the default path, and Error is not taken", async () => {
  const graphToRun = withPolicy(guarded(), "guard", { onError: "route" });
  const outcome = await run(graphToRun, { input: { total: 42 } });

  assert.equal(outcome.status, "succeeded");
  assert.equal(only(outcome.steps, "guard").status, "succeeded");
  assert.equal(only(outcome.steps, "after").status, "succeeded");
  assert.equal(only(outcome.steps, "alert").status, "skipped");
});

test("route with nothing connected to Error fails the run — the failure had nowhere to go", async () => {
  const graphToRun = withPolicy(guarded({ errorEdge: false }), "guard", { onError: "route" });
  const outcome = await run(graphToRun, { input: {} });

  assert.equal(outcome.status, "failed");
  const guard = only(outcome.steps, "guard");
  assert.equal(guard.status, "failed");
  assert.ok(guard.logs.some((line) => /nothing is connected to its Error output/.test(line.message)));
});

test("a trigger always stops, whatever its stored policy says", async () => {
  // The inspector never offers the choice on a trigger, but a graph can be imported or written
  // by hand. A required manual field that is missing fails the trigger.
  const graphToRun = withPolicy(
    graph(
      [
        {
          id: "trigger",
          type: "core.manual_trigger",
          config: { fields: [{ name: "email", type: "text", required: true }] },
        },
        { id: "say", type: "core.log", config: { message: "hi" } },
      ],
      [{ source: "trigger", target: "say" }],
    ),
    "trigger",
    { onError: "continue" },
  );
  const outcome = await run(graphToRun, { input: {} });
  assert.equal(outcome.status, "failed");
  assert.equal(only(outcome.steps, "trigger").status, "failed");
  assert.equal(onErrorOf(readPolicy({ onError: "route" }), "trigger"), "stop");
});

/* ------------------------------------------------------------------ *
 * The Error handle — D174
 * ------------------------------------------------------------------ */

test("a node has an Error output only while its policy routes", () => {
  const assertNode = getNode("core.assert")!;
  assert.deepEqual(
    outputsOf(assertNode, undefined).map((output) => output.key),
    [null],
  );
  assert.deepEqual(
    outputsOf(assertNode, { onError: "continue" }).map((output) => output.key),
    [null],
  );
  assert.deepEqual(
    outputsOf(assertNode, { onError: "route" }).map((output) => output.key),
    [null, ERROR_HANDLE],
  );
  // After the node's own: a Branch keeps true and false first.
  assert.deepEqual(
    outputsOf(getNode("core.branch")!, { onError: "route" }).map((output) => output.key),
    ["true", "false", ERROR_HANDLE],
  );
  // Never on a trigger.
  assert.deepEqual(
    outputsOf(getNode("core.webhook_trigger")!, { onError: "route" }).map((output) => output.key),
    [null],
  );
});

test("an edge left on Error after the policy changed is a problem that says what to do", () => {
  const problems = validateGraph(guarded()).problems;
  const handle = problems.find((problem) => problem.code === "unknown_output_handle");
  assert.ok(handle, "an Error edge on a node that does not route is refused");
  assert.match(handle.message, /only while its on-error policy is "route"/);
});

test("an unreadable onError is the default — stop — never something more permissive", () => {
  assert.equal(readPolicy({ onError: "ignore" }).onError, undefined);
  assert.equal(onErrorOf(readPolicy({ onError: "ignore" }), "action"), "stop");
  assert.equal(nodePolicySchema.safeParse({ onError: "swallow" }).success, false);
});

test("absent stays absent: a policy with no onError gains none when it is read", () => {
  // Every graph saved before Phase 37 must read exactly as it was stored, or it would show as
  // unsaved the moment it loaded.
  assert.equal("onError" in nodePolicySchema.parse({ retries: 1 }), false);
});

/* ------------------------------------------------------------------ *
 * Resume and retry read a handled step as what it handed on
 * ------------------------------------------------------------------ */

test("a resumed run reads a handled step's error as that node's output", () => {
  const steps: StepRecord[] = [
    {
      seq: 0, nodeId: "trigger", nodeType: "core.manual_trigger", iteration: 0, status: "succeeded",
      config: {}, input: {}, output: {}, branch: null, logs: [], error: null,
      startedAt: "2026-10-09T00:00:00.000Z", finishedAt: "2026-10-09T00:00:00.010Z",
    },
    {
      seq: 1, nodeId: "guard", nodeType: "core.assert", iteration: 0, status: "handled",
      config: {}, input: {}, output: { error: "No total on the order.", nodeId: "guard" }, branch: ERROR_HANDLE,
      logs: [], error: "No total on the order.",
      startedAt: "2026-10-09T00:00:00.010Z", finishedAt: "2026-10-09T00:00:00.020Z",
    },
  ];
  const state = rehydrate({ queue: [{ nodeId: "alert", fromSeq: 1 }], executions: { trigger: 1, guard: 1 }, seq: 2 }, steps);
  assert.deepEqual(state.outputs.get("guard"), { error: "No total on the order.", nodeId: "guard" });
  assert.deepEqual(state.bySeq.get(1), { error: "No total on the order.", nodeId: "guard" });
});

test("a retry carries a handled step over as reused, along the output it left by, and starts at the real failure", async () => {
  // trigger → guard (handled, routed) → alert, where alert is a step that then fails. A retry must
  // reuse the guard step — not run it again — and follow its Error branch to start at alert.
  const original = withPolicy(
    graph(
      [
        { id: "trigger", type: "core.manual_trigger" },
        { id: "guard", type: "core.assert", config: { left: "{{input.total}}", message: "No total." } },
        { id: "after", type: "core.log", config: { message: "fine" } },
        { id: "alert", type: "core.assert", config: { left: "{{input.channel}}", message: "No channel to alert." } },
      ],
      [
        { source: "trigger", target: "guard" },
        { source: "guard", target: "after" },
        { source: "guard", target: "alert", sourceHandle: ERROR_HANDLE },
      ],
    ),
    "guard",
    { onError: "route" },
  );
  const failed = await run(original, { input: {} });
  assert.equal(failed.status, "failed");
  assert.equal(only(failed.steps, "guard").status, "handled");
  assert.equal(only(failed.steps, "alert").status, "failed");

  const result: RetryPlan | RetryRefusal = planRetry({
    original,
    current: original,
    triggerNodeId: "trigger",
    steps: failed.steps,
    passesThrough: (type) => getNode(type)?.outputs.some((output) => output.key === null) ?? false,
  });
  if ("refused" in result) assert.fail(result.message);
  assert.equal(result.from, "alert");
  const carriedGuard = result.reused.find((step) => step.nodeId === "guard")!;
  assert.equal(carriedGuard.status, "reused");
  assert.equal(carriedGuard.branch, ERROR_HANDLE);
  assert.deepEqual(result.cursor.queue[0], { nodeId: "alert", fromSeq: carriedGuard.seq });
});
