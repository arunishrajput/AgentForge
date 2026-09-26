import assert from "node:assert/strict";
import { test } from "node:test";

import type { LogLevel, NodeContext } from "@/lib/nodes/types";
import { NodeError } from "@/lib/nodes/types";

import { assertNode } from "./assert";
import { branchNode, evaluate } from "./branch";
import { delayNode, MAX_DELAY_MS } from "./delay";
import { HARD_MAX_ITERATIONS, loopNode } from "./loop";
import { setNode } from "./set";

/**
 * The control-flow core: branch, assert, loop, set, delay.
 *
 * These carry real weight for their size. `branch` decides which edge a run leaves
 * through, `loop` is the only legal cycle in a graph, and `assert` is the engine's
 * deterministic failure path — and all three are emitted by the *generator*, so their
 * inputs are a model's choices rather than a developer's. Phase 13 covers them because
 * Chapter 1's suite tested the engine that routes on their results without testing the
 * comparisons those results come from.
 */

function fakeContext(iteration = 0): NodeContext & {
  lines: Array<{ message: string; level: LogLevel }>;
} {
  const lines: Array<{ message: string; level: LogLevel }> = [];
  return {
    runId: "run-1",
    workflowId: "wf-1",
    ownerId: "owner-1",
    nodeId: "node-1",
    iteration,
    log: (message: string, level: LogLevel = "info") => lines.push({ message, level }),
    signal: new AbortController().signal,
    lines,
  };
}

const run = <T>(node: { execute: (args: never) => Promise<T> }, args: unknown) =>
  node.execute(args as never);

// --- branch: the comparison table ------------------------------------------------

test("equals is loose, because a config field is always a string", () => {
  // `{{input.count}}` resolves to the number 3; the configured right-hand side is the
  // string "3". A strict comparison here would make every generated branch wrong.
  assert.equal(evaluate("equals", 3, "3"), true);
  assert.equal(evaluate("equals", "ok", "ok"), true);
  assert.equal(evaluate("equals", true, "true"), true);
  assert.equal(evaluate("not_equals", 3, "4"), true);
  assert.equal(evaluate("not_equals", 3, "3"), false);
});

test("equals compares objects and arrays structurally", () => {
  assert.equal(evaluate("equals", { a: 1 }, { a: 1 }), true);
  assert.equal(evaluate("equals", { a: 1 }, { a: 2 }), false);
  assert.equal(evaluate("equals", [1, 2], [1, 2]), true);
});

test("null and undefined are equal only to themselves, never to each other", () => {
  assert.equal(evaluate("equals", null, null), true);
  assert.equal(evaluate("equals", undefined, undefined), true);
  // Loose equality stops short of conflating "absent" with "explicitly null" — a
  // distinction the webhook trigger depends on.
  assert.equal(evaluate("equals", null, undefined), false);
  assert.equal(evaluate("equals", null, ""), false);
});

test("contains searches an array by membership and anything else by substring", () => {
  assert.equal(evaluate("contains", ["a", "b"], "b"), true);
  assert.equal(evaluate("contains", ["a", "b"], "c"), false);
  assert.equal(evaluate("contains", [1, 2, 3], "2"), true, "loose inside arrays too");
  assert.equal(evaluate("contains", "urgent request", "urgent"), true);
  assert.equal(evaluate("contains", "urgent", "URGENT"), false, "substring is case-sensitive");
  assert.equal(evaluate("contains", null, "x"), false);
});

test("numeric comparison coerces strings and refuses nonsense rather than throwing", () => {
  assert.equal(evaluate("greater_than", "10", 9), true);
  assert.equal(evaluate("less_than", "9", "10"), true);
  assert.equal(evaluate("greater_than", 5, 5), false);
  // NaN comparisons are false both ways — a non-numeric value never wins either side.
  assert.equal(evaluate("greater_than", "abc", 1), false);
  assert.equal(evaluate("less_than", "abc", 1), false);
  assert.equal(evaluate("greater_than", "", 0), false, "empty string is not zero here");
});

test("emptiness covers every shape a resolved reference can produce", () => {
  for (const empty of [null, undefined, "", "   ", [], {}]) {
    assert.equal(evaluate("is_empty", empty, undefined), true, `${JSON.stringify(empty)} is empty`);
    assert.equal(evaluate("is_not_empty", empty, undefined), false);
  }
  for (const filled of [0, false, "x", [0], { a: 1 }]) {
    assert.equal(evaluate("is_empty", filled, undefined), false, `${JSON.stringify(filled)} is not empty`);
  }
  // 0 and false are NOT empty. An unresolvable reference becomes "", which is — so
  // this is the line between "no data" and "data that happens to be falsy".
  assert.equal(evaluate("is_empty", 0, undefined), false);
  assert.equal(evaluate("is_empty", false, undefined), false);
});

test("the branch node reports the edge it took and carries its input through", async () => {
  const context = fakeContext();
  const yes = await run(branchNode, {
    config: { left: "urgent", operator: "equals", right: "urgent" },
    input: { id: 7 },
    context,
  });
  assert.deepEqual(yes, { output: { matched: true, input: { id: 7 } }, branch: "true" });
  assert.match(context.lines[0].message, /evaluated to true/);

  const no = await run(branchNode, {
    config: { left: "calm", operator: "equals", right: "urgent" },
    input: undefined,
    context: fakeContext(),
  });
  assert.deepEqual(no, { output: { matched: false, input: null }, branch: "false" });
});

// --- assert: the deterministic failure path --------------------------------------

