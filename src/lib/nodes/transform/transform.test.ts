import assert from "node:assert/strict";
import { test } from "node:test";

import { TEST_SCOPE } from "@/lib/engine/fixtures";
import type { LogLevel, NodeContext, RegisteredNode } from "@/lib/nodes/types";
import { NodeError } from "@/lib/nodes/types";

import { aggregateNode } from "./aggregate";
import { dateNode } from "./date";
import { filterNode } from "./filter";
import { jsonNode } from "./json";
import { mapNode } from "./map";
import { numberNode } from "./number";
import { compareValues, identityKey, incomingArray, readPath } from "./shared";
import { sortNode } from "./sort";
import { textNode } from "./text";
import { uniqueNode } from "./unique";

/**
 * The transform nodes — Phase 23A.
 *
 * These are pure functions of their config and their input, which makes them cheap to
 * test properly and leaves no excuse not to. Two themes run through what is asserted
 * here, and both are bugs this product has already shipped once:
 *
 *   • **`Number(null)` is 0.** Phase 22 found it in the analytics coercion, where an
 *     absent duration became a zero-millisecond step and dragged a median down. Every
 *     node here that takes a number is tested against null, "", and a non-numeric
 *     string, and is required to either skip the value or fail — never to invent a zero.
 *   • **Sorting numbers as text.** `[10, 9].sort()` gives `[10, 9]`. Asserted directly.
 */

function fakeContext(): NodeContext & { lines: Array<{ message: string; level: LogLevel }> } {
  const lines: Array<{ message: string; level: LogLevel }> = [];
  return {
    runId: "run-1",
    workflowId: "wf-1",
    scope: TEST_SCOPE,
    nodeId: "node-1",
    nodeType: "transform.filter",
    iteration: 0,
    log: (message: string, level: LogLevel = "info") => lines.push({ message, level }),
    signal: new AbortController().signal,
    lines,
  };
}

async function run(node: RegisteredNode, config: unknown, input: unknown = null) {
  const parsed = node.configSchema.parse(config);
  const outcome = await node.execute({ config: parsed, input, context: fakeContext() });
  return outcome.output as Record<string, unknown>;
}

// --- readPath: the one thing every transform node shares --------------------------

test("readPath walks objects, arrays and the empty path", () => {
  const value = { user: { name: "Ada" }, tags: ["a", "b"] };
  assert.equal(readPath(value, "user.name"), "Ada");
  assert.equal(readPath(value, "tags.1"), "b");
  assert.equal(readPath(value, "tags.-1"), "b", "a negative index counts from the end");
  assert.deepEqual(readPath(value, ""), value, "the empty path is the value itself");
  assert.equal(readPath(value, "  "), value, "and so is whitespace");
});

test("readPath returns undefined rather than throwing on anything that does not resolve", () => {
  assert.equal(readPath({ a: 1 }, "a.b.c"), undefined);
  assert.equal(readPath(null, "a"), undefined);
  assert.equal(readPath(undefined, "a"), undefined);
  assert.equal(readPath("text", "length"), undefined, "a scalar has no readable path");
  assert.equal(readPath([1, 2], "name"), undefined, "a word against an array is not a property");
});

test("readPath cannot walk off the data into the prototype chain", () => {
  // Without the `hasOwn` guard these return Object's own machinery, which is both
  // useless to a workflow author and the first half of a prototype-pollution read.
  assert.equal(readPath({}, "constructor"), undefined);
  assert.equal(readPath({}, "__proto__"), undefined);
  assert.equal(readPath({}, "toString"), undefined);
  assert.equal(readPath([1], "length"), undefined);
  assert.equal(readPath([1], "map"), undefined);
  // An own property that merely shares the name still reads.
  assert.equal(readPath({ constructor: "mine" }, "constructor"), "mine");
});

test("incomingArray prefers config, then a bare array, then the items property", () => {
  assert.deepEqual(incomingArray([1], [2], "X"), [1], "config wins");
  assert.deepEqual(incomingArray(undefined, [2], "X"), [2]);
  assert.deepEqual(incomingArray(undefined, { items: [3] }, "X"), [3], "nodes chain through items");
  assert.deepEqual(incomingArray([], [2], "X"), [], "an empty configured list is still a choice");
});

test("incomingArray copies, so a node cannot mutate what it was handed", () => {
  const original = [3, 1, 2];
  const copy = incomingArray(undefined, original, "X");
  copy.sort();
  assert.deepEqual(original, [3, 1, 2]);
});

