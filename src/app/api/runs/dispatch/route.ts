import { z } from "zod";

import { fail, handle, ok, readJson } from "@/lib/api";
import { required } from "@/lib/env";
import { DISPATCH_TOKEN_PATTERN } from "@/lib/engine/lease";
import { describeDelivery } from "@/lib/engine/queue";
import { resumeRun } from "@/lib/engine/run";
import { logInfo } from "@/lib/logging";
import { cronSecretMatches } from "@/lib/triggers/secret";

export const dynamic = "force-dynamic";
/**
 * Above the engine's 120 s deadline and the queue's 300 s dispatch deadline, so the
 * platform never cuts a legitimate run short before the engine's own budget does.
 */
export const maxDuration = 600;

/**
 * The worker — Cloud Tasks delivers a run here and this executes it.
 *
 * **The third route with no session**, and the one that needed the most care, because it
 * is the only endpoint that can execute somebody else's workflow. Two independent
 * things must both hold:
 *
 *  1. **The shared `CRON_SECRET`**, compared in constant time, exactly as the cron tick
 *     does. It is the outer gate and it is carried in the task's headers — the same
 *     trust boundary Phase 8 already accepted when Cloud Scheduler began carrying this
 *     secret for `/api/cron/tick`.
 *  2. **The run's own `dispatchToken`** — 192 bits of CSPRNG on the run row. This is
 *     what actually authorises the work, and it is why this route is far narrower than
 *     the cron tick despite sharing a secret with it: the token names one run, so the
 *     most a holder can do is cause a run its owner already started to be resumed. It
 *     cannot start an arbitrary workflow, and it cannot start anything at all.
 *
 * `resumeRun` then makes even that harmless, because a redelivery of a run somebody
 * else is already executing fails to claim the lease and does nothing (`lease.ts`).
 *
 * **Why an OIDC token is not also demanded.** Cloud Tasks can sign a delivery with one,
 * but this service is `--allow-unauthenticated` — it has to be; it serves the app — so
 * Cloud Run would not check it and the app would have to verify the JWT itself against
 * Google's rotating JWKS. That is a real amount of security-critical code to write, and
 * it would sit *outside* the per-run token that is already the narrow thing here. If the
 * service is ever split so the worker is a private endpoint, OIDC becomes the right
 * answer and this comment is where to start.
 *
 * **Always 200 on a delivery it declines.** A 4xx or 5xx tells Cloud Tasks to retry, and
 * every declined case here — already finished, already claimed, forged token, deliveries
 * exhausted — is one where retrying is pointless or harmful. The body says which.
 */
const dispatchSchema = z.object({
  runId: z.string().min(1).max(128),
  token: z.string().regex(DISPATCH_TOKEN_PATTERN, "Not a dispatch token."),
});

export async function POST(request: Request) {
  return handle(async () => {
    const presented =
      request.headers.get("x-cron-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      null;

    if (!cronSecretMatches(presented, required("CRON_SECRET"))) {
      // Says nothing about which part was wrong, like every other machine endpoint.
      return fail("unauthenticated", "This endpoint requires the dispatch secret.");
    }

    const body = await readJson(request, dispatchSchema);
    const delivery = describeDelivery(request.headers);

    const outcome = await resumeRun({
      runId: body.runId,
      token: body.token,
      signal: request.signal,
    });

    // A run firing is otherwise invisible: nobody is watching a webhook-triggered run at
    // 03:00, and `gcloud run services logs read` is how it gets confirmed afterwards.
    // The retry count is the interesting half — it is how a resumed run is recognised.
    logInfo(
      "queue.delivered",
      outcome.handled
        ? `Delivery for run ${body.runId} completed: ${outcome.status}.`
        : `Delivery for run ${body.runId} declined: ${outcome.reason}.`,
      {
        handled: outcome.handled,
        status: outcome.handled ? outcome.status : null,
        reason: outcome.handled ? null : outcome.reason,
        // The interesting half: above zero means this run was redelivered, which is the
        // durability guarantee actually being exercised rather than merely configured.
        retryCount: delivery.retryCount ?? null,
      },
    );

    return ok({ runId: body.runId, ...outcome });
  });
}
