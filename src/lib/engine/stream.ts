import type { StepLog } from "@/lib/nodes/types";

import type { RunTest } from "./partial";
import type { RunOrigin } from "./retry";
import {
  RESTING_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  type RunMode,
  type RunStatus,
  type StepStatus,
  type TriggerKind,
} from "./types";

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

/**
 * Wire shape of a run. The browser's `Run` is this type.
 *
 * Phase 17 added `mode`, `attempt` and `cancelRequested`. All three are things the
 * canvas cannot infer and a person watching a run genuinely needs: whether this run can
 * survive a deploy, whether it has already had to resume, and whether the Stop it just
 * pressed was registered.
 */
export interface StreamRun {
  id: string;
  workflowId: string;
  status: RunStatus;
  trigger: TriggerKind;
  mode: RunMode;
  /** Deliveries so far. Above 1 means this run resumed after an interruption. */
  attempt: number;
  /** A stop was asked for; the engine acts on it at its next step boundary. */
  cancelRequested: boolean;
  /** Phase 26: when a `waiting` run resumes. Null in every other status. */
  wakeAt: string | null;
  /** Phase 38: what a `waiting` run waits for — a decision or a delay. Null in every other status. */
  waitingFor: "approval" | "delay" | null;
  /**
   * Phase 31: whether this run is a test, and of what. Null on a real run. Like
   * `workflowVersion` it is fixed at creation, so it is not in `StreamRunPatch`.
   */
  test: RunTest | null;
  /**
   * Phase 33: the run this one was re-run or retried from. Null on an ordinary run. Fixed at
   * creation like `test`, so it is not in `StreamRunPatch` either.
   */
  origin: RunOrigin | null;
  /**
   * Phase 39: the run that called this one, and the node that made the call. Null on a run nothing
   * called. Fixed at creation like `origin`, so it is not in `StreamRunPatch` either.
   */
  parent: { runId: string; nodeId: string } | null;
  /** Phase 37: failures its on-error policies handled. Written when the run finishes. */
  handled: number;
  /**
   * The workflow version this run executed (Phase 18). Null for a run from before
   * versioning existed. It is **not** in `StreamRunPatch` below and must not be: it is
   * fixed at the run's creation, so a patch could never carry a new value for it.
   */
  workflowVersion: number | null;
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
  attempt: number;
  cancelRequested: boolean;
  wakeAt: string | null;
  /** Phase 38. Changes with the status, so it rides on the patch. */
  waitingFor: "approval" | "delay" | null;
  output: unknown;
  error: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** Phase 37. It changes with the status, when the run finishes, so it rides on the patch. */
  handled: number;
}

/**
 * Why a stream ended. The client closes the `EventSource` on any of them — an
 * `EventSource` reconnects by itself otherwise, and an idle reconnect loop is
 * exactly the billed-for-nothing case ARCHITECTURE.md rules out.
 */
export type StreamDoneReason = "finished" | "waiting" | "idle" | "timeout";

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
 * Terminal, or `waiting` (Phase 26): a run with nothing to report until something else
 * happens to it. A stream following one closes, exactly as it does on a finished run —
 * a two-day wait is not something to hold a billed connection open for (D31).
 */
export function isResting(status: RunStatus): boolean {
  return RESTING_RUN_STATUSES.includes(status);
}

/**
 * **How long a `waiting` run whose wake time has come counts as about to resume — Phase 38.**
 * Long enough for a Cloud Tasks delivery to reach a cold container (~7 s measured) many times over;
 * short enough that a wake that was lost — the daily sweep re-arms it — holds no stream open for long.
 */
export const WAKING_WINDOW_MS = 60_000;

/**
 * **A waiting run about to be claimed — Phase 38.** Its wake time has just come: a person decided its
 * approval (which sets `wakeAt` to now), or its delay is over. A stream keeps following it instead of
 * closing, so the canvas and the run page show it resume rather than a run that looks put down. Only
 * within `WAKING_WINDOW_MS`, and with a second's slack for the container's clock against Postgres's —
 * a heuristic for what to watch, never a decision about the run.
 */
