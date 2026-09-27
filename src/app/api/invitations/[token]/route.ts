import { ApiError, handle, ok } from "@/lib/api";
import {
  describeInvitationForHolder,
  INVITATION_TOKEN_PATTERN,
  invitationState,
} from "@/lib/workspace/invitations";
import { findInvitationByToken } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

/**
 * What a link is for — **the one route in this phase with no session**, reached by
 * whoever opens the invitation before they have signed in.
 *
 * Treated like the webhook receiver, which is the other unauthenticated surface in the
 * product (D41):
 *
 *   - the token is checked against a pattern **before the database is asked anything**,
 *     so a hostile or absurd value costs one regex rather than a query;
 *   - a token that matches nothing, one that is expired, one that is revoked and one that
 *     is already used all answer the **same 404 with the same message**, so the endpoint
 *     cannot be used to sort real tokens from invented ones;
 *   - a valid one answers the workspace's name and the role, and nothing else. No member
 *     list, no count, no inviter, and not the address it was sent to —
 *     `describeInvitationForHolder` carries that reasoning.
 */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { token } = await params;
    const invalid = new ApiError("not_found", "That invitation link is not valid.");
    if (!INVITATION_TOKEN_PATTERN.test(token)) throw invalid;

    const found = await findInvitationByToken(token);
    if (!found || invitationState(found.invitation) !== "live") throw invalid;

    return ok(
      describeInvitationForHolder({
        role: found.invitation.role,
        workspaceName: found.workspace.name,
      }),
    );
  });
}
