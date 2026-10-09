import assert from "node:assert/strict";
import { test } from "node:test";

import { NodeError } from "@/lib/nodes/types";

import { executeWorkflow, MAX_STEPS } from "./execute";
import { graph, TEST_SCOPE } from "./fixtures";
import {
  type CallBudget,
  type CallRequest,
  type CallResult,
  type CallRunner,
  type Lineage,
  type RunOutcome,
} from "./types";

/**
 * **Phase 39's call door in the engine** (`CONTRACT.md` → *Calling a workflow*, D185).
 *
 * The engine does not decide whether a call may happen — `run.ts` does, against the database — but
 * it owns three things that make a call safe, and they are tested here against a fake runner:
 * the **budget** a call is given (depth, ancestors, the steps and clock left), **charging** what the
 * callee used against the caller's own steps, and a called workflow's **inability to pause**. What
 * the database-backed half does — workspace, visibility, the run rows — is verified on the deployed
 * service by `scripts/verify-api.mjs`, where those exist.
 */

const caller = (config: Record<string, unknown> = { workflowId: "child" }, extra: Array<{ id: string; type: string; config?: Record<string, unknown> }> = []) =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "call", type: "core.call_workflow", config },
      { id: "after", type: "core.log", config: { message: "got {{input.output.total}}" } },
      ...extra,
    ],
    [
      { source: "trigger", target: "call" },
      { source: "call", target: "after" },
    ],
  );

function fakeRunner(
  answer: (request: CallRequest, budget: CallBudget) => CallResult | Promise<CallResult>,
) {
  const calls: Array<{ request: CallRequest; budget: CallBudget }> = [];
  const runner: CallRunner = {
    call: async (request, budget) => {
      calls.push({ request, budget });
      return answer(request, budget);
    },
    tools: async () => [],
  };
  return { runner, calls };
}

const result = (steps = 3): CallResult => ({
  runId: "child-run-1",
  workflowId: "child",
  workflowName: "Totals",
  output: { total: 42 },
  steps,
});

const run = (
  g: ReturnType<typeof graph>,
  options: { calls?: CallRunner; input?: unknown; lineage?: Lineage; deadlineMs?: number; allowWait?: boolean } = {},
): Promise<RunOutcome> =>
  executeWorkflow({
    runId: "run_parent",
    workflowId: "wf_parent",
    scope: TEST_SCOPE,
    graph: g,
    input: options.input ?? { name: "Ada" },
    calls: options.calls,
    lineage: options.lineage,
    deadlineMs: options.deadlineMs,
    allowWait: options.allowWait,
  });

test("a call node hands the called workflow its input and carries on with what it returned", async () => {
  const { runner, calls } = fakeRunner(() => result());
  const outcome = await run(caller(), { calls: runner });

  assert.equal(outcome.status, "succeeded", outcome.error ?? "");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.request, { workflowId: "child", input: { name: "Ada" }, via: "node", nodeId: "call" });

  const step = outcome.steps.find((candidate) => candidate.nodeId === "call")!;
  assert.deepEqual(step.output, { output: { total: 42 }, runId: "child-run-1", workflowId: "child", workflow: "Totals" });
  // The step after it reads the callee's output through the node's output.
  assert.equal((outcome.steps.find((candidate) => candidate.nodeId === "after")!.config as { message: string }).message, "got 42");
});

test("a mapped Input is what the called workflow is started with, and an unset one passes the node's input on", async () => {
  const { runner, calls } = fakeRunner(() => result());
  await run(caller({ workflowId: "child", input: { who: "{{input.name}}", plan: "pro" } }), { calls: runner });
  assert.deepEqual(calls[0]!.request.input, { who: "Ada", plan: "pro" });

  const unmapped = fakeRunner(() => result());
  await run(caller({ workflowId: "child" }), { calls: unmapped.runner, input: [1, 2, 3] });
  assert.deepEqual(unmapped.calls[0]!.request.input, [1, 2, 3]);
});

test("a call is given a place one level down the tree, the ancestors above it, and what is left of the budget", async () => {
  const { runner, calls } = fakeRunner(() => result());
  await run(caller(), { calls: runner, deadlineMs: 90_000 });

  const budget = calls[0]!.budget;
  assert.equal(budget.depth, 1);
  assert.deepEqual([...budget.ancestors], ["wf_parent"], "the caller is the only ancestor of a first-level call");
  // trigger is step 0, `call` step 1 — two steps used when the call is made.
  assert.equal(budget.stepLimit, MAX_STEPS - 2);
  assert.ok(budget.deadlineMs <= 90_000 && budget.deadlineMs > 89_000, `deadline left: ${budget.deadlineMs}`);
  assert.equal(budget.signal.aborted, false);
});