export function waking(run: { status: RunStatus; wakeAt?: string | Date | null }, now = Date.now()): boolean {
  if (run.status !== "waiting" || !run.wakeAt) return false;
  const due = typeof run.wakeAt === "string" ? Date.parse(run.wakeAt) : run.wakeAt.getTime();
  return due <= now + 1_000 && now - due < WAKING_WINDOW_MS;
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
 *
 * **Phase 26 — a baseline that can wake.** A run `waiting` at the first poll is resting
 * like a finished one, so it is not reported — otherwise every reconnect would snapshot it
 * and close again at once. But unlike a finished run it will come back: the moment it is
 * claimed and is no longer `waiting`, it is followed, and the baseline is dropped so the
 * rest of its run streams normally. `baselineWaiting` is the one bit that tells the two
 * kinds of baseline apart.
 */
export function followDecision(
  candidate: { id: string; status: RunStatus; wakeAt?: string | Date | null } | null,
  options: {
    pinnedRunId?: string | null;
    baselineRunId: string | null;
    baselineWaiting?: boolean;
    firstPoll: boolean;
  },
): { follow: boolean; baselineRunId: string | null; baselineWaiting: boolean } {
  const baselineRunId = options.baselineRunId;
  const baselineWaiting = options.baselineWaiting ?? false;
  if (!candidate) return { follow: false, baselineRunId, baselineWaiting };

  if (options.pinnedRunId) {
    return { follow: candidate.id === options.pinnedRunId, baselineRunId, baselineWaiting };
  }

  if (candidate.id === baselineRunId) {
    if (baselineWaiting && candidate.status !== "waiting") {
      return { follow: true, baselineRunId: null, baselineWaiting: false };
    }
    return { follow: false, baselineRunId, baselineWaiting };
  }

  // A waiting run about to be woken (Phase 38) is not history: it is followed into its resumption.
  if (options.firstPoll && isResting(candidate.status) && !waking(candidate)) {
    return {
      follow: false,
      baselineRunId: candidate.id,
      baselineWaiting: candidate.status === "waiting",
    };
  }

  return { follow: true, baselineRunId, baselineWaiting };
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

/**
 * `attempt` and `cancelRequested` are in the fingerprint because both are events worth
 * telling the client about while the status is unchanged: a run that resumed is still
 * `running`, and so is a run that has just been asked to stop. Without them the canvas
 * would show "Running" through both and look like it had ignored the Stop button.
 */
function runFingerprint(run: StreamRun): string {
  return [
    run.status,
    run.finishedAt ?? "",
    run.error ?? "",
    run.attempt,
    run.cancelRequested ? "1" : "0",
    run.wakeAt ?? "",
    run.waitingFor ?? "",
  ].join(UNIT);
}

export function runPatch(run: StreamRun): StreamRunPatch {
  return {
    runId: run.id,
    status: run.status,
    attempt: run.attempt,
    cancelRequested: run.cancelRequested,
    wakeAt: run.wakeAt,
    waitingFor: run.waitingFor,
    output: run.output,
    error: run.error,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    handled: run.handled,
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
 *
 * `terminal` is whether the run is over; `resting` (Phase 26) is whether the stream may
 * close — over, or `waiting`. The route closes on `resting`.
 */
export function reconcile(
  state: StreamState,
  run: StreamRun | null,
): { events: StreamEvent[]; state: StreamState; terminal: boolean; resting: boolean } {
  if (!run) return { events: [], state, terminal: false, resting: false };

  const steps = run.steps ?? [];
  const terminal = isTerminal(run.status);
  // Phase 38: a waiting run whose wake time has just come is about to resume — keep following it.
  const resting = isResting(run.status) && !waking(run);

  if (run.id !== state.runId) {
    return {
      events: [{ event: "snapshot", data: run }],
      state: {
        runId: run.id,
        run: runFingerprint(run),
        steps: new Map(steps.map((step) => [step.seq, stepFingerprint(step)])),
      },
      terminal,
      resting,
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

  return { events, state: { runId: run.id, run: fingerprint, steps: next }, terminal, resting };
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
