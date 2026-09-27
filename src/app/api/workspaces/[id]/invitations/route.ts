import { handle, ok, readJson, requireScopeFor } from "@/lib/api";
import { required } from "@/lib/env";
import {
  describeInvitation,
  invitationUrl,
  issueInvitationSchema,
} from "@/lib/workspace/invitations";
import { issueInvitation, listInvitations } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * This workspace's invitations, every state, newest first. `admin` — a pending invitation
 * names an address somebody chose to invite, which is not the business of every member.
 *
 * No token and no link is returned, by construction: only the hash was stored.
 */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScopeFor(id, "admin");
    return ok(await listInvitations(scope));
  });
}

/**
 * Invite an address, or re-invite one — the same call, which rotates the token and resets
 * the clock. `issueInvitation` explains why that is the shape.
 *
 * **This response is the only time the link exists outside the inviter's clipboard.**
 * There is no email provider on a zero-cost budget, so AgentForge does not send the
 * invitation: it hands the inviter one link to deliver however they already talk to the
 * person. That is a limitation stated rather than hidden — the settings panel says it on
 * the form, and `PRD.md` records it.
 *
 * `role` cannot be `owner`; the schema's enum is `INVITABLE_ROLES` and the reason is in
 * `lib/workspace/roles.ts`.
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScopeFor(id, "admin");
    const body = await readJson(request, issueInvitationSchema);
    const { invitation, token } = await issueInvitation(scope, body);

    return ok(
      {
        invitation: describeInvitation(invitation),
        // Built from `APP_BASE_URL` rather than from the request: inside the container the
        // request's own URL is the bind address, which is how Chapter 1 shipped a Google
        // callback that returned people to `http://0.0.0.0:8080`.
        url: invitationUrl(required("APP_BASE_URL"), token),
      },
      201,
    );
  });
}
