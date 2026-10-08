/**
 * The shape the analytics page and `GET /api/analytics` both return — Phase 22.
 *
 * It is a plain, fully-serialised object with no `Date` in it, for the reason
 * `DESIGN.md` records against hydration error #418: a date crossing to a client
 * component and being formatted with the machine's locale renders differently on the
 * server and in the browser. Everything here is a number, a string, or an ISO day.
 */

/** The windows offered. Bounded, and a link rather than a control that polls. */
export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export const DEFAULT_RANGE: Range = 30;

export function parseRange(value: string | null | undefined): Range {
  const parsed = Number(value);
  return (RANGES as readonly number[]).includes(parsed) ? (parsed as Range) : DEFAULT_RANGE;
}

/** One calendar day of runs. Present for every day in the window, zeros included. */
export interface DayBucket {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** `queued`, `running` and (Phase 26) `waiting` — a run not yet settled when the window was read. */
  other: number;
  total: number;
}

export interface Totals {
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** Runs that reached a terminal status. The denominator of `successRate`. */
  settled: number;
  /** 0–1, or null when nothing settled in the window — never a fabricated 100%. */
  successRate: number | null;
  /** Milliseconds, over settled runs with a finish time. Null when there are none. */
  medianMs: number | null;
  p95Ms: number | null;
}

/** A distinct failure, grouped by `lib/logging/fingerprint.ts`. */
export interface FailureGroup {
  id: string;
  template: string;
  count: number;
  /** ISO. The most recent occurrence, which is what decides whether it is still live. */
  lastSeen: string;
  /** One unredacted example, so an over-grouped row is recoverable by reading it. */
  sample: string;
  /** The run to open to see it. */
  sampleRunId: string;
}

export interface NodeStat {
  nodeType: string;
  /** The registry label, resolved by the caller. Absent for a type no longer registered. */
  label: string | null;
  runs: number;
  failures: number;
  medianMs: number | null;
  p95Ms: number | null;
  totalMs: number;
}

export interface ModelStat {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Analytics {
  range: Range;
  /** ISO. The start of the window, so a reader knows what "30 days" meant. */
  from: string;
  to: string;
  totals: Totals;
  days: DayBucket[];
  failures: FailureGroup[];
  nodes: NodeStat[];
  models: ModelStat[];
  /**
   * Test runs in the window — Phase 31. **Counted, and in no other figure on the page**: a test
   * of one node, or a run that used pinned outputs, says nothing about how the workflow does
   * when it runs for real, and a morning of building would otherwise read as a failure rate.
   * The count is shown so the page never quietly holds back runs a person can see elsewhere.
   */
  testRuns: number;
  /**
   * How long the queries took, end to end. Shown on the page and asserted by the
   * deployed suite, because `BUILD_PLAN.md` → Phase 22 makes measuring this feature's
   * database cost a completion criterion rather than a nicety.
   */
  queryMs: number;
}
