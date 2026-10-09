import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkflowGraph } from "@/lib/workflow/graph";

import { rehydrate } from "./cursor";
import { executeWorkflow, GraphInvalidError } from "./execute";
import { branchGraph, graph, sequentialGraph, TEST_SCOPE } from "./fixtures";
import type { RunTest } from "./partial";
import type { StepRecord } from "./types";

/**
 * **Pinned output and partial runs — Phase 31, `CONTRACT.md` → *Pinned output* and *Partial
 * runs*.** The clauses, one test each:
 *
 *  - a pin is honoured by a test run, and **only** by a test run
 *  - a pinned step is `pinned`, never executed, and hands its pin on
 *  - a pin on a node with no default output is not honoured
 *  - a pinned trigger is what `{{trigger.…}}` reads
 *  - *test up to here* runs the way to the target and stops there; the target always executes
 *  - *test this node* runs one node, fed from its seed
 *  - a test needs only the nodes it executes to be well configured
 *  - a test of part of a workflow does not pause
 */

const run = (
  graphToRun: WorkflowGraph,
  options: {
    input?: unknown;
    test?: RunTest | null;
    seed?: { input: unknown; outputs: ReadonlyMap<string, unknown>; trigger: unknown };
    allowWait?: boolean;
  } = {},
) =>
  executeWorkflow({
    runId: "run_test",
    workflowId: "wf_test",
    scope: TEST_SCOPE,
    graph: graphToRun,
    input: options.input,
    test: options.test,
    seed: options.seed,
    allowWait: options.allowWait,
  });

/** The same graph with `id` holding `output` as its pin. */
function pin(source: WorkflowGraph, id: string, output: unknown): WorkflowGraph {
  return {
    ...source,
    nodes: source.nodes.map((node) => (node.id === id ? { ...node, pinned: { output } } : node)),
  };
}

const stepOf = (steps: readonly StepRecord[], nodeId: string) =>
  steps.find((step) => step.nodeId === nodeId);

const WHOLE: RunTest = { scope: "workflow", nodeId: null };

/* ------------------------------------------------------------------ *
 * Pins
 * ------------------------------------------------------------------ */

test("a test run uses a pinned output instead of running the node", async () => {
  const pinned = pin(sequentialGraph(), "shape", { greeting: "from the pin" });
  const outcome = await run(pinned, { input: { name: "Arunish" }, test: WHOLE });

  assert.equal(outcome.status, "succeeded");
  const shape = stepOf(outcome.steps, "shape")!;
  assert.equal(shape.status, "pinned");
  assert.deepEqual(shape.output, { greeting: "from the pin" });
  assert.deepEqual(shape.input, { name: "Arunish" }, "what arrived is still recorded");
  assert.equal(shape.config, null, "its config was never resolved");
  assert.equal(shape.startedAt, null);
  assert.equal(shape.finishedAt, null);
  assert.match(shape.logs[0].message, /Pinned — not run/);

  // `say` logs `{{input.greeting}}` — the pin's value, not `set`'s "hello Arunish".
  const say = stepOf(outcome.steps, "say")!;
  assert.equal(say.status, "succeeded");
  assert.deepEqual(say.input, { greeting: "from the pin" });
});

test("a run that is not a test ignores every pin and executes the node for real", async () => {
  // The safety property the whole feature rests on: a webhook or a schedule run is not a
  // test, and a pinned node silently not running in production is the worst failure here.
  const pinned = pin(sequentialGraph(), "shape", { greeting: "from the pin" });
  for (const test of [undefined, null]) {
    const outcome = await run(pinned, { input: { name: "Arunish" }, test });
    const shape = stepOf(outcome.steps, "shape")!;
    assert.equal(shape.status, "succeeded");
    assert.deepEqual(shape.output, { greeting: "hello Arunish", count: 2 });
    assert.ok(!outcome.steps.some((step) => step.status === "pinned"));
  }
});

test("a pin on a node with no default output is not honoured — a branch still decides", async () => {
  // A branch's job is choosing a way, and a pin has no way to choose. Its pin is ignored.
  const pinned = pin(branchGraph(), "check", { anything: true });
  const outcome = await run(pinned, { input: { status: "ok" }, test: WHOLE });
  const check = stepOf(outcome.steps, "check")!;
  assert.equal(check.status, "succeeded");
  assert.equal(check.branch, "true");
  assert.equal(stepOf(outcome.steps, "happy")!.status, "succeeded");
});

