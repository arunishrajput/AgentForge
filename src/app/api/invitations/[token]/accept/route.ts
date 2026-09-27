import { auth } from "@/auth";
import { ApiError, handle, ok } from "@/lib/api";
import { setActiveWorkspace } from "@/lib/workspace/active";
import { INVITATION_TOKEN_PATTERN } from "@/lib/workspace/invitations";
import { acceptInvitation, describeWorkspace } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

/**
 * Accept an invitation.
 *
 * **Two facts, both required, and they come from different places.** The token in the URL
 * proves the caller was sent the link; `auth()` proves who they are. The membership is
 * written for the address the *identity provider* verified, never for anything in the URL
 * — a `?email=` would turn the invited address into a claim by the caller and make the
 * link a way to join as anybody. `acceptInvitation` holds both checks.
 *
 * It switches to the workspace on success, because the next thing anybody wants after
 * accepting is to look at it.
 *
 * `auth()` here rather than `requireScope`: there is no workspace to scope to yet — that
 * is what this request is for.
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const { token } = await params;
    if (!INVITATION_TOKEN_PATTERN.test(token)) {
      throw new ApiError("not_found", "That invitation link is not valid.");
    }

    const session = await auth();
    const user = session?.user;
    if (!user?.id) throw new ApiError("unauthenticated", "Sign in to accept this invitation.");

    const membership = await acceptInvitation(token, { id: user.id, email: user.email });
    await setActiveWorkspace(membership.workspace.id);
    return ok(describeWorkspace(membership, user.id));
  });
}