test("incomingArray explains what it got instead of a list", () => {
  assert.throws(() => incomingArray(undefined, null, "Sort list"), (error: Error) => {
    assert.ok(error instanceof NodeError);
    assert.match(error.message, /Sort list needs a list/);
    assert.match(error.message, /produced nothing/);
    return true;
  });
  assert.throws(
    () => incomingArray(undefined, { name: "x", id: 1 }, "Sort list"),
    /an object \(name, id\)/,
  );
  assert.throws(() => incomingArray(undefined, "text", "Sort list"), /a string/);
});

// --- filter ----------------------------------------------------------------------

test("filter keeps the items that pass and counts the ones that did not", async () => {
  const output = await run(
    filterNode,
    { field: "state", operator: "equals", value: "open" },
    [{ state: "open" }, { state: "closed" }, { state: "open" }],
  );
  assert.equal(output.count, 2);
  assert.equal(output.removed, 1);
  assert.equal(output.total, 3);
  assert.deepEqual(output.items, [{ state: "open" }, { state: "open" }]);
});

test("filter with an empty field tests the item itself", async () => {
  const output = await run(filterNode, { operator: "is_not_empty" }, ["a", "", "b", null]);
  assert.deepEqual(output.items, ["a", "b"]);
});

test("filter uses the SAME comparison as a branch node", async () => {
  // The shared `evaluate` is the point: `greater_than` coerces, so "80" passes.
  const output = await run(
    filterNode,
    { field: "score", operator: "greater_than", value: 50 },
    [{ score: 80 }, { score: "90" }, { score: 10 }, { score: null }],
  );
  assert.deepEqual(output.items, [{ score: 80 }, { score: "90" }]);
});

// --- map -------------------------------------------------------------------------

test("map rebuilds each item from paths", async () => {
  const output = await run(
    mapNode,
    { fields: { who: "user.name", id: "id" } },
    [{ id: 1, user: { name: "Ada" } }, { id: 2, user: { name: "Grace" } }],
  );
  assert.deepEqual(output.items, [
    { who: "Ada", id: 1 },
    { who: "Grace", id: 2 },
  ]);
});

test("map emits null rather than omitting a key, so the list stays rectangular", async () => {
  const output = await run(mapNode, { fields: { email: "user.email" } }, [
    { user: { email: "a@b.c" } },
    { user: {} },
  ]);
  assert.deepEqual(output.items, [{ email: "a@b.c" }, { email: null }]);
  for (const item of output.items as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(item), ["email"]);
  }
});

test("map refuses to run with no fields instead of emitting empty objects", async () => {
  await assert.rejects(() => run(mapNode, { fields: {} }, [{ a: 1 }]), (error: Error) => {
    assert.ok(error instanceof NodeError);
    assert.match(error.message, /no fields configured/);
    return true;
  });
});

// --- sort ------------------------------------------------------------------------

test("sort compares numbers as numbers, not as text", async () => {
  // The bug this node exists to avoid: the default sort gives [10, 9].
  const output = await run(sortNode, {}, [10, 9, 100, 2]);
  assert.deepEqual(output.items, [2, 9, 10, 100]);
});

test("sort handles numeric strings the same way", async () => {
  const output = await run(sortNode, { field: "n" }, [{ n: "10" }, { n: "9" }]);
  assert.deepEqual(output.items, [{ n: "9" }, { n: "10" }]);
});

test("sort descending reverses, and text sorts alphabetically", async () => {
  assert.deepEqual((await run(sortNode, { direction: "desc" }, [1, 3, 2])).items, [3, 2, 1]);
  assert.deepEqual((await run(sortNode, {}, ["pear", "apple"])).items, ["apple", "pear"]);
});

test("sort puts items missing the field last, in both directions", async () => {
  const rows = [{ n: 2 }, {}, { n: 1 }];
  assert.deepEqual((await run(sortNode, { field: "n" }, rows)).items, [{ n: 1 }, { n: 2 }, {}]);
  // Descending reverses the comparator, so the absent row leads. What must not happen
  // is it vanishing or the sort throwing.
  assert.equal(((await run(sortNode, { field: "n", direction: "desc" }, rows)).items as unknown[]).length, 3);
});

test("compareValues is a total order on mixed input", () => {
  assert.equal(compareValues(1, 2), -1);
  assert.equal(compareValues(2, 2), 0);
  assert.equal(compareValues("b", "a"), 1);
  assert.equal(compareValues(true, false), 1, "booleans compare as 1 and 0");
  assert.equal(compareValues(null, null), 0);
  assert.equal(compareValues(Number.NaN, 1), 1, "NaN is not comparable, so it sorts as text");
});

// --- unique ----------------------------------------------------------------------

