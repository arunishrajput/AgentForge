import { handle, ok, requireScopeFor } from "@/lib/api";
import { revokeInvitation } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; invitationId: string }> };

/**
 * Revoke an invitation. It is an update rather than a delete, so the list keeps the record
 * — and so the same address can be invited again, which the partial unique index only
 * allows once no live invitation counts.
 *
 * An invitation that is already accepted or already revoked answers 404: there is nothing
 * left to revoke, and a 409 would invite a client to retry something that will never
 * succeed.
 */
export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id, invitationId } = await params;
    const scope = await requireScopeFor(id, "admin");
    return ok(await revokeInvitation(scope, invitationId));
  });
}
