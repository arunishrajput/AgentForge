import { ApiError, fail, requireApiScope } from "@/lib/api";
import type { WorkspaceScope } from "@/lib/workspace/scope";
import { describeRun, getRun, latestRun, readSteps } from "@/lib/engine/run";
import {
  STREAM_HEADERS,
  STREAM_IDLE_MS,
  STREAM_KEEPALIVE_MS,
  STREAM_MAX_MS,
  STREAM_POLL_MS,
  emptyStreamState,
  followDecision,
  formatComment,
  formatEvent,
  reconcile,
  type StreamDoneReason,
  type StreamRun,
  type StreamState,
} from "@/lib/engine/stream";
import { getWorkflow } from "@/lib/workflow/store";

import { addLogContext, logError, traceFromHeaders, withLogContext } from "@/lib/logging";
export const dynamic = "force-dynamic";

/**
 * Watch a workflow's current run — CONTRACT.md → "SSE event messages".
 *
 * Workflow-scoped rather than strictly per-run, which refines BUILD_PLAN Phase 5
 * task 3 (D28). A run fired by a webhook is started by somebody else's request, so
 * the browser has no run id to open a stream for; it can only say "show me what this
 * workflow is doing". `?runId=` pins one run when the id is known — a mid-run reload,
 * or a run opened from history.
 *
 * The stream polls the run and step rows (D27). That costs two statements per tick
 * against Neon while a stream is open, and buys correctness no matter which Cloud Run
 * instance serves the stream versus the run, plus reconnect and reload recovery for
 * free.
 *
 * It is never idle for long: it closes when the run reaches a terminal state, after
 * STREAM_IDLE_MS if no run ever appears, and at STREAM_MAX_MS regardless. Cloud Run
 * bills CPU for the whole time a stream is open.
 */

type Context = { params: Promise<{ id: string }> };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * **Phase 22.** The stream is one of the four routes that do not go through `handle`, so
 * it opens its own log context — and it is the one that most needs one: it is the only
 * connection in the product that stays open for minutes, and every `node.finished` of the
 * run it is watching is written while it is. Sharing the trace is what puts the stream
 * and the run it is streaming on the same thread in the Logs Explorer.
 */
export async function GET(request: Request, context: Context) {
  return withLogContext({ trace: traceFromHeaders(request.headers) }, () =>
    openStream(request, context),
  );
}

async function openStream(request: Request, { params }: Context) {
  let scope: WorkspaceScope;
  let workflowId: string;

  // Auth and workspace scoping happen before a single byte is streamed, so a failure
  // is an ordinary JSON error response. An `EventSource` given a non-200 fails without
  // retrying, which is the behaviour we want for 401 and 404.
  try {
    scope = await requireApiScope();
    const { id } = await params;
    await getWorkflow(scope, id);
    workflowId = id;
    addLogContext({ workflowId });
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message, error.details);
    logError("api.error", "A run stream could not be opened.", error);
    return fail("internal", "Something went wrong opening the stream.");
  }

  const pinnedRunId = new URL(request.url).searchParams.get("runId");
  const openedAt = Date.now();
  const encoder = new TextEncoder();

  let state: StreamState = emptyStreamState();
  let lastWriteAt = openedAt;
  let sawRun = false;
  let closed = false;
  /** The run that had already finished when this stream first looked — see followDecision. */
  let baselineRunId: string | null = null;
  /** Whether that run was `waiting` rather than finished, so it is followed when it wakes. */
  let baselineWaiting = false;
  let firstPoll = true;

  /** One poll: the run row, then its steps only if it is the run to follow. */
  const read = async (): Promise<StreamRun | null> => {
    if (pinnedRunId) {
      firstPoll = false;
      try {
        const { run, steps } = await getRun(scope, pinnedRunId);
        // Owner scoping came from `getRun`; this keeps the stream honest about which
        // workflow it claims to be watching.
        if (run.workflowId !== workflowId) return null;
        return describeRun(run, steps);
      } catch {
        return null;
      }
    }

    const candidate = await latestRun(scope, workflowId);
    const decision = followDecision(candidate, { baselineRunId, baselineWaiting, firstPoll });
    firstPoll = false;
    baselineRunId = decision.baselineRunId;
    baselineWaiting = decision.baselineWaiting;

    if (!candidate || !decision.follow) return null;
    return describeRun(candidate, await readSteps(candidate.id));
  };

  /**
   * The poll loop is driven from here rather than from a `pull` callback.
   *
   * `pull` is only invoked when the consumer asks for more, and Next's Node adapter
   * does not ask again once its queue is satisfied — so a `pull`-driven version sent
   * its opening frames and then went silent for ever, which is precisely the failure
   * that looks like a working stream until you watch the clock. Producing frames on
   * a timer instead gives up backpressure, which costs nothing: the events are a few
   * hundred bytes, three times a second.
   */
  async function pump(controller: ReadableStreamDefaultController<Uint8Array>) {
    const write = (text: string) => {
      controller.enqueue(encoder.encode(text));
      lastWriteAt = Date.now();
    };

    const finish = (reason: StreamDoneReason, runId: string | null) => {
      write(formatEvent({ event: "done", data: { runId, reason } }));
      closed = true;
      controller.close();
    };

    try {
      // `closed` is set by `finish()`, a closure called from inside this loop, which
      // the rule cannot follow.
      // oxlint-disable-next-line no-unmodified-loop-condition
      while (!closed) {
        const now = Date.now();
        if (now - openedAt > STREAM_MAX_MS) {
          finish("timeout", state.runId);
          return;
        }
        if (!sawRun && now - openedAt > STREAM_IDLE_MS) {
          finish("idle", null);
          return;
        }

        const run = await read();
        if (closed) return;
        if (run) sawRun = true;

        const result = reconcile(state, run);
        state = result.state;
        for (const event of result.events) write(formatEvent(event));

        if (result.resting) {
          finish(result.terminal ? "finished" : "waiting", state.runId);
          return;
        }

        if (Date.now() - lastWriteAt > STREAM_KEEPALIVE_MS) write(formatComment("ping"));

        await sleep(STREAM_POLL_MS);
      }
    } catch (error) {
      // A cancelled stream makes `enqueue` throw, which is the normal way this loop
      // ends when the client goes away — not worth a log line.
      if (closed) return;
      logError("api.error", "A run stream failed while open.", error, { workflowId });
      closed = true;
      try {
        controller.enqueue(
          encoder.encode(
            formatEvent({
              event: "stream_error",
              data: { message: "Lost contact with the run. Reload to see its result." },
            }),
          ),
        );
        controller.close();
      } catch {
        // The connection was already gone.
      }
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // `retry` sets the browser's reconnect backoff. The opening comment flushes the
      // headers immediately, so `onopen` fires before the first poll completes.
      controller.enqueue(encoder.encode("retry: 3000\n"));
      controller.enqueue(encoder.encode(formatComment("open")));
      // Deliberately not awaited: `start` must resolve for the response to begin.
      void pump(controller);
    },

    cancel() {
      // The client went away — a closed tab, a navigation, a dropped connection.
      closed = true;
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