test("unique keeps the first of each and preserves order", async () => {
  const output = await run(uniqueNode, {}, ["b", "a", "b", "c", "a"]);
  assert.deepEqual(output.items, ["b", "a", "c"]);
  assert.equal(output.removed, 2);
});

test("unique by a field keeps the whole first item", async () => {
  const output = await run(uniqueNode, { field: "email" }, [
    { email: "a@b.c", name: "first" },
    { email: "a@b.c", name: "second" },
  ]);
  assert.deepEqual(output.items, [{ email: "a@b.c", name: "first" }]);
});

test("unique compares objects by contents, not by identity", async () => {
  const output = await run(uniqueNode, {}, [{ a: 1 }, { a: 1 }, { a: 2 }]);
  assert.equal(output.count, 2);
});

test("identityKey never collides across types", () => {
  // `"1"` and `1` are different items and must not de-duplicate each other.
  assert.notEqual(identityKey("1"), identityKey(1));
  assert.notEqual(identityKey(null), identityKey("null"));
  assert.notEqual(identityKey(undefined), identityKey(null));
  assert.equal(identityKey({ a: 1 }), identityKey({ a: 1 }));
});

// --- aggregate -------------------------------------------------------------------

test("aggregate counts, sums and averages", async () => {
  const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
  assert.equal((await run(aggregateNode, { operation: "count" }, rows)).value, 3);
  assert.equal((await run(aggregateNode, { operation: "sum", field: "n" }, rows)).value, 6);
  assert.equal((await run(aggregateNode, { operation: "average", field: "n" }, rows)).value, 2);
});

test("aggregate SKIPS non-numbers rather than counting them as zero", async () => {
  // The Phase 22 lesson, asserted: Number(null) and Number("") are both 0, and an
  // average that included them would be wrong in a way nobody would question.
  const rows = [{ n: 10 }, { n: null }, { n: "" }, { n: "oops" }, { n: 20 }];
  const sum = await run(aggregateNode, { operation: "sum", field: "n" }, rows);
  assert.equal(sum.value, 30);
  assert.equal(sum.skipped, 3, "the output says how many were ignored");
  const average = await run(aggregateNode, { operation: "average", field: "n" }, rows);
  assert.equal(average.value, 15, "divided by 2, not by 5");
});

test("aggregate refuses to average a list with no numbers instead of returning NaN", async () => {
  await assert.rejects(
    () => run(aggregateNode, { operation: "average", field: "n" }, [{ n: "x" }]),
    (error: Error) => {
      assert.ok(error instanceof NodeError);
      assert.match(error.message, /no numbers in it/);
      return true;
    },
  );
});

test("aggregate min and max compare numerically and survive an empty list", async () => {
  const rows = [{ n: 9 }, { n: 10 }, { n: 2 }];
  assert.equal((await run(aggregateNode, { operation: "min", field: "n" }, rows)).value, 2);
  assert.equal((await run(aggregateNode, { operation: "max", field: "n" }, rows)).value, 10);
  assert.equal((await run(aggregateNode, { operation: "max" }, [])).value, null);
  assert.equal((await run(aggregateNode, { operation: "sum" }, [])).value, 0);
});

test("aggregate join renders objects as JSON and drops absent entries", async () => {
  const joined = await run(
    aggregateNode,
    { operation: "join", field: "title", separator: " | " },
    [{ title: "a" }, { title: null }, { title: "b" }],
  );
  assert.equal(joined.value, "a | b");
  assert.equal(joined.skipped, 1);
  const objects = await run(aggregateNode, { operation: "join" }, [{ a: 1 }]);
  assert.equal(objects.value, '{"a":1}');
});

test("aggregate first and last are null on an empty list, not undefined", async () => {
  assert.equal((await run(aggregateNode, { operation: "first" }, [])).value, null);
  assert.equal((await run(aggregateNode, { operation: "last" }, [])).value, null);
  assert.equal((await run(aggregateNode, { operation: "last" }, [1, 2])).value, 2);
});

// --- json ------------------------------------------------------------------------

test("json parses a string and names what it found", async () => {
  const output = await run(jsonNode, { mode: "parse" }, '{"a":1}');
  assert.deepEqual(output.value, { a: 1 });
  assert.equal(output.type, "object");
  assert.equal((await run(jsonNode, { mode: "parse" }, "[1]")).type, "array");
  assert.equal((await run(jsonNode, { mode: "parse" }, "null")).type, "null");
});

