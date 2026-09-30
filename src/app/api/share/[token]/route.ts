import { fail, handle, ok } from "@/lib/api";
import { shareWorkflow } from "@/lib/workflow/share";
import { findSharedWorkflow } from "@/lib/workflow/store";
import { SHARE_TOKEN_PATTERN } from "@/lib/workflow/visibility";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

/**
 * **The product's fourth route with no session** — after the webhook receiver, the cron
 * tick and the invitation preview (CONTRACT.md → *The three routes with no session*, now
 * four).
 *
 * It is the only one of the four whose risk is in the *response* rather than in what the
 * request can cause: a webhook starts a run, a tick fires schedules, an invitation preview
 * says one workspace name — this one hands back content. So the response is built by
 * `shareWorkflow` in `lib/workflow/share.ts` from an allowlist whose default publishes
 * nothing, and this route deliberately does no field selection of its own. One place
 * decides what a share link carries.
 *
 * What it cannot reach, by construction rather than by filtering: the workflow's
 * `webhookToken` and `shareToken`, its `ownerId` and `workspaceId`, the workspace's name
 * or members, any credential, and any run. `findSharedWorkflow` returns one workflow row
 * and this handler holds nothing else.
 *
 * **The token is pattern-checked before the database is asked** — the invitation route's
 * rule, and for the same two reasons: a malformed token costs no query, and a 404 that was
 * decided without a lookup cannot be timed against one that needed a lookup.
 *
 * Every dead link answers identically. Never existed, revoked, and revoked-then-reminted
 * are one message, so the endpoint cannot be used to sort real tokens from invented ones.
 */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { token } = await params;
    if (!SHARE_TOKEN_PATTERN.test(token)) {
      return fail("not_found", "That share link is not valid.");
    }

    const workflow = await findSharedWorkflow(token);
    if (!workflow) return fail("not_found", "That share link is not valid.");

    return ok(shareWorkflow(workflow));
  });
}
