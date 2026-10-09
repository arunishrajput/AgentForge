/**
 * **The event catalogue — Phase 22, and the reason this file exists at all.**
 *
 * A log-based metric in Cloud Logging is a saved *filter string*. It lives in a GCP
 * resource, not in this repository, and nothing connects the two: rename an event here
 * and the metric keeps evaluating happily against a name nothing emits any more,
 * reporting zero forever. A metric that reads zero because the system is healthy and a
 * metric that reads zero because its filter stopped matching look identical on a chart.
 *
 * So every event name the product can emit is declared here, exactly once, and
 * `logging.test.ts` asserts that the filters recorded in `OPERATIONS.md` name only
 * events in this union. The filter strings are in the doc rather than in code because
 * they are operated, not executed — but the *names* they depend on are code, and this is
 * where they are pinned.
 *
 * **Adding an event means adding it here first.** The logger's signature requires it.
 */

export const EVENTS = [
  /** An API request that threw. Carries the error group, never the payload. */
  "api.error",
  /** A run row was created and execution was handed to something. */
  "run.started",
  /** A run reached a terminal status. **The run-volume and failure-rate metric.** */
  "run.finished",
  /**
   * A run paused until a wake time — Phase 26. Not a `run.finished`: the run is not over,
   * and counting it there would put one run in the volume metric twice.
   */
  "run.waiting",
  /**
   * A run nobody was watching failed, and it was announced — Phase 37: how many inboxes it reached
   * and how many error workflows it started. At error severity when the announcing itself failed.
   */
  "run.alerted",
  /** One node finished, succeeded or failed. **The node-latency metric.** */
  "node.finished",
  /** One `generate` call resolved. **The model-fallback metric** (`fallback: true`). */
  "model.call",
  /**
   * A workflow generation finished — Phase 34. `outcome` says which attempt produced the graph
   * (`first`, `second`) or that neither did (`failed`). **The generation-quality metric.** `mode`
   * tells generation (`create`) from the copilot's edit (Phase 35), explanation and diagnosis (36).
   */
  "generation.finished",
  /** A durable run could not be enqueued and fell back to in-process execution. */
  "queue.degraded",
  /** A Cloud Tasks delivery was handled — the worker side of a durable run. */
  "queue.delivered",
  /** The scheduled tick ran. Carries what it found, so an idle tick is still evidence. */
  "cron.tick",
  /**
   * A schedule timer was delivered — Phase 26: it fired a run, re-armed itself, or was
   * declined as stale. Since the tick became daily, this is how a schedule firing at 09:00
   * is confirmed afterwards.
   */
  "schedule.delivered",
  /** An operationally interesting refusal or repair that is nobody's request. */
  "system.warning",
] as const;

export type EventName = (typeof EVENTS)[number];

/**
 * Cloud Logging's own severity vocabulary. Written to the `severity` field, which is a
 * field it treats specially: it drives the colour in the Logs Explorer, the
 * `severity>=ERROR` filters every alerting policy is built on, and Error Reporting's
 * decision about whether an entry is worth grouping.
 *
 * Only the three this product can actually mean. `CRITICAL` and friends are omitted
 * because nothing here can honestly distinguish them from `ERROR`.
 */
export type Severity = "INFO" | "WARNING" | "ERROR";