test("a switched-off node stays switched off, pin or not", async () => {
  const source = pin(sequentialGraph(), "shape", { greeting: "pin" });
  const off: WorkflowGraph = {
    ...source,
    nodes: source.nodes.map((node) => (node.id === "shape" ? { ...node, disabled: true } : node)),
  };
  const outcome = await run(off, { input: { name: "A" }, test: WHOLE });
  assert.equal(stepOf(outcome.steps, "shape")!.status, "disabled");
  assert.deepEqual(stepOf(outcome.steps, "say")!.input, { name: "A" });
});

test("a pinned trigger is what {{trigger.…}} reads, so its step and a reference agree", async () => {
  const source = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "shape", type: "core.set", config: { fields: { who: "{{trigger.name}}" } } },
    ],
    [{ source: "trigger", target: "shape" }],
  );
  const outcome = await run(pin(source, "trigger", { name: "from the pin" }), {
    input: { name: "typed" },
    test: WHOLE,
  });

  const trigger = stepOf(outcome.steps, "trigger")!;
  assert.equal(trigger.status, "pinned");
  assert.deepEqual(trigger.input, { name: "typed" });
  assert.deepEqual(stepOf(outcome.steps, "shape")!.output, { who: "from the pin" });
});

test("a resumed test run reads a pinned step's output back like a succeeded one", () => {
  const steps: StepRecord[] = [
    { seq: 0, nodeId: "trigger", nodeType: "core.manual_trigger", iteration: 0, status: "succeeded", config: {}, input: null, output: { a: 1 }, branch: null, logs: [], error: null, startedAt: "2026-10-08T00:00:00.000Z", finishedAt: "2026-10-08T00:00:00.000Z" },
    { seq: 1, nodeId: "shape", nodeType: "core.set", iteration: 0, status: "pinned", config: null, input: { a: 1 }, output: { pinned: true }, branch: null, logs: [], error: null, startedAt: null, finishedAt: null },
  ];
  const state = rehydrate({ queue: [{ nodeId: "say", fromSeq: 1 }], executions: { trigger: 1, shape: 1 }, seq: 2 }, steps);
  assert.deepEqual(state.bySeq.get(1), { pinned: true });
  assert.deepEqual(state.outputs.get("shape"), { pinned: true });
  assert.deepEqual(state.lastOutput, { pinned: true });
});

/* ------------------------------------------------------------------ *
 * Test up to here
 * ------------------------------------------------------------------ */

/** trigger → shape → say → after, plus a side node off the trigger. */
const fourNodes = () =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "shape", type: "core.set", config: { fields: { greeting: "hello {{input.name}}" } } },
      { id: "say", type: "core.log", config: { message: "{{input.greeting}}" } },
      { id: "after", type: "core.log", config: { message: "after" } },
      { id: "side", type: "core.log", config: { message: "side" } },
    ],
    [
      { source: "trigger", target: "shape" },
      { source: "shape", target: "say" },
      { source: "say", target: "after" },
      { source: "trigger", target: "side" },
    ],
  );

