import assert from "node:assert/strict";
import { test } from "node:test";

import type { LogLevel, NodeContext } from "@/lib/nodes/types";
import { NodeError } from "@/lib/nodes/types";

import { assertNode } from "./assert";
import { branchNode, evaluate } from "./branch";
import { z } from "zod";

import { delayMs, delayNode, describeDuration, MAX_DELAY_MS, MAX_WAIT_MS } from "./delay";
import { logNode } from "./log";
import { HARD_MAX_ITERATIONS, loopNode } from "./loop";
import { setNode } from "./set";
import { SWITCH_CASES, switchNode } from "./switch";
import { TEST_SCOPE } from "@/lib/engine/fixtures";

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
    scope: TEST_SCOPE,
    nodeId: "node-1",
    nodeType: "core.log",
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

// --- delay: durable waits — Phase 26 --------------------------------------------

test("amount and unit say how long; a bare config waits one second", () => {
  assert.equal(delayMs({ amount: 2, unit: "hours" }), 7_200_000);
  assert.equal(delayMs({ amount: 90 }), 90_000, "seconds is the unit when none is given");
  assert.equal(delayMs({ amount: 1.5, unit: "days" }), 129_600_000);
  assert.equal(delayMs({}), 1_000);
});

test("a stored Phase 5 `ms` still means what it meant, and `amount` wins over it", () => {
  // Version snapshots carry `ms` and are never rewritten (D85), so it is read for ever.
  assert.equal(delayMs({ ms: 700 }), 700);
  // A legacy value never meant more than the in-process cap, so reading it again must
  // not turn it into a suspension.
  assert.equal(delayMs({ ms: MAX_DELAY_MS * 10 }), MAX_DELAY_MS);
  // Somebody editing an old node in the form adds `amount`; that is now the answer.
  assert.equal(delayMs({ ms: 700, amount: 5, unit: "minutes" }), 300_000);
});

test("the form and the generator see amount and unit, with defaults, and never ms", () => {
  // `io: "input"` is how `/api/nodes` and the tool schemas emit it. A parse default would
  // have filled `amount` in on a legacy config and overridden its `ms`, which is why the
  // defaults live in the JSON Schema only.
  const json = z.toJSONSchema(delayNode.configSchema, { io: "input" }) as {
    properties: Record<string, { default?: unknown; enum?: unknown[] }>;
  };
  assert.deepEqual(Object.keys(json.properties).sort(), ["amount", "unit"]);
  assert.equal(json.properties.amount.default, 1);
  assert.equal(json.properties.unit.default, "seconds");
  assert.deepEqual(json.properties.unit.enum, ["milliseconds", "seconds", "minutes", "hours", "days"]);
  assert.deepEqual(delayNode.configSchema.parse({}), {}, "parsing applies no default");
});

test("a delay is bounded at 30 days by its schema", () => {
  assert.equal(delayNode.configSchema.safeParse({ amount: 30, unit: "days" }).success, true);
  const tooLong = delayNode.configSchema.safeParse({ amount: 31, unit: "days" });
  assert.equal(tooLong.success, false);
  assert.match(JSON.stringify(tooLong.error?.issues), /at most 30 days/);
  assert.equal(MAX_WAIT_MS, 30 * 86_400_000);
});

test("a long delay asks the run to wait instead of sleeping", async () => {
  const context = fakeContext();
  const before = Date.now();
  const result = (await run(delayNode, {
    config: { amount: 2, unit: "hours" },
    input: { keep: 1 },
    context,
  })) as { output: unknown; wait?: { until: string } };

  // Immediately — nothing slept — with the output already final and the wake time set.
  assert.ok(Date.now() - before < 1_000);
  assert.deepEqual(result.output, { keep: 1 });
  const until = Date.parse(result.wait!.until);
  assert.ok(Math.abs(until - (before + 7_200_000)) < 5_000);
  assert.match(context.lines[0].message, /^Waiting 2 hours, until .+ The run pauses here/);
});

test("ten seconds still waits in place, as it always has", async () => {
  const context = fakeContext();
  const result = (await run(delayNode, {
    config: { amount: 0, unit: "seconds" },
    input: "x",
    context,
  })) as { output: unknown; wait?: unknown };
  assert.equal(result.wait, undefined);
  assert.equal(result.output, "x");
});

test("a duration is described the way a person would say it", () => {
  assert.equal(describeDuration(7_200_000), "2 hours");
  assert.equal(describeDuration(86_400_000), "1 day");
  assert.equal(describeDuration(90_000), "1.5 minutes");
  assert.equal(describeDuration(500), "500 ms");
});

// --- switch: multi-way routing — Phase 23A ---------------------------------------

test("switch takes the FIRST matching case, so order decides", async () => {
  // The rule a chain of branches also has, made explicit: two cases that both match
  // must resolve to the earlier one, or a config is ambiguous.
  const outcome = await run(switchNode, {
    config: {
      value: 100,
      cases: [
        { operator: "greater_than", value: 10 },
        { operator: "greater_than", value: 50 },
      ],
    },
    input: null,
    context: fakeContext(),
  });
  assert.equal(outcome.branch, "1");
  assert.equal((outcome.output as { matched: number }).matched, 1);
});

