import { errorGroup } from "@/lib/logging";

import type { DayBucket, FailureGroup, Totals } from "./types";

/**
 * **Turning rows into the shapes the page draws — Phase 22.**
 *
 * Separate from `queries.ts` for the reason `engine/recorder.ts` gives for being the only
 * module in the engine that imports `@/db`: everything here is a pure function over plain
 * rows, so the arithmetic that decides what a success rate *means* is asserted in a
 * millisecond with no database, and the module that talks to Postgres has no arithmetic
 * left in it to get wrong.
 */

/** A run as the aggregate queries return it. Deliberately the minimum. */
export interface RunRow {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

/**
 * The p-th percentile by **nearest-rank**, over an already-sorted ascending array.
 *
 * Nearest-rank rather than an interpolating definition, because every value here is a
 * measured duration of a real run: the 95th percentile ought to be a number that actually
 * happened, not the average of two that did. With eleven runs in a window — which is the
 * realistic case for this product for a long while — an interpolated p95 invents a
 * latency no node ever took, and somebody eventually goes looking for the run that
 * produced it.
 */
export function percentile(sortedAscending: readonly number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.min(Math.max(rank, 1), sortedAscending.length) - 1];
}

export function median(sortedAscending: readonly number[]): number | null {
  return percentile(sortedAscending, 50);
}

/**
 * An aggregated list of durations, from whatever shape the driver handed back, as a
 * sorted array of finite numbers.
 *
 * **This exists because of a defect, and the defect is worth recording.** The node
 * latency query aggregates each type's step durations and takes a percentile of them.
 * Written with `array_agg`, `@neondatabase/serverless` returns a Postgres array over
 * HTTP as its *text literal* — `{1200,34,5}` — not as a JavaScript array, so `.map` threw
 * and the whole analytics route answered 500. `jsonb_agg` is the fix in the query,
 * because JSONB is parsed as JSON by every driver; this is the belt to that braces, and
 * it is where the three shapes are pinned by a test.
 *
 * The sort is not incidental. `percentile` takes an ascending array, and a numeric that
 * arrives as a string sorts lexicographically — `"9"` after `"1000"` — which reports a
 * p95 *below* the median and looks like an arithmetic bug rather than a type one.
 */
export function toDurations(value: unknown): number[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/^\{|\}$/g, "").split(",")
      : [];

  return raw
    .filter((entry) => {
      // `Number(null)` and `Number("")` are both 0, which is finite — so filtering on
      // `isFinite` alone turns every absent duration into a zero-millisecond step and
      // drags the median of that node type towards nothing. An empty aggregate splits to
      // `[""]`, so this is the case that keeps `toDurations("{}")` empty as well.
      if (entry === null || entry === undefined) return false;
      return typeof entry !== "string" || entry.trim() !== "";
    })
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
    .sort((a, b) => a - b);
}

/** `YYYY-MM-DD` in UTC. The bucket key, and the axis label. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * One bucket per day in `[from, to]`, **including the days nothing ran**.
 *
 * The zeros are the point. A bar chart built only from the days that have rows draws a
 * dense, healthy-looking week out of two runs three days apart, because the gap between
 * them is not rendered at all. Filling the range is what makes an idle stretch look idle.
 */
export function bucketByDay(runs: readonly RunRow[], from: Date, to: Date): DayBucket[] {
  const buckets = new Map<string, DayBucket>();

  for (
    let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    cursor <= to.getTime();
    cursor += 86_400_000
  ) {
    const day = utcDay(new Date(cursor));
    buckets.set(day, { day, succeeded: 0, failed: 0, cancelled: 0, other: 0, total: 0 });
  }

  for (const run of runs) {
    const bucket = buckets.get(utcDay(run.startedAt));
    // A run outside the window cannot happen given the query, but a bucket miss must not
    // throw a page away: the count is simply not shown rather than the chart not drawn.
    if (!bucket) continue;
    if (run.status === "succeeded") bucket.succeeded += 1;
    else if (run.status === "failed") bucket.failed += 1;
    else if (run.status === "cancelled") bucket.cancelled += 1;
    else bucket.other += 1;
    bucket.total += 1;
  }

  return [...buckets.values()];
}

export function summarise(runs: readonly RunRow[]): Totals {
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  const durations: number[] = [];

  for (const run of runs) {
    if (run.status === "succeeded") succeeded += 1;
    else if (run.status === "failed") failed += 1;
    else if (run.status === "cancelled") cancelled += 1;

    if (run.finishedAt && (run.status === "succeeded" || run.status === "failed")) {
      durations.push(run.finishedAt.getTime() - run.startedAt.getTime());
    }
  }

  durations.sort((a, b) => a - b);
  const settled = succeeded + failed + cancelled;

  return {
    runs: runs.length,
    succeeded,
    failed,
    cancelled,
    settled,
    /**
     * **Cancelled runs are in the denominator and not in the numerator**, and a run still
     * in flight is in neither. A cancellation is a run that did not do what it was asked
     * to; excluding it would let a workspace that cancels half its runs report a perfect
     * record. A `running` run has not succeeded or failed *yet*, and counting it as
     * either is reporting a result that does not exist.
     *
     * Null, not 1, when nothing has settled — a workspace with no history has no success
     * rate, and showing it 100% is a fabricated number on the first screen a new user sees.
     */
    successRate: settled === 0 ? null : succeeded / settled,
    medianMs: median(durations),
    p95Ms: percentile(durations, 95),
  };
}

/** The most failure groups shown. Past this it is a list nobody reads. */
const MAX_GROUPS = 8;

/**
 * Distinct failures, most frequent first, using the same normaliser the logs use — so a
 * group id read off this page can be pasted into the Logs Explorer and find its own
 * lines (`lib/logging/fingerprint.ts`).
 */
export function groupFailures(runs: readonly RunRow[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();

  for (const run of runs) {
    if (run.status !== "failed") continue;
    const { id, template } = errorGroup(run.error);
    const existing = groups.get(id);

    if (!existing) {
      groups.set(id, {
        id,
        template,
        count: 1,
        lastSeen: run.startedAt.toISOString(),
        sample: run.error ?? "(no message)",
        sampleRunId: run.id,
      });
      continue;
    }

    existing.count += 1;
    // Keep the newest as the sample, not the first: an operator opening a group wants the
    // occurrence they can still do something about.
    if (run.startedAt.toISOString() > existing.lastSeen) {
      existing.lastSeen = run.startedAt.toISOString();
      existing.sample = run.error ?? "(no message)";
      existing.sampleRunId = run.id;
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, MAX_GROUPS);
}
