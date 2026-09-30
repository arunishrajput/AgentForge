import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bucketByDay,
  groupFailures,
  median,
  percentile,
  summarise,
  toDurations,
  utcDay,
  type RunRow,
} from "./shape";
import { DEFAULT_RANGE, parseRange, RANGES } from "./types";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-20T00:00:00.000Z");

function run(over: Partial<RunRow> & { status: string }): RunRow {
  return {
    id: over.id ?? crypto.randomUUID(),
    status: over.status,
    startedAt: over.startedAt ?? new Date(T0),
    finishedAt: over.finishedAt ?? null,
    error: over.error ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * percentile — nearest rank, deliberately
 * ------------------------------------------------------------------ */

test("a percentile is a value that actually occurred, never an interpolation", () => {
  const values = [10, 20, 30, 40];
  // An interpolating p95 over these would be 38.5, a latency no run ever took.
  assert.equal(percentile(values, 95), 40);
  assert.equal(percentile(values, 50), 20);
  assert.ok(values.includes(percentile(values, 75)!));
});

test("percentile handles the degenerate sizes rather than throwing", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([7], 0), 7);
  assert.equal(percentile([1, 2, 3], 100), 3);
});

test("median is the 50th percentile and agrees with it", () => {
  const values = [1, 5, 9, 11, 40];
  assert.equal(median(values), percentile(values, 50));
  // Nearest rank over five values is the middle one, and it is a duration that happened.
  assert.equal(median(values), 9);
});

/* ------------------------------------------------------------------ *
 * toDurations — the aggregate shape defect, pinned
 * ------------------------------------------------------------------ */

/**
 * **The defect this function exists for.** `array_agg` over the Neon HTTP driver comes
 * back as a Postgres array *text literal*, not a JavaScript array, so the first version
 * of the node-latency query called `.map` on a string and answered 500 for the whole
 * analytics page. The query now uses `jsonb_agg`; this asserts every shape either can
 * produce, so neither half of the fix can be removed without a red test.
 */
test("a Postgres array literal is parsed rather than thrown at", () => {
  assert.deepEqual(toDurations("{1200,34,5}"), [5, 34, 1200]);
  assert.deepEqual(toDurations("{}"), []);
});

test("a real array from jsonb_agg is used as-is", () => {
  assert.deepEqual(toDurations([1200, 34, 5]), [5, 34, 1200]);
});

/**
 * The sort is not incidental. A numeric arriving as a string sorts lexicographically —
 * "9" after "1000" — which reports a p95 *below* the median and reads as an arithmetic
 * bug rather than a type one.
 */
test("numeric strings sort numerically, so p95 can never land below the median", () => {
  const durations = toDurations(["9", "1000", "35"]);
  assert.deepEqual(durations, [9, 35, 1000]);
  assert.ok(percentile(durations, 95)! >= median(durations)!);
});

test("null, undefined and rubbish become an empty list rather than a throw", () => {
  for (const value of [null, undefined, 42, {}, "not an array"]) {
    assert.deepEqual(toDurations(value), []);
  }
});

test("non-numeric entries are dropped rather than becoming NaN in a percentile", () => {
  assert.deepEqual(toDurations(["10", null, "abc", "20"]), [10, 20]);
});

/* ------------------------------------------------------------------ *
 * summarise
 * ------------------------------------------------------------------ */

test("a workspace with no runs has no success rate, rather than a perfect one", () => {
  const totals = summarise([]);
  assert.equal(totals.runs, 0);
  assert.equal(totals.successRate, null);
  assert.equal(totals.medianMs, null);
  assert.equal(totals.p95Ms, null);
});

/**
 * A run still in flight has not succeeded or failed yet, and counting it as either
 * reports a result that does not exist.
 */
test("a running run is in neither the numerator nor the denominator", () => {
  const totals = summarise([
    run({ status: "succeeded", finishedAt: new Date(T0 + 1000) }),
    run({ status: "running" }),
    run({ status: "queued" }),
  ]);
  assert.equal(totals.runs, 3);
  assert.equal(totals.settled, 1);
  assert.equal(totals.successRate, 1);
});

/**
 * A cancellation is a run that did not do what it was asked to. Excluding it from the
 * denominator would let a workspace that cancels half its runs report a perfect record.
 */
test("a cancelled run is in the denominator and not in the numerator", () => {
  const totals = summarise([
    run({ status: "succeeded", finishedAt: new Date(T0 + 1000) }),
    run({ status: "cancelled" }),
  ]);
  assert.equal(totals.settled, 2);
  assert.equal(totals.successRate, 0.5);
});

test("durations come only from settled runs that actually finished", () => {
  const totals = summarise([
    run({ status: "succeeded", finishedAt: new Date(T0 + 1000) }),
    run({ status: "failed", finishedAt: new Date(T0 + 3000) }),
    // No finish time, so it contributes no duration and cannot pull the median to zero.
    run({ status: "running" }),
  ]);
  assert.equal(totals.medianMs, 1000);
  assert.equal(totals.p95Ms, 3000);
});

/* ------------------------------------------------------------------ *
 * bucketByDay — the zeros are the point
 * ------------------------------------------------------------------ */

