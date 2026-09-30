/**
 * Structured logging — `ARCHITECTURE.md` → *Observability*, Phase 22.
 *
 *   `events.ts`       every event name the product can emit, declared once
 *   `context.ts`      the ambient trace/run correlation, carried by `AsyncLocalStorage`
 *   `fingerprint.ts`  error grouping — one normaliser, shared with the analytics page
 *   `logger.ts`       the write: one JSON object per line on stdout, no dependency
 *
 * **What this replaced.** Sixteen bare `console.error("something:", error)` calls, which
 * were legible in a terminal and inert in production: Cloud Logging received them as
 * `textPayload`, so nothing could be filtered on, counted, grouped or alerted on, and a
 * failure could only be found by reading. Every one of them is now an event with a name
 * and fields.
 *
 * **Nothing here may throw.** See the note in `logger.ts`.
 */

export { EVENTS, type EventName, type Severity } from "./events";
export { errorGroup, normaliseError, type ErrorGroup } from "./fingerprint";
export {
  addLogContext,
  logContext,
  traceFromHeaders,
  withLogContext,
  type LogContext,
} from "./context";
export { buildEntry, logError, logInfo, logWarn, type LogFields } from "./logger";
