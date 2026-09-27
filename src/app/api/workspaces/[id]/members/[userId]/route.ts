import { handle, ok, requireScopeFor } from "@/lib/api";
import { clearActiveWorkspace } from "@/lib/workspace/active";
import { removeMember } from "@/lib/workspace/store";

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
