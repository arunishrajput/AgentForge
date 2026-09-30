/**
 * Run analytics — `ARCHITECTURE.md` → *Observability*, Phase 22.
 *
 *   `types.ts`    the shape the page and the API both return. No `Date` crosses it
 *   `shape.ts`    pure arithmetic over rows — percentiles, day buckets, error groups
 *   `queries.ts`  the three statements, and the note on why there are only three
 *
 * **Computed from the `run` and `run_step` rows the engine already writes.** No event
 * pipeline, no third-party SDK, no rollup table and nothing on a clock — see the note at
 * the top of `queries.ts` for what that costs on Neon's free plan and why it is the
 * design rather than a shortcut.
 */

export { readAnalytics } from "./queries";
export {
  bucketByDay,
  groupFailures,
  median,
  percentile,
  summarise,
  utcDay,
  type RunRow,
} from "./shape";
export {
  DEFAULT_RANGE,
  parseRange,
  RANGES,
  type Analytics,
  type DayBucket,
  type FailureGroup,
  type ModelStat,
  type NodeStat,
  type Range,
  type Totals,
} from "./types";