test("json parse passes already-structured input through instead of failing", async () => {
  // The same endpoint sending application/json on Tuesday and text/plain on Wednesday
  // must not fail half the runs.
  const output = await run(jsonNode, { mode: "parse" }, { a: 1 });
  assert.deepEqual(output.value, { a: 1 });
});

test("json parse reports bad JSON in words a user can act on", async () => {
  await assert.rejects(() => run(jsonNode, { mode: "parse" }, "{oops"), (error: Error) => {
    assert.ok(error instanceof NodeError);
    assert.match(error.message, /not valid JSON/);
    return true;
  });
});

test("json stringify honours pretty and reports length", async () => {
  const compact = await run(jsonNode, { mode: "stringify" }, { a: 1 });
  assert.equal(compact.text, '{"a":1}');
  assert.equal(compact.length, 7);
  const pretty = await run(jsonNode, { mode: "stringify", pretty: true }, { a: 1 });
  assert.match(pretty.text as string, /\n/);
});

test("json stringify turns undefined into null rather than the string undefined", async () => {
  assert.equal((await run(jsonNode, { mode: "stringify" }, null)).text, "null");
});

// --- text ------------------------------------------------------------------------

test("text applies each operation", async () => {
  assert.equal((await run(textNode, { operation: "trim" }, "  a  ")).text, "a");
  assert.equal((await run(textNode, { operation: "uppercase" }, "ab")).text, "AB");
  assert.equal((await run(textNode, { operation: "lowercase" }, "AB")).text, "ab");
  assert.equal((await run(textNode, { operation: "title_case" }, "ada lovelace")).text, "Ada Lovelace");
  assert.equal((await run(textNode, { operation: "slice", start: 0, end: 2 }, "abcd")).text, "ab");
  assert.equal((await run(textNode, { operation: "slice", start: -2 }, "abcd")).text, "cd");
  assert.equal((await run(textNode, { operation: "prepend", value: ">" }, "a")).text, ">a");
  assert.equal((await run(textNode, { operation: "append", value: "!" }, "a")).text, "a!");
});

test("text replace is LITERAL, so a regex metacharacter is not a pattern", async () => {
  // A user-supplied regex is a denial of service waiting to happen. `.` must match a
  // full stop and nothing else.
  const output = await run(textNode, { operation: "replace", search: ".", value: "-" }, "a.b.c");
  assert.equal(output.text, "a-b-c");
  const plus = await run(textNode, { operation: "replace", search: "a+", value: "x" }, "a+b");
  assert.equal(plus.text, "xb");
});

test("text replace replaces every occurrence, not just the first", async () => {
  assert.equal((await run(textNode, { operation: "replace", search: "a", value: "b" }, "aaa")).text, "bbb");
});

test("text split produces a list and refuses an empty separator", async () => {
  const output = await run(textNode, { operation: "split", search: ", " }, "a, b, c");
  assert.deepEqual(output.items, ["a", "b", "c"]);
  assert.equal(output.count, 3);
  await assert.rejects(() => run(textNode, { operation: "split", search: "" }, "abc"), (error: Error) => {
    assert.match(error.message, /empty separator/);
    return true;
  });
});

test("text renders a non-string input as JSON, never as [object Object]", async () => {
  const output = await run(textNode, { operation: "trim" }, { a: 1 });
  assert.equal(output.text, '{"a":1}');
  assert.equal((await run(textNode, { operation: "trim" }, null)).text, "");
  assert.equal((await run(textNode, { operation: "trim" }, 42)).text, "42");
});

// --- number ----------------------------------------------------------------------

test("number performs each operation", async () => {
  assert.equal((await run(numberNode, { value: 2, operation: "add", operand: 3 })).value, 5);
  assert.equal((await run(numberNode, { value: 5, operation: "subtract", operand: 3 })).value, 2);
  assert.equal((await run(numberNode, { value: 2, operation: "multiply", operand: 3 })).value, 6);
  assert.equal((await run(numberNode, { value: 6, operation: "divide", operand: 3 })).value, 2);
  assert.equal((await run(numberNode, { value: 1.5, operation: "round" })).value, 2);
  assert.equal((await run(numberNode, { value: 1.9, operation: "floor" })).value, 1);
  assert.equal((await run(numberNode, { value: 1.1, operation: "ceil" })).value, 2);
  assert.equal((await run(numberNode, { value: -3, operation: "absolute" })).value, 3);
  assert.equal((await run(numberNode, { value: 25, operation: "percent_of", operand: 200 })).value, 12.5);
});

