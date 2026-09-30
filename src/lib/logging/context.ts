import { AsyncLocalStorage } from "node:async_hooks";

/**
 * **The ambient correlation context — Phase 22.**
 *
 * Every log line this product writes should name the request it belongs to, and most of
 * them are written five or six frames below the handler that knows what that request is:
 * `executeWorkflow` does not take a logger and must not start to, because it is the one
 * module the critical-path tests run with no database, no session and no request.
 *
 * `AsyncLocalStorage` is what lets the context travel without a parameter. It is part of
 * Node, it costs nothing when nothing is stored, and it is the mechanism every tracing
 * library in this ecosystem uses. The alternative — threading a logger through
 * `startRun → drive → executeWorkflow → runNode → definition.execute` — would put an
 * observability concern in the signature of the node interface, which is a contract
 * `CONTRACT.md` pins and Phase 23 is about to add to.
 *
 * **The context is additive and never replaces.** `withLogContext` merges onto whatever
 * is already there, so a run started inside a request keeps the request's trace *and*
 * gains the run id, and a run delivered by Cloud Tasks — which has no session and no
 * caller — simply has no user on it. Nothing here ever fails a request: an absent
 * context yields an empty object.
 */
export interface LogContext {
  /**
   * **Cloud Run's own trace id**, taken from `X-Cloud-Trace-Context`, not minted here.
   *
   * That is the whole point of it. Cloud Run already writes a request log for every
   * request — method, path, status, latency, user agent — and charges nothing for it.
   * Emitting the same trace id on our entries joins ours to that one, so the Logs
   * Explorer shows a failure and the request that caused it as one thread, and this
   * product never pays to duplicate a record Google is already keeping.
   *
   * Off Cloud Run there is no such header, so one is minted and the join is simply to
   * our own lines. See `traceFromHeaders`.
   */
  trace?: string;
  userId?: string;
  workspaceId?: string;
  runId?: string;
  workflowId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** The ambient context, or an empty one outside a request. Never throws. */
export function logContext(): LogContext {
  return storage.getStore() ?? {};
}

/** Runs `fn` with `fields` merged onto the ambient context. */
export function withLogContext<T>(fields: LogContext, fn: () => T): T {
  return storage.run({ ...logContext(), ...fields }, fn);
}

/**
 * Adds fields to the **current** context in place, for the case where the identifier is
 * only learned part-way through the work it belongs to: a route knows its workspace only
 * after `requireScope()` has resolved it, by which point the context is already open.
 *
 * A no-op outside a context, which is what makes it safe to call from a store function
 * that is equally reachable from a script.
 */
export function addLogContext(fields: LogContext): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}

/**
 * `X-Cloud-Trace-Context` is `TRACE_ID/SPAN_ID;o=1`. Only the trace id is wanted, and
 * only if it looks like one — a header is caller-controlled, and an unvalidated value
 * written into a log field is how a log gets forged entries. 32 hex characters or
 * nothing.
 */
export function traceFromHeaders(headers: Headers | null | undefined): string {
  const raw = headers?.get("x-cloud-trace-context") ?? "";
  const id = raw.split("/")[0]?.trim() ?? "";
  if (/^[0-9a-f]{32}$/i.test(id)) return id.toLowerCase();
  return crypto.randomUUID().replace(/-/g, "");
}
