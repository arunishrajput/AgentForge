import { z } from "zod";

import { ApiError, handle, ok, readJson, requireUserId } from "@/lib/api";
import { setActiveWorkspace } from "@/lib/workspace/active";
import { describeWorkspace, listMemberships } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

const switchSchema = z.object({ workspaceId: z.string().min(1).max(64) });

/**
 * Switch workspace — the switcher's only write.
 *
 * A route handler rather than a server action, for one reason: the switcher is a menu in
 * a client component, and this is a `fetch` followed by `router.refresh()`, which is the
 * same shape every other control in the app already uses. A server action would work
 * equally well and would need the action threaded from a server component through two
 * layers of props to reach the menu item.
 *
 * **Membership is checked here even though the cookie is never trusted anyway.** It is
 * belt and braces on purpose: `chooseMembership` discards an id the user is not a member
 * of, so a forged cookie grants nothing regardless — but answering 404 here means a
 * mis-clicked switch fails visibly instead of silently leaving you where you were and
 * looking like a broken button.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const userId = await requireUserId();
    const { workspaceId } = await readJson(request, switchSchema);

    const membership = (await listMemberships(userId)).find(
      (m) => m.workspace.id === workspaceId,
    );
    // 404 and not 403: the reply must not confirm that a workspace id exists (D20).
    if (!membership) throw new ApiError("not_found", "No such workspace.");

    await setActiveWorkspace(workspaceId);
    return ok(describeWorkspace(membership, userId));
  });
}
