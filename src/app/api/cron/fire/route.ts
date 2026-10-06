import { z } from "zod";

import { fail, handle, ok, readJson } from "@/lib/api";
import { required } from "@/lib/env";
import { logInfo } from "@/lib/logging";
import { cronSecretMatches, FIRE_TOKEN_PATTERN } from "@/lib/triggers/secret";
import { deliverFire } from "@/lib/triggers/timer";

export const dynamic = "force-dynamic";
/** Above the queue's 300 s dispatch deadline, like the dispatch route. */
export const maxDuration = 600;

/**
 * A schedule timer's delivery — **Phase 26**, and the product's fourth machine endpoint.
 *
 * Cloud Tasks POSTs here at the moment a schedule is due, because a task was armed for
 * exactly that moment (`lib/triggers/timer.ts`). It replaced the `*\/15` sweep as the way
 * a schedule fires, which is what let the sweep become daily and Neon sleep.
 *
 * Two gates, both required, exactly as `POST /api/runs/dispatch` has (D82):
 *
 *  1. **`CRON_SECRET`**, compared in constant time, carried in the task's headers.
 *  2. **The slot's own token** — an HMAC over the workflow id and the slot, keyed by a
 *     different secret. It authorises firing that one slot of that one workflow, and the
 *     compare-and-set on the slot then lets it fire at most once (D42).
 *
 * Even both together cannot make a schedule fire early, late or twice: a slot that is not
 * yet due is re-armed rather than fired, and a slot that is no longer current is declined.
 *
 * **Always 200 on a delivery it declines**, for the dispatch route's reason: a 4xx or 5xx
 * tells Cloud Tasks to retry, and every declined case here — a forged token, a deleted
 * workflow, a slot that moved — is one where retrying is pointless. The body says which.
 */
const fireSchema = z.object({
  workflowId: z.string().min(1).max(128),
  scheduledFor: z.iso.datetime(),
  token: z.string().regex(FIRE_TOKEN_PATTERN, "Not a schedule token."),
});

export async function POST(request: Request) {
  return handle(async () => {
    const presented =
      request.headers.get("x-cron-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      null;

    if (!cronSecretMatches(presented, required("CRON_SECRET"))) {
      // Says nothing about which part was wrong, like every other machine endpoint.
      return fail("unauthenticated", "This endpoint requires the cron secret.");
    }

    const body = await readJson(request, fireSchema);
    const outcome = await deliverFire(body, new Date(), request.signal);

    /**
     * Logged whatever happened, because a schedule firing at 09:00 is otherwise invisible
     * now that the tick is daily — and a timer declined as `stale` is the evidence that
     * editing a schedule after arming it started nothing.
     */
    logInfo("schedule.delivered", `A schedule timer for workflow ${body.workflowId} was delivered: ${outcome.kind}.`, {
      workflowId: body.workflowId,
      scheduledFor: body.scheduledFor,
      outcome: outcome.kind,
      reason: outcome.kind === "declined" ? outcome.reason : null,
      runId: outcome.kind === "fired" ? outcome.runId : null,
    });

    return ok({ workflowId: body.workflowId, scheduledFor: body.scheduledFor, ...outcome });
  });
}
