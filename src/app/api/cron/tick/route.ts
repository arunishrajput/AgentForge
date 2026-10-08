import { fail, handle, ok } from "@/lib/api";
import { required } from "@/lib/env";
import { logInfo } from "@/lib/logging";
import { cronSecretMatches, runDueSchedules } from "@/lib/triggers/tick";

export const dynamic = "force-dynamic";

/**
 * The daily safety sweep. Called by the `agentforge-cron` Cloud Scheduler job
 * (DEPLOYMENT.md → "Cloud Scheduler"), and by nobody else.
 *
 * **Since Phase 26 it does not fire schedules on time** — each slot has its own Cloud
 * Tasks timer delivered to `POST /api/cron/fire`. This catches what a timer cannot catch
 * for itself: a lost timer, a lost wake, and the housekeeping (`lib/triggers/tick.ts`).
 *
 * **The second route with no session**, and unlike the webhook receiver it acts
 * across every owner — so the shared secret is the only thing standing in front of
 * it, compared in constant time. It is POST-only and returns 401 without the secret,
 * including for a request that presents none.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const presented =
      request.headers.get("x-cron-secret") ??
      // Cloud Scheduler sends a custom header; `Authorization: Bearer` is accepted
      // too so the job can be moved to an OIDC-style header without a code change.
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      null;

    if (!cronSecretMatches(presented, required("CRON_SECRET"))) {
      // Deliberately says nothing about which part was wrong.
      return fail("unauthenticated", "This endpoint requires the cron secret.");
    }

    const outcome = await runDueSchedules({ signal: request.signal });

    /**
     * Logged because a schedule firing is otherwise invisible: nobody is watching at
     * 09:00, and the log is how it gets confirmed after.
     *
     * **An idle tick is logged too, and that is the point** — this is the only thing in
     * the product that runs on a clock, so its entry is the heartbeat that says the
     * scheduler is still wired up. `OPERATIONS.md` → *Is the scheduler alive* is a
     * filter on this event and, since Phase 26, an expectation of one a day.
     */
    logInfo(
      "cron.tick",
      `The sweep fired ${outcome.fired.length} of ${outcome.due} overdue schedules and armed ${outcome.armed}.`,
      {
        due: outcome.due,
        fired: outcome.fired.length,
        skipped: outcome.skipped.length,
        cleared: outcome.cleared.length,
        armed: outcome.armed,
        woken: outcome.woken,
        swept: outcome.swept,
        pruned: outcome.pruned,
        prunedRuns: outcome.prunedRuns,
      },
    );

    return ok(outcome);
  });
}
