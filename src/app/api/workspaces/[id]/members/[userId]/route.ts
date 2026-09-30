import { handle, ok, readJson, requireScopeFor } from "@/lib/api";
import { clearActiveWorkspace } from "@/lib/workspace/active";
import {
  changeMemberRole,
  changeMemberRoleSchema,
  describeMember,
  removeMember,
} from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; userId: string }> };

/**
 * Remove a member — or leave, which is the same request aimed at yourself.
 *
 * **The role needed depends on who the target is, so it cannot be a `requireScopeFor`
 * argument.** Leaving needs nothing beyond membership; removing somebody else needs
 * `admin`; removing an owner needs `owner`; and removing the last owner is refused
 * whoever asks. `removalRefusal` in `lib/workspace/roles.ts` holds all four rules in one
 * place, which is why this route asks only for membership and lets the store decide.
 *
 * Leaving also clears the active-workspace cookie, so the next request resolves a
 * workspace the user is still in rather than falling back from a name they can no longer
 * reach.
 */
export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id, userId } = await params;
    const scope = await requireScopeFor(id);
    await removeMember(scope, userId);
    if (userId === scope.userId) await clearActiveWorkspace();
    return ok({ removed: userId });
  });
}

/**
 * Change a member's role — **Phase 20**, and what Phase 19B explicitly left behind: an
 * invitation fixed a role at the moment it was sent and nothing could move it afterwards.
 *
 * `requireScopeFor(id)` asks for membership and nothing more, for exactly the reason
 * `DELETE` above does: **the role this needs depends on who the target is and what they
 * would become.** Promoting an editor to admin needs `admin`; granting or removing
 * ownership needs `owner`; demoting the sole owner is refused whoever asks.
 * `roleChangeRefusal` in `lib/workspace/roles.ts` holds all five rules in one place, and a
 * `requireScopeFor` argument here would be a sixth rule in a second place — which is how
 * the two disagree.
 *
 * It answers with the member as they now are, so the caller re-renders one row rather than
 * re-fetching the list.
 */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id, userId } = await params;
    const scope = await requireScopeFor(id);
    const body = await readJson(request, changeMemberRoleSchema);
    const member = await changeMemberRole(scope, userId, body.role);
    return ok(describeMember(member, scope.userId));
  });
}
