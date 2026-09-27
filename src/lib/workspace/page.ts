import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { activeMembership, ensurePersonalWorkspace, listMemberships, type Membership } from "./store";
import type { WorkspaceScope } from "./scope";

/**
 * What a signed-in page needs, resolved once: who is here, which workspace they are
 * in, and the scope every query on the page filters by.
 *
 * Four pages were each doing `auth()`, narrowing `session.user.id`, and then resolving
 * a workspace — and Auth.js types `user.id` as optional, so each of them had to narrow
 * it again for the resolver. One helper, one narrowing, and the header gets the
 * workspace name without a fifth query.
 *
 * It redirects rather than throwing, because a signed-out visitor on `/workflows` wants
 * the landing page, not an error boundary. Route handlers use `requireScope` from
 * `lib/api.ts` instead, which answers 401 — the right answer for a client that asked
 * for JSON.
 */
export interface PageSession {
  userId: string;
  email: string;
  name: string | null;
  scope: WorkspaceScope;
  membership: Membership;
  /** Every workspace this user is in. One of them until Phase 19B's invitations. */
  memberships: Membership[];
}

export async function requirePageSession(): Promise<PageSession> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) redirect("/");

  const memberships = await listMemberships(user.id);
  let membership = activeMembership(memberships);

  if (!membership) {
    // Heals an account with no workspace rather than failing the page — see
    // `resolveScope` in `./store.ts` for the two ways that happens.
    const workspace = await ensurePersonalWorkspace(user as { id: string });
    membership = { workspace, role: "owner" };
    memberships.push(membership);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    name: user.name ?? null,
    scope: { workspaceId: membership.workspace.id, userId: user.id, role: membership.role },
    membership,
    memberships,
  };
}