test("every day in the window gets a bucket, including the days nothing ran", () => {
  const from = new Date(T0);
  const to = new Date(T0 + 4 * DAY);
  const days = bucketByDay([run({ status: "succeeded", startedAt: new Date(T0 + 3 * DAY) })], from, to);

  assert.equal(days.length, 5);
  assert.deepEqual(
    days.map((d) => d.total),
    [0, 0, 0, 1, 0],
  );
  assert.equal(days[0].day, "2026-09-20");
  assert.equal(days[4].day, "2026-09-24");
});

test("a bucket counts each status into its own channel", () => {
  const days = bucketByDay(
    [
      run({ status: "succeeded" }),
      run({ status: "succeeded" }),
      run({ status: "failed" }),
      run({ status: "cancelled" }),
      run({ status: "running" }),
    ],
    new Date(T0),
    new Date(T0),
  );
  assert.deepEqual(days, [
    { day: "2026-09-20", succeeded: 2, failed: 1, cancelled: 1, other: 1, total: 5 },
  ]);
});

test("a window whose start is mid-day still buckets from that calendar day", () => {
  const from = new Date(T0 + 13 * 3600_000);
  const days = bucketByDay(
    [run({ status: "succeeded", startedAt: new Date(T0 + 14 * 3600_000) })],
    from,
    new Date(T0 + DAY),
  );
  assert.equal(days[0].day, "2026-09-20");
  assert.equal(days[0].total, 1);
});

test("a run outside the buckets is dropped rather than throwing the page away", () => {
  const days = bucketByDay(
    [run({ status: "failed", startedAt: new Date(T0 - 10 * DAY) })],
    new Date(T0),
    new Date(T0),
  );
  assert.equal(days.length, 1);
  assert.equal(days[0].total, 0);
});

test("utcDay is UTC and not the machine's zone", () => {
  assert.equal(utcDay(new Date("2026-09-20T23:59:59.999Z")), "2026-09-20");
  assert.equal(utcDay(new Date("2026-09-21T00:00:00.000Z")), "2026-09-21");
});

/* ------------------------------------------------------------------ *
 * groupFailures
 * ------------------------------------------------------------------ */

test("failures differing only in their ids are one row with a count", () => {
  const groups = groupFailures([
    run({ status: "failed", error: 'Node "a" (integration.http) failed: 503 from https://x.test/items/1' }),
    run({ status: "failed", error: 'Node "b" (integration.http) failed: 503 from https://x.test/items/2' }),
    run({ status: "succeeded" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test("only failed runs are grouped", () => {
  const groups = groupFailures([
    run({ status: "cancelled", error: "The run was cancelled." }),
    run({ status: "running" }),
  ]);
  assert.deepEqual(groups, []);
});

test("groups are ordered by count, most frequent first", () => {
  const groups = groupFailures([
    run({ status: "failed", error: "alpha failed" }),
    run({ status: "failed", error: "beta failed" }),
    run({ status: "failed", error: "beta failed" }),
  ]);
  assert.equal(groups[0].template, "beta failed");
  assert.equal(groups[0].count, 2);
});

/**
 * The newest occurrence is kept as the sample, not the first: an operator opening a group
 * wants the one they can still do something about.
 */
test("a group's sample and last-seen track the newest occurrence", () => {
  const groups = groupFailures([
    run({ id: "old", status: "failed", error: "timeout after 10 ms", startedAt: new Date(T0) }),
    run({ id: "new", status: "failed", error: "timeout after 99 ms", startedAt: new Date(T0 + DAY) }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sampleRunId, "new");
  assert.equal(groups[0].sample, "timeout after 99 ms");
  assert.equal(groups[0].lastSeen, new Date(T0 + DAY).toISOString());
});

/**
 * The sample is kept unredacted alongside the template precisely so that over-grouping —
 * which `fingerprint.ts` prefers to under-grouping — stays recoverable by reading a row.
 */
test("a group keeps one real message, not only the normalised template", () => {
  const groups = groupFailures([
    run({ status: "failed", error: 'Node "http_1" failed: 404 from https://api.test/a' }),
  ]);
  assert.equal(groups[0].template, 'Node "<q>" failed: <n> from <url>');
  assert.equal(groups[0].sample, 'Node "http_1" failed: 404 from https://api.test/a');
});

test("a failed run with no message still gets a row", () => {
  const groups = groupFailures([run({ status: "failed", error: null })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].template, "(no message)");
});

test("the group list is capped so it stays readable", () => {
  const groups = groupFailures(
    Array.from({ length: 30 }, (_, i) => run({ status: "failed", error: `distinct failure ${"x".repeat(i + 1)}` })),
  );
  assert.ok(groups.length <= 8, `got ${groups.length}`);
});

/* ------------------------------------------------------------------ *
 * types — the range, which comes from a query string
 * ------------------------------------------------------------------ */

test("an unknown, absent or hostile range falls back to the default", () => {
  for (const value of [null, undefined, "", "0", "-1", "9999", "abc", "7; drop table run"]) {
    assert.equal(parseRange(value), DEFAULT_RANGE);
  }
});

test("each offered range parses to itself", () => {
  for (const range of RANGES) assert.equal(parseRange(String(range)), range);
});
