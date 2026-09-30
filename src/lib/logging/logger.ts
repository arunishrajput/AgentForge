import { errorGroup } from "./fingerprint";
import { logContext } from "./context";
import type { EventName, Severity } from "./events";

/**
 * **Structured logging — Phase 22.**
 *
 * One JSON object per line on stdout. That is the entire transport, and it is deliberate:
 * Cloud Run's runtime already parses a JSON line written to stdout into a Cloud Logging
 * `LogEntry`, promoting the reserved fields and keeping the rest as `jsonPayload`. So the
 * product gets structured logs, log-based metrics and Error Reporting from `console.log`,
 * with **no client library, no exporter, no background flush and no new dependency** —
 * and, because nothing is buffered, no log lost when a container is recycled mid-run,
 * which is exactly the moment the logs matter (`ARCHITECTURE.md` → *Observability*).
 *
 * `DEPLOYMENT.md` measured the allowance before this was designed: 50 GiB per project per
 * month, against 6.34 MB actually ingested in the preceding 30 days. This phase could
 * raise the volume a thousandfold and still be free.
 *
 * **Reserved fields, and why each is spelled the way it is.** These names are Cloud
 * Logging's, not this project's, and a typo in one silently demotes it to an ordinary
 * payload field that no filter and no alerting policy will ever see:
 *
 *   severity                              drives colour, `severity>=ERROR`, Error Reporting
 *   message                               the line the Logs Explorer shows collapsed
 *   logging.googleapis.com/trace          joins this entry to Cloud Run's own request log
 *   logging.googleapis.com/labels         indexed key/values; where `event` is duplicated
 *
 * **What must never be logged.** No secret, no credential, no ciphertext, no node input or
 * output, no prompt and no model completion. A run's payloads are the user's data and
 * often the user's customer's data; they live in `run_step` behind the same authorisation
 * as everything else, and a log is a second copy with none of it. What goes here is ids,
 * names from the registry, statuses, counts and durations. `redact` is the backstop, not
 * the policy — the policy is that call sites pass facts, not payloads.
 */

/** Fields a call site may attach. Scalars only — see the note on payloads above. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * The longest a single string field may be. Long enough for an error message and a
 * template, short enough that a node that fails with a JSON body in its message cannot
 * turn one log line into a kilobyte.
 */
const MAX_FIELD = 512;

function redact(value: string | number | boolean | null | undefined): string | number | boolean | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD - 1)}…` : value;
  // A backstop, not the policy. A connection string is the one secret shape that reaches
  // a log by accident rather than by carelessness, because drivers put it in their own
  // error messages — which is how `/api/health` came to strip it in Phase 2.
  return trimmed.replace(/[a-z]+:\/\/[^\s]*@[^\s]*/gi, "[redacted-connection-string]");
}

/** Exported for the tests, and for `emit` to be swappable without a module mock. */
export function buildEntry(
  severity: Severity,
  event: EventName,
  message: string,
  fields: LogFields = {},
): Record<string, unknown> {
  const context = logContext();
  const payload: Record<string, unknown> = {
    severity,
    message: redact(message),
    event,
    ...(context.trace ? { "logging.googleapis.com/trace": context.trace } : {}),
    // Duplicated into labels because a label is indexed and a payload field is not:
    // `labels.event="run.finished"` is the filter every metric in `OPERATIONS.md` opens
    // with, and it stays fast as the log grows.
    "logging.googleapis.com/labels": { event },
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.workflowId ? { workflowId: context.workflowId } : {}),
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    payload[key] = redact(value);
  }

  return payload;
}

/**
 * **Silenced under `npm test`, and only there.**
 *
 * The engine emits a `node.finished` per step, and the critical-path suites execute
 * hundreds of workflows — unsilenced, a test run buries its own assertions under
 * thousands of JSON lines and nobody reads the output that tells them what broke.
 *
 * It switches on an explicit variable set by `scripts/test-register.mjs`, not on
 * `NODE_ENV`, because `NODE_ENV` is a deployment fact and this is a test-harness fact;
 * conflating them is how a real deployment ends up silent because something set
 * `NODE_ENV=test`.
 *
 * **Read per call rather than captured once**, so a test that needs to prove an event is
 * genuinely emitted — `gemini.test.ts` does, for the model-fallback metric — can unset
 * the variable around the call it is asserting. That is an environment variable doing
 * what environment variables do, not a test-only back door into production code, and it
 * costs one property read per log line.
 */
function silent(): boolean {
  return process.env.AGENTFORGE_LOG_SILENT === "1";
}

/**
 * The one write. `console.error` for `ERROR` so the entry lands on stderr, which Cloud
 * Run maps to a severity floor of its own; `console.log` otherwise.
 *
 * **Never throws.** An observability failure that fails the request it was observing is
 * strictly worse than no observability, and a `JSON.stringify` over a field bag can
 * always meet a circular reference somebody added later.
 */
function emit(severity: Severity, entry: Record<string, unknown>): void {
  if (silent()) return;
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ severity, message: "A log entry could not be serialised.", event: entry.event });
  }
  if (severity === "ERROR") console.error(line);
  else console.log(line);
}

export function logInfo(event: EventName, message: string, fields?: LogFields): void {
  emit("INFO", buildEntry("INFO", event, message, fields));
}

export function logWarn(event: EventName, message: string, fields?: LogFields): void {
  emit("WARNING", buildEntry("WARNING", event, message, fields));
}

/**
 * An error, with its group attached.
 *
 * The group is computed here rather than at the call site so that **the grouping the
 * analytics page shows and the grouping the logs show are the same function** — one
 * normaliser, used by both, which is the only way a `errorGroup` seen on a chart can be
 * pasted into the Logs Explorer and find its own lines.
 */
export function logError(
  event: EventName,
  message: string,
  error?: unknown,
  fields?: LogFields,
): void {
  const detail = error instanceof Error ? error.message : error === undefined ? "" : String(error);
  const group = errorGroup(detail || message);
  emit(
    "ERROR",
    buildEntry("ERROR", event, message, {
      ...fields,
      ...(detail ? { detail } : {}),
      errorGroup: group.id,
      errorTemplate: group.template,
      // Error Reporting groups on `stack_trace`; without it an entry is a log line and
      // not an incident. The name is kept because `TypeError` and `NodeError` reaching
      // the same handler are different bugs.
      ...(error instanceof Error ? { errorName: error.name } : {}),
    }),
  );
}
