import { handle, ok, requireOwnerId } from "@/lib/api";
import { finishUnclaimedRun, requestCancel } from "@/lib/engine/lease";
import { describeRun, getRun } from "@/lib/engine/run";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Ask a run to stop — `BUILD_PLAN.md` Phase 17, "add a run cancellation path".
 *
 * Two outcomes, and the difference is whether anybody is executing the run:
 *
 *  - **Nothing holds it** (a durable run still `queued`, or one whose worker has already
 *    gone) — it is finished `cancelled` here and now, so a queued run does not sit
 *    waiting to be cancelled by a delivery that may be a minute away.
 *  - **A worker holds it** — the request is recorded and the engine reads it at its next
 *    checkpoint, which is the end of the step it is currently running.
 *
 * **The second case is honest about its granularity, and the UI says so too.** A node
 * already talking to Gmail is not interrupted, because a request in flight cannot be
 * un-sent. So this endpoint promises "no further steps will run", never "nothing more
 * will happen" — and it returns the run, so the caller can see which of the two it got
 * rather than being told "cancelled" and having to believe it.
 *
 * Idempotent, and by construction rather than by a special case: `requestCancel` matches
 * nothing once a run is terminal, `finishUnclaimedRun` matches nothing once it is either
 * terminal or leased, and the run is read back and returned regardless. Cancelling a
 * finished run is therefore a no-op that answers with the run — which is the useful reply
 * to "stop this" when it has already stopped.
 *
 * Owner scoping needs no separate check: `requestCancel` filters on `ownerId`, so another
 * user's run is untouched, and the read-back is `getRun`, which 404s on it (D-era rule:
 * somebody else's record is indistinguishable from one that does not exist).
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;

    const asked = await requestCancel({ runId: id, ownerId });
    if (asked) {
      await finishUnclaimedRun({
        runId: id,
        status: "cancelled",
        error: "The run was cancelled before it started.",
      });
    }

    const { run, steps } = await getRun(ownerId, id);
    return ok(describeRun(run, steps));
  });
}