test("test up to here runs the way to the node, stops there, and records nothing outside it", async () => {
  const outcome = await run(fourNodes(), {
    input: { name: "A" },
    test: { scope: "path", nodeId: "say" },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(
    outcome.steps.map((step) => [step.nodeId, step.status]),
    [
      ["trigger", "succeeded"],
      ["shape", "succeeded"],
      ["say", "succeeded"],
    ],
    "`after` is past the target and `side` is not on the way to it — neither has a step",
  );
  assert.deepEqual(outcome.output, stepOf(outcome.steps, "say")!.output);
});

test("test up to here uses pins on the way, and always executes the node it is aimed at", async () => {
  let pinned = pin(fourNodes(), "shape", { greeting: "pinned hello" });
  pinned = pin(pinned, "say", { never: "used" });
  const outcome = await run(pinned, { input: { name: "A" }, test: { scope: "path", nodeId: "say" } });

  assert.equal(stepOf(outcome.steps, "shape")!.status, "pinned");
  const say = stepOf(outcome.steps, "say")!;
  assert.equal(say.status, "succeeded", "the target's own pin is not honoured");
  assert.deepEqual(say.input, { greeting: "pinned hello" });
});

test("a target the run never reaches is recorded skipped, with the untaken side", async () => {
  const outcome = await run(branchGraph(), {
    input: { status: "bad" },
    test: { scope: "path", nodeId: "happy" },
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(stepOf(outcome.steps, "happy")!.status, "skipped");
  assert.equal(stepOf(outcome.steps, "sad"), undefined, "`sad` is not on the way to `happy`");
});

/* ------------------------------------------------------------------ *
 * Test this node
 * ------------------------------------------------------------------ */

test("test this node runs exactly one node, fed from its seed", async () => {
  const outcome = await run(fourNodes(), {
    test: { scope: "node", nodeId: "say" },
    seed: {
      input: { greeting: "seeded" },
      outputs: new Map<string, unknown>([["shape", { greeting: "seeded" }], ["trigger", { name: "T" }]]),
      trigger: { name: "T" },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.steps.length, 1);
  const say = outcome.steps[0];
  assert.equal(say.nodeId, "say");
  assert.equal(say.seq, 0);
  assert.deepEqual(say.input, { greeting: "seeded" });
  assert.deepEqual(say.config, { message: "seeded", level: "info" });
});

test("a node tested alone resolves references to upstream nodes and the trigger from the seed", async () => {
  const source = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "fetch", type: "core.set", config: { fields: { body: "real" } } },
      { id: "shape", type: "core.set", config: { fields: { a: "{{steps.fetch.output.body}}", b: "{{trigger.name}}" } } },
    ],
    [
      { source: "trigger", target: "fetch" },
      { source: "fetch", target: "shape" },
    ],
  );
  const outcome = await run(source, {
    test: { scope: "node", nodeId: "shape" },
    seed: { input: { body: "from seed" }, outputs: new Map([["fetch", { body: "from seed" }]]), trigger: { name: "T" } },
  });
  assert.deepEqual(outcome.steps[0].output, { a: "from seed", b: "T" });
});

test("a node tested alone executes even when it holds a pin", async () => {
  const outcome = await run(pin(fourNodes(), "say", { never: "used" }), {
    test: { scope: "node", nodeId: "say" },
    seed: { input: { greeting: "x" }, outputs: new Map(), trigger: null },
  });
  assert.equal(outcome.steps[0].status, "succeeded");
});

test("testing a node that does not exist is refused", async () => {
  await assert.rejects(run(fourNodes(), { test: { scope: "node", nodeId: "ghost" } }), GraphInvalidError);
  await assert.rejects(run(fourNodes(), { test: { scope: "path", nodeId: "ghost" } }), GraphInvalidError);
});

/* ------------------------------------------------------------------ *
 * Validation and bounds
 * ------------------------------------------------------------------ */

/** fourNodes with `after` mis-configured. */
function brokenAfter(): WorkflowGraph {
  const source = fourNodes();
  return {
    ...source,
    // An unknown level. (It was `message: 42` until Phase 34 taught the Log node to log a number.)
    nodes: source.nodes.map((node) => (node.id === "after" ? { ...node, config: { level: "shout" } } : node)),
  };
}

test("a test needs only the nodes it executes to be well configured", async () => {
  // A full run refuses the graph; a test that never executes `after` does not.
  await assert.rejects(run(brokenAfter(), { input: { name: "A" } }), GraphInvalidError);
  const outcome = await run(brokenAfter(), { input: { name: "A" }, test: { scope: "path", nodeId: "say" } });
  assert.equal(outcome.status, "succeeded");

  // …and a pin standing in for a broken node excuses it too.
  const excused = await run(pin(brokenAfter(), "after", { ok: 1 }), { input: { name: "A" }, test: WHOLE });
  assert.equal(stepOf(excused.steps, "after")!.status, "pinned");

  // But aim the test at the broken node and it is refused, as it must be.
  await assert.rejects(
    run(brokenAfter(), { input: { name: "A" }, test: { scope: "path", nodeId: "after" } }),
    GraphInvalidError,
  );
});

test("a structural problem refuses every test, whatever its scope", async () => {
  const source = fourNodes();
  const dangling: WorkflowGraph = {
    ...source,
    edges: [...source.edges, { id: "bad", source: "after", target: "nowhere", sourceHandle: null }],
  };
  await assert.rejects(run(dangling, { test: { scope: "path", nodeId: "say" } }), GraphInvalidError);
});

test("a test of part of a workflow does not pause, and says what to do instead", async () => {
  const source = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "wait", type: "core.delay", config: { amount: 2, unit: "hours" } },
    ],
    [{ source: "trigger", target: "wait" }],
  );
  const outcome = await run(source, { test: { scope: "path", nodeId: "wait" }, allowWait: false });
  assert.equal(outcome.status, "failed");
  assert.match(stepOf(outcome.steps, "wait")!.error ?? "", /does not pause.*Pin this step's output/);
});
