import { fail, handle, ok } from "@/lib/api";
import { required } from "@/lib/env";
import { cronSecretMatches, runDueSchedules } from "@/lib/triggers/tick";

export const dynamic = "force-dynamic";

/**
 * Fires every due schedule trigger. Called by the `agentforge-cron` Cloud Scheduler
 * job (DEPLOYMENT.md → "Cloud Scheduler"), and by nobody else.
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

    // Logged because a schedule firing is otherwise invisible: nobody is watching at
    // 09:00, and `gcloud run services logs read` is how it gets confirmed after.
    console.log(
      `[cron] due=${outcome.due} fired=${outcome.fired.length} skipped=${outcome.skipped.length} cleared=${outcome.cleared.length}`,
    );

    return ok(outcome);
  });
}