test("assert passes its input through, and fails with the configured message", async () => {
  const passed = await run(assertNode, {
    config: { left: "value", operator: "is_not_empty", message: "unused" },
    input: { keep: true },
    context: fakeContext(),
  });
  assert.deepEqual(passed, { output: { keep: true } });

  await assert.rejects(
    () =>
      run(assertNode, {
        config: { left: "", operator: "is_not_empty", message: "The payload had no body." },
        input: null,
        context: fakeContext(),
      }),
    (error: unknown) => {
      // A NodeError, not a generic throw: the engine renders its message on the step.
      assert.ok(error instanceof NodeError);
      assert.equal((error as Error).message, "The payload had no body.");
      return true;
    },
  );
});

// --- loop: the only legal cycle ---------------------------------------------------

test("the loop emits one item per pass and then leaves through done", async () => {
  const items = ["a", "b"];
  const config = { items, maxIterations: 5 };

  const first = await run(loopNode, { config, input: null, context: fakeContext(0) });
  assert.deepEqual(first, { output: { index: 0, item: "a", total: 2 }, branch: "loop" });

  const second = await run(loopNode, { config, input: null, context: fakeContext(1) });
  assert.deepEqual(second, { output: { index: 1, item: "b", total: 2 }, branch: "loop" });

  const done = await run(loopNode, { config, input: null, context: fakeContext(2) });
  assert.deepEqual(done, {
    output: { done: true, iterations: 2, items },
    branch: "done",
  });
});

test("the loop iterates its input array when no items are configured", async () => {
  const result = await run(loopNode, {
    config: { maxIterations: 5 },
    input: [10, 20, 30],
    context: fakeContext(1),
  });
  assert.deepEqual(result, { output: { index: 1, item: 20, total: 3 }, branch: "loop" });
});

test("with neither items nor an array input the loop counts, bounded by the cap", async () => {
  const result = await run(loopNode, {
    config: { maxIterations: 3 },
    input: { not: "an array" },
    context: fakeContext(0),
  });
  // No items to walk, so the index is the item. Still bounded — this is the shape a
  // generated "repeat N times" loop takes.
  assert.deepEqual(result, { output: { index: 0, item: 0, total: 3 }, branch: "loop" });
});

test("maxIterations cannot lift the hard cap, however it is configured", async () => {
  const result = await run(loopNode, {
    config: { maxIterations: 9_999, items: Array.from({ length: 400 }, (_, i) => i) },
    input: null,
    context: fakeContext(0),
  });
  const output = (result as { output: { total: number } }).output;
  assert.equal(output.total, HARD_MAX_ITERATIONS);
});

test("an empty items array finishes immediately rather than looping once", async () => {
  const result = await run(loopNode, {
    config: { items: [], maxIterations: 5 },
    input: null,
    context: fakeContext(0),
  });
  assert.equal((result as { branch: string }).branch, "done");
});

// --- set: the merge branch --------------------------------------------------------

test("set replaces by default and merges underneath when asked", async () => {
  const replaced = await run(setNode, {
    config: { fields: { b: 2 }, merge: false },
    input: { a: 1 },
  });
  assert.deepEqual(replaced, { output: { b: 2 } });

  const merged = await run(setNode, {
    config: { fields: { b: 2 }, merge: true },
    input: { a: 1 },
  });
  assert.deepEqual(merged, { output: { a: 1, b: 2 } });

  const overwritten = await run(setNode, {
    config: { fields: { a: "new" }, merge: true },
    input: { a: "old" },
  });
  assert.deepEqual(overwritten, { output: { a: "new" } }, "configured fields win");
});

test("merge is ignored when the input is not a plain object", async () => {
  // An array or a scalar has nothing to spread. Merging one would produce indexed keys
  // and quietly corrupt the output shape the next node reads.
  for (const input of [[1, 2], "text", 42, null, undefined]) {
    const result = await run(setNode, { config: { fields: { a: 1 }, merge: true }, input });
    assert.deepEqual(result, { output: { a: 1 } }, `input ${JSON.stringify(input)}`);
  }
});

// --- delay: the abort path --------------------------------------------------------

test("a delay passes its input through and is bounded by the cap", async () => {
  const context = fakeContext();
  const result = await run(delayNode, { config: { ms: 0 }, input: { keep: 1 }, context });
  assert.deepEqual(result, { output: { keep: 1 } });
  assert.deepEqual(
    context.lines.map((line) => line.message),
    ["Waiting 0 ms.", "Done waiting."],
    "it logs before AND after — this is the only mid-node log-streaming exercise",
  );

  const capped = fakeContext();
  await run(delayNode, { config: { ms: MAX_DELAY_MS + 60_000 }, input: null, context: capped });
  assert.match(capped.lines[0].message, new RegExp(`Waiting ${MAX_DELAY_MS} ms`));
});

test("a delay already past its abort signal rejects without waiting", async () => {
  const controller = new AbortController();
  controller.abort();
  const context = { ...fakeContext(), signal: controller.signal };

  await assert.rejects(
    () => run(delayNode, { config: { ms: 5_000 }, input: null, context }),
    (error: unknown) => {
      assert.ok(error instanceof NodeError);
      assert.match((error as Error).message, /stopped before this delay finished/);
      return true;
    },
  );
});

test("a delay aborted mid-wait rejects instead of resolving late", async () => {
  const controller = new AbortController();
  const context = { ...fakeContext(), signal: controller.signal };
  const pending = run(delayNode, { config: { ms: 5_000 }, input: null, context });
  setTimeout(() => controller.abort(), 10);

  const started = Date.now();
  await assert.rejects(pending, /stopped before this delay finished/);
  // The point is that it does not sit out the full 5 s — a cancelled run must not hold
  // the engine open to its deadline.
  assert.ok(Date.now() - started < 1_000);
});