test("a called workflow passes its own lineage down: one level deeper again, its ancestors in order", async () => {
  const { runner, calls } = fakeRunner(() => result());
  await run(caller(), {
    calls: runner,
    lineage: { depth: 2, ancestors: ["root", "middle", "wf_parent"], stepLimit: 50 },
  });
  const budget = calls[0]!.budget;
  assert.equal(budget.depth, 3);
  assert.deepEqual([...budget.ancestors], ["root", "middle", "wf_parent"]);
  assert.equal(budget.stepLimit, 50 - 2);
});

test("the steps a callee used are charged against the caller, and the tree stops at its limit", async () => {
  // The caller has used 2 steps (the trigger and the call); the callee reports 198 more. 2 + 198 = 200,
  // which is the whole tree's allowance, so the caller's next step is refused.
  const { runner } = fakeRunner(() => result(MAX_STEPS - 2));
  const outcome = await run(caller(), { calls: runner });

  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /maximum of 200 steps, counting the workflows it called/);
  assert.equal(outcome.charged, MAX_STEPS - 2);
  assert.ok(!outcome.steps.some((step) => step.nodeId === "after" && step.status === "succeeded"));
});

test("a second call is given only what the first left", async () => {
  const twice = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "first", type: "core.call_workflow", config: { workflowId: "child" } },
      { id: "second", type: "core.call_workflow", config: { workflowId: "child" } },
    ],
    [
      { source: "trigger", target: "first" },
      { source: "first", target: "second" },
    ],
  );
  const { runner, calls } = fakeRunner(() => result(40));
  const outcome = await run(twice, { calls: runner });

  assert.equal(outcome.status, "succeeded");
  assert.equal(calls[0]!.budget.stepLimit, MAX_STEPS - 2);
  // trigger + first = 2 steps of its own, plus 40 charged, plus `second` is the third step.
  assert.equal(calls[1]!.budget.stepLimit, MAX_STEPS - 3 - 40);
  assert.equal(outcome.charged, 80);
});

test("a run that calls nothing reports no charge", async () => {
  const outcome = await run(graph([{ id: "trigger", type: "core.manual_trigger" }], []));
  assert.equal(outcome.charged, undefined);
});

test("a called workflow that failed fails the step with its own words, and the caller's on-error policy can carry on", async () => {
  const failing = fakeRunner(() => {
    throw new NodeError("“Totals” failed: Needs a value. (run child-run-1)");
  });
  const stopped = await run(caller(), { calls: failing.runner });
  assert.equal(stopped.status, "failed");
  assert.match(stopped.error ?? "", /“Totals” failed: Needs a value\. \(run child-run-1\)/);

  const g = caller();
  g.nodes.find((node) => node.id === "call")!.policy = { retries: 0, backoffMs: 0, onError: "continue" };
  const carried = await run(g, { calls: failing.runner });
  assert.equal(carried.status, "succeeded", "the policy treats a failed call as it treats any failed step");
  assert.equal(carried.steps.find((step) => step.nodeId === "call")!.status, "handled");
});

test("without a runner, a call node fails its step saying nothing here can run a workflow", async () => {
  const outcome = await run(caller());
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /Nothing here can run another workflow/);
});

test("a workflow another one called cannot pause the run it is inside, and says why", async () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "nap", type: "core.delay", config: { amount: 1, unit: "minutes" } },
    ],
    [{ source: "trigger", target: "nap" }],
  );
  const outcome = await run(g, {
    lineage: { depth: 1, ancestors: ["root", "wf_parent"], stepLimit: MAX_STEPS },
    allowWait: false,
  });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /a workflow that another one calls runs inside that run and cannot pause it/);

  const approval = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "ask", type: "core.approval", config: { message: "Ok?", timeout: 1, timeoutUnit: "hours" } },
    ],
    [{ source: "trigger", target: "ask" }],
  );
  const asked = await run(approval, {
    lineage: { depth: 1, ancestors: ["root", "wf_parent"], stepLimit: MAX_STEPS },
    allowWait: false,
  });
  assert.equal(asked.status, "failed");
  assert.match(asked.error ?? "", /another one calls runs inside that run and cannot pause it/);
});

test("a called workflow out of its share of the tree's steps stops with a message about the tree", async () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "a", type: "core.log", config: { message: "a" } },
      { id: "b", type: "core.log", config: { message: "b" } },
    ],
    [
      { source: "trigger", target: "a" },
      { source: "a", target: "b" },
    ],
  );
  const outcome = await run(g, { lineage: { depth: 1, ancestors: ["root", "wf_parent"], stepLimit: 2 } });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /used up the 200 steps a call tree is allowed/);
});
