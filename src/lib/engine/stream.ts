import type { StepLog } from "@/lib/nodes/types";

import { TERMINAL_RUN_STATUSES, type RunStatus, type StepStatus, type TriggerKind } from "./types";

/**
 * The SSE protocol — CONTRACT.md → "SSE event messages".
 *
 * This module is pure: no database, no `Response`, no React. It owns the wire
 * shapes, the framing, and the decision of *what changed*, so all three are
 * asserted on Node with no network — the same reason the engine takes its recorder
 * as an argument (D18).
 *
 * The stream reads the run and step rows rather than subscribing to an in-process
 * emitter (D27). A webhook-triggered run is started by a different request from the
 * one watching it, and on Cloud Run those can be different containers; an emitter
 * would silently show nothing. Reading rows also makes "connect mid-run",
 * "reconnect" and "reload the page" one code path instead of three.
 */

/** Wire shape of a step. The browser's `RunStep` is this type. */
export interface StreamStep {
  seq: number;
  nodeId: string;
  nodeType: string;
  iteration: number;
  status: StepStatus;
  config: unknown;
  input: unknown;
  output: unknown;
  branch: string | null;
  logs: StepLog[] | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Wire shape of a run. The browser's `Run` is this type. */
export interface StreamRun {
  id: string;
  workflowId: string;
  status: RunStatus;
  trigger: TriggerKind;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  steps?: StreamStep[];
}

/** Patch carried by a `run` event: the run's own fields, never its steps. */
export interface StreamRunPatch {
  runId: string;
  status: RunStatus;
  output: unknown;
  error: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

/**
 * Why a stream ended. The client closes the `EventSource` on any of them — an
 * `EventSource` reconnects by itself otherwise, and an idle reconnect loop is
 * exactly the billed-for-nothing case ARCHITECTURE.md rules out.
 */
export type StreamDoneReason = "finished" | "idle" | "timeout";

/**
 * `stream_error`, not `error`: a server-sent event named `error` is dispatched on
 * the `EventSource` as an `error` event, indistinguishable from a transport
 * failure.
 */
export type StreamEventName = "snapshot" | "step" | "run" | "done" | "stream_error";

export interface StreamEvent {
  event: StreamEventName;
  data: unknown;
}

/** How often the stream re-reads the run. Two statements per poll, only while open. */
export const STREAM_POLL_MS = 300;
/** A comment frame after this long with nothing to say, so a quiet stream stays alive. */
export const STREAM_KEEPALIVE_MS = 15_000;
/** Give up waiting for a run to appear. A run row exists within ms of the trigger. */
export const STREAM_IDLE_MS = 20_000;
/** Absolute ceiling, above the engine's 120 s deadline and far below Cloud Run's. */
export const STREAM_MAX_MS = 150_000;

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

/**
 * Which run, if any, this poll should report.
 *
 * The hard part is distinguishing "the run the client is waiting for" from "the run
 * that happened just before it connected", because the client opens the stream and
 * only then triggers the run, so at the first poll the newest run may well be the
 * previous one.
 *
 * The rule is: **a run that was already finished the first time this stream looked is
 * history.** Its id becomes a baseline and it is never reported; anything with a
 * different id is. No timestamps are compared, which matters — `openedAt` would come
 * from the container's clock and `startedAt` from Postgres's, and a first attempt at
 * this used a five-second window against those two clocks. It adopted the wrong run
 * the first time it ran against Cloud Run.
 *
 * The one case this gives up: a run that both starts *and* finishes before the
 * stream's first poll, a window of one poll interval, is treated as history. The
 * client is not left wrong — `POST /runs` returns that run's final state, which is
 * what the canvas shows regardless of whether a stream was watching.
 */
export function followDecision(
  candidate: { id: string; status: RunStatus } | null,
  options: {
    pinnedRunId?: string | null;
    baselineRunId: string | null;
    firstPoll: boolean;
  },
): { follow: boolean; baselineRunId: string | null } {
  const baselineRunId = options.baselineRunId;
  if (!candidate) return { follow: false, baselineRunId };

  if (options.pinnedRunId) {
    return { follow: candidate.id === options.pinnedRunId, baselineRunId };
  }

  if (candidate.id === baselineRunId) return { follow: false, baselineRunId };

  if (options.firstPoll && isTerminal(candidate.status)) {
    return { follow: false, baselineRunId: candidate.id };
  }

  return { follow: true, baselineRunId };
}

/**
 * What the stream has already sent, as fingerprints rather than copies of the rows.
 * A step is append-only apart from its status, outcome and log tail, so a short
 * string per step distinguishes "changed" from "unchanged" without holding every
 * payload in memory for the life of the stream.
 */
export interface StreamState {
  runId: string | null;
  run: string | null;
  steps: Map<number, string>;
}

export function emptyStreamState(): StreamState {
  return { runId: null, run: null, steps: new Map() };
}

const UNIT = "\u0000";

function stepFingerprint(step: StreamStep): string {
  // `logs.length` is sound because logs are append-only: an entry is never edited.
  return [
    step.status,
    step.finishedAt ?? "",
    step.branch ?? "",
    step.error ?? "",
    step.logs?.length ?? 0,
  ].join(UNIT);
}

function runFingerprint(run: StreamRun): string {
  return [run.status, run.finishedAt ?? "", run.error ?? ""].join(UNIT);
}

export function runPatch(run: StreamRun): StreamRunPatch {
  return {
    runId: run.id,
    status: run.status,
    output: run.output,
    error: run.error,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
  };
}

/**
 * Turn "here is the run as the database has it now" into the events a client has
 * not seen yet.
 *
 * A run the stream has not seen before is always sent whole, as a `snapshot`. That
 * is the entire recovery story: a client connecting mid-run, reconnecting after a
 * dropped connection, or reloading the page gets correct state by construction,
 * with no event ids, no replay buffer and no `Last-Event-ID` handling on either
 * side (D29).
 *
 * Steps are emitted before the run-level change, so a client holds every final step
 * status before it is told the run is over.
 */
export function reconcile(
  state: StreamState,
  run: StreamRun | null,
): { events: StreamEvent[]; state: StreamState; terminal: boolean } {
  if (!run) return { events: [], state, terminal: false };

  const steps = run.steps ?? [];
  const terminal = isTerminal(run.status);

  if (run.id !== state.runId) {
    return {
      events: [{ event: "snapshot", data: run }],
      state: {
        runId: run.id,
        run: runFingerprint(run),
        steps: new Map(steps.map((step) => [step.seq, stepFingerprint(step)])),
      },
      terminal,
    };
  }

  const events: StreamEvent[] = [];
  const next = new Map(state.steps);

  for (const step of steps) {
    const fingerprint = stepFingerprint(step);
    if (next.get(step.seq) === fingerprint) continue;
    next.set(step.seq, fingerprint);
    events.push({ event: "step", data: { runId: run.id, step } });
  }

  const fingerprint = runFingerprint(run);
  if (fingerprint !== state.run) {
    events.push({ event: "run", data: runPatch(run) });
  }

  return { events, state: { runId: run.id, run: fingerprint, steps: next }, terminal };
}

/**
 * SSE framing. `data` must not contain a raw newline or the frame ends early —
 * `JSON.stringify` escapes every one, so a single `data:` line is always valid.
 */
export function formatEvent(event: StreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** A comment frame. Keeps an idle connection from being dropped by an intermediary. */
export function formatComment(text: string): string {
  return `: ${text}\n\n`;
}

/**
 * Headers the stream must carry.
 *
 * `no-transform` is the one worth explaining. Next's production server runs the
 * standard `compression` middleware and it is genuinely active — an HTML response
 * from this build comes back `content-encoding: gzip`. That middleware buffers until
 * 1 KiB has accumulated and counts `text/event-stream` as compressible, which would
 * present exactly as a broken stream. Measured on Next 16.3.6, a route handler's
 * response appears to bypass it, but that is an implementation detail and not
 * something to build a demo on; `no-transform` is the documented way to opt out and
 * `compression` honours it. `x-accel-buffering` says the same thing to any
 * nginx-shaped proxy in the path.
 */
export const STREAM_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-store, no-transform",
  "x-accel-buffering": "no",
};