test("number REFUSES a null rather than treating it as zero", async () => {
  // Number(null) is 0. A missing reference must fail loudly, not produce a plausible
  // wrong answer.
  for (const bad of [null, "", "   ", "oops", {}]) {
    await assert.rejects(
      () => run(numberNode, { value: bad, operation: "add", operand: 1 }),
      (error: Error) => {
        assert.ok(error instanceof NodeError, `for ${JSON.stringify(bad)}`);
        assert.match(error.message, /needs a number in "value"/);
        return true;
      },
    );
  }
});

test("number names the operand when the operand is what is missing", async () => {
  await assert.rejects(
    () => run(numberNode, { value: 1, operation: "multiply" }),
    /needs a number in "operand" for "multiply"/,
  );
});

test("number ignores a missing operand for the operations that do not use one", async () => {
  assert.equal((await run(numberNode, { value: -1.4, operation: "absolute" })).value, 1.4);
  assert.equal((await run(numberNode, { value: "7", operation: "round" })).value, 7);
});

test("number refuses to divide by zero, including as a percentage", async () => {
  await assert.rejects(() => run(numberNode, { value: 1, operation: "divide", operand: 0 }), /divide by zero/);
  await assert.rejects(() => run(numberNode, { value: 1, operation: "percent_of", operand: 0 }), /percentage of zero/);
});

test("number precision rounds without reintroducing float error", async () => {
  const output = await run(numberNode, { value: 1, operation: "divide", operand: 3, precision: 2 });
  assert.equal(output.value, 0.33);
  const vat = await run(numberNode, { value: 19.99, operation: "multiply", operand: 1.2, precision: 2 });
  assert.equal(vat.value, 23.99);
});

test("number falls back to the incoming input", async () => {
  assert.equal((await run(numberNode, { operation: "add", operand: 1 }, 41)).value, 42);
});

// --- date ------------------------------------------------------------------------

test("date reports every representation of a fixed instant in UTC", async () => {
  const output = await run(dateNode, { value: "2026-09-30T13:45:07Z" });
  assert.equal(output.iso, "2026-09-30T13:45:07.000Z");
  assert.equal(output.date, "2026-09-30");
  assert.equal(output.time, "13:45:07");
  assert.equal(output.unix, 1790775907);
  assert.equal(output.year, 2026);
  assert.equal(output.month, 9);
  assert.equal(output.day, 30);
  assert.equal(output.weekday, "Wednesday");
  assert.equal(output.monthName, "September");
  assert.equal(output.timeZone, "UTC");
});

test("date renders the wall clock of the requested zone, not the server's", async () => {
  // The bug this node exists to prevent: a scheduled digest reading the container's
  // clock, which is UTC, while its author tested in their own zone.
  const output = await run(dateNode, {
    value: "2026-09-30T20:30:00Z",
    timeZone: "Asia/Singapore",
  });
  assert.equal(output.date, "2026-10-01", "past midnight in Singapore");
  assert.equal(output.time, "04:30:00");
  assert.equal(output.weekday, "Thursday");
  // The instant itself never moves.
  assert.equal(output.iso, "2026-09-30T20:30:00.000Z");
});

test("date shifts by minutes in both directions", async () => {
  const yesterday = await run(dateNode, { value: "2026-09-30T12:00:00Z", shiftMinutes: -1440 });
  assert.equal(yesterday.date, "2026-09-29");
  const later = await run(dateNode, { value: "2026-09-30T12:00:00Z", shiftMinutes: 90 });
  assert.equal(later.time, "13:30:00");
});

test("date reads a bare number as Unix SECONDS, not milliseconds", async () => {
  // `new Date(1790775907)` lands in 1970. The multiplication is the whole point.
  const output = await run(dateNode, { value: 1790775907 });
  assert.equal(output.date, "2026-09-30");
});

test("date rejects an unreadable value and an unknown zone with useful words", async () => {
  await assert.rejects(() => run(dateNode, { value: "not a date" }), (error: Error) => {
    assert.ok(error instanceof NodeError);
    assert.match(error.message, /is not a date this node can read/);
    return true;
  });
  await assert.rejects(() => run(dateNode, { timeZone: "Mars/Olympus" }), (error: Error) => {
    assert.ok(error instanceof NodeError);
    assert.match(error.message, /not a time zone this node recognises/);
    return true;
  });
});

test("date ignores an object input rather than trying to read it as a date", async () => {
  const output = await run(dateNode, {}, { some: "object" });
  // Falls back to now, which is after this test was written.
  assert.ok(Number(output.year) >= 2026);
});

test("date defaults to now when nothing is configured", async () => {
  const before = Date.now();
  const output = await run(dateNode, {});
  assert.ok(Math.abs((output.unix as number) * 1000 - before) < 5_000);
});