test("switch routes to each of its four cases by index", async () => {
  const cases = [
    { operator: "equals" as const, value: "a" },
    { operator: "equals" as const, value: "b" },
    { operator: "equals" as const, value: "c" },
    { operator: "equals" as const, value: "d" },
  ];
  for (const [index, value] of ["a", "b", "c", "d"].entries()) {
    const outcome = await run(switchNode, {
      config: { value, cases },
      input: null,
      context: fakeContext(),
    });
    assert.equal(outcome.branch, String(index + 1));
  }
});

test("switch falls through to else when nothing matches, and when nothing is configured", async () => {
  const unmatched = await run(switchNode, {
    config: { value: "z", cases: [{ operator: "equals", value: "a" }] },
    input: null,
    context: fakeContext(),
  });
  assert.equal(unmatched.branch, "else");
  assert.equal((unmatched.output as { matched: number | null }).matched, null);

  const empty = await run(switchNode, {
    config: { value: "z", cases: [] },
    input: null,
    context: fakeContext(),
  });
  assert.equal(empty.branch, "else");
});

test("every branch switch can take is a declared output", async () => {
  // The engine records the untaken outputs as skipped by name, so a branch string that
  // is not in `outputs` would silently route nowhere.
  const declared = new Set(switchNode.outputs.map((output) => output.key));
  assert.equal(declared.size, SWITCH_CASES + 1);
  for (let index = 0; index <= SWITCH_CASES; index += 1) {
    const cases = Array.from({ length: SWITCH_CASES }, (_unused, at) => ({
      operator: "equals" as const,
      value: at === index ? "hit" : `miss-${at}`,
    }));
    const outcome = await run(switchNode, {
      config: { value: "hit", cases },
      input: null,
      context: fakeContext(),
    });
    assert.ok(declared.has(outcome.branch ?? null), `branch ${outcome.branch} is declared`);
  }
});

test("switch refuses a fifth case rather than silently dropping it", () => {
  const five = Array.from({ length: SWITCH_CASES + 1 }, () => ({ operator: "equals" as const }));
  assert.equal(switchNode.configSchema.safeParse({ value: "a", cases: five }).success, false);
});

test("switch passes its input through so a downstream node still has the data", async () => {
  const outcome = await run(switchNode, {
    config: { value: "a", cases: [{ operator: "equals", value: "a" }] },
    input: { order: 7 },
    context: fakeContext(),
  });
  assert.deepEqual((outcome.output as { input: unknown }).input, { order: 7 });
});

test("switch is not agent-callable, for the same reason branch is not", () => {
  // D19: the node's whole output is the edge taken, and a tool call has no edge.
  assert.equal(switchNode.agentCallable, false);
  assert.equal(branchNode.agentCallable, false);
});

// --- log: a message that is only a reference ------------------------------------------

/**
 * **Phase 34, found in its browser walk.** A config value that is *only* a `{{ }}` reference keeps
 * the type of what it reaches (`template.ts`), so a generated "log the result" —
 * `message: "{{steps.sort.output.items}}"` — handed the Log node a list, and the run failed at its
 * last step with "expected string, received array". Logging a list is exactly what was asked for.
 */
/** A registered node's config type is erased (`RegisteredNode`); the Log node's is this. */
const logConfig = (config: unknown) => logNode.configSchema.parse(config) as { message: string; level: LogLevel };

test("a log message that resolved to a list or an object is logged as JSON, not refused", async () => {
  const context = fakeContext();
  const items = [{ name: "Mug", price: 12 }, { name: "Book", price: 35 }];
  const config = logNode.configSchema.parse({ message: items });
  await run(logNode, { config, input: "x", context });
  assert.equal(context.lines[0]?.message, JSON.stringify(items));

  assert.equal(logConfig({ message: { ok: true } }).message, '{"ok":true}');
  assert.equal(logConfig({ message: 7 }).message, "7");
});

test("a long resolved value is cut to the message limit rather than failing the run", () => {
  const long = Array.from({ length: 500 }, (_, index) => `item-${index}`);
  const message = logConfig({ message: long }).message;
  assert.equal(message.length, 2000);
  assert.ok(message.endsWith("…"));
});

test("text is still text, absent is still empty, and a reference to nothing still fails loudly", () => {
  assert.equal(logConfig({ message: "hi" }).message, "hi");
  assert.equal(logConfig({}).message, "");
  // A whole-string reference that reached nothing resolves to `null` — that is a mistake to see,
  // not an empty line to log.
  assert.equal(logNode.configSchema.safeParse({ message: null }).success, false);
  // A person's own text keeps its limit.
  assert.equal(logNode.configSchema.safeParse({ message: "x".repeat(2001) }).success, false);
});
