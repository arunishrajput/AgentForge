import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  users,
  workflows,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type Workspace,
  type WorkspaceInvitation,
} from "@/db/schema";
import { logWarn } from "@/lib/logging";
import { ApiError } from "@/lib/api-error";

import {
  canAcceptAs,
  describeInvitation,
  hashInvitationToken,
  invitationExpiry,
  invitationTokenMatches,
  mintInvitationToken,
  normaliseEmail,
  type InvitationSummary,
} from "./invitations";
import {
  isWorkspaceRole,
  removalRefusal,
  REMOVAL_MESSAGES,
  roleChangeRefusal,
  ROLE_CHANGE_MESSAGES,
  WORKSPACE_ROLES,
  type InvitableRole,
  type WorkspaceRole,
} from "./roles";
import type { WorkspaceScope } from "./scope";

/**
 * Workspaces, membership, and the one query that turns a signed-in user into a
 * `WorkspaceScope` — Phase 19A.
 *
 * **One query per request, and no new reason to wake the database.** Neon's free tier
 * meters compute *time awake*, not statements (`DEPLOYMENT.md` → *Free-tier headroom*),
 * so a second statement inside a request that already made one is close to free — what
 * costs is a poller, a tick, or a background job that wakes an idle database. This
 * module adds none of those. That is the whole of the Neon argument for workspaces, and
 * it is why the ~39 CU-hour balance is Phase 22's problem and not this phase's.
 */

export interface Membership {
  workspace: Workspace;
  role: WorkspaceRole;
}

/**
 * Every workspace this user belongs to, **oldest first** — the order a switcher should
 * list them in, which is the order they were joined.
 *
 * It returns the whole list rather than just the active one because the list is what
 * Phase 19B's switcher needs and it is the same query either way — a user belongs to a
 * handful of workspaces, not thousands, and paying for a `limit 1` twice would be the
 * more expensive design.
 *
 * **It deliberately does not put the personal workspace first.** Choosing the active
 * one is `chooseMembership`'s job; having the ordering here as well meant that function
 * silently depended on its caller having sorted, and a test that handed it an unsorted
 * list caught exactly that.
 */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const rows = await db()
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));

  return rows.map((row) => ({
    workspace: row.workspace,
    // A role the application does not recognise is read as the least privileged one
    // rather than trusted or thrown on. The column is free text in Postgres, so this is
    // the boundary where "whatever is in the database" becomes a known value.
    role: isWorkspaceRole(row.role) ? row.role : ("viewer" as WorkspaceRole),
  }));
}

/**
 * Which of a user's workspaces this request is in.
 *
 * **This is the function Phase 19A said 19B would replace, and this is that
 * replacement.** In 19A it took one argument and returned "the only workspace they
 * have"; the switcher's whole job is to make the first argument longer and the choice
 * real.
 *
 * `preferredId` is the id from the `af_workspace` cookie, and the important line is the
 * `find`: **it is honoured only if it appears in the memberships the database returned.**
 * That is what makes the cookie a preference rather than a credential — a forged id, an
 * id copied from another browser, or a stale id for a workspace the user has since been
 * removed from all fall through to their own workspace instead of granting anything.
 * `./active.ts` carries the rest of that argument.
 *
 * The fallback order: the preference, then **the personal workspace this user created**,
 * then the oldest membership.
 *
 * **`createdBy` is in that middle test because of a bug the deployed check suite found.**
 * It used to be `find((m) => m.workspace.personal)`, which was correct while nobody could
 * be in anybody else's workspace — and wrong the moment invitations existed, because a
 * *personal* workspace can be shared, and `listMemberships` orders oldest first. An
 * account invited into somebody else's personal workspace landed in **theirs** by default
 * rather than its own. Not a leak, since membership was real either way, but the wrong
 * home, and the sort of wrong that would have looked like a leak in a bug report.
 */
export function chooseMembership(
  memberships: Membership[],
  userId: string,
  preferredId?: string | null,
): Membership | null {
  const preferred = preferredId
    ? memberships.find((m) => m.workspace.id === preferredId)
    : undefined;
  const own = memberships.find((m) => m.workspace.personal && m.workspace.createdBy === userId);
  return preferred ?? own ?? memberships[0] ?? null;
}

/**
 * The workspace a user lands in, creating it if they have none.
 *
 * Two paths reach this with none: an account created before Phase 19A whose backfill
 * somehow did not run, and a brand-new account whose `createUser` event failed. Both
 * are recoverable here and neither is worth a broken page, so the scope resolver heals
 * rather than throwing — and because it heals, the `createUser` event stays a
 * convenience rather than a correctness requirement.
 */
export async function resolveScope(
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  },
  /** The `af_workspace` cookie's value, if the caller could read one. Never trusted. */
  preferredWorkspaceId?: string | null,
): Promise<WorkspaceScope> {
  const existing = chooseMembership(await listMemberships(user.id), user.id, preferredWorkspaceId);
  if (existing) {
    return {
      workspaceId: existing.workspace.id,
      userId: user.id,
      role: existing.role,
    };
  }

  const created = await ensurePersonalWorkspace(user);
  return { workspaceId: created.id, userId: user.id, role: "owner" };
}

/**
 * The personal workspace for a user, created once and never twice.
 *
 * **The uniqueness is the database's job, not this function's.** `neon-http` has no
 * transactions (D6), so "select, and insert if absent" is a genuine race — two requests
 * arriving together on a cold account both see none and both insert. The partial unique
 * index `workspace_personal_idx` makes the loser's insert conflict instead, and
 * `onConflictDoNothing` turns that into an empty `returning`, which is the signal to
 * re-read the row the winner wrote. Same shape as the cron tick's compare-and-set
 * (D42): one atomic statement decides, and the loser does no harm.
 */
export async function ensurePersonalWorkspace(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): Promise<Workspace> {
  const [inserted] = await db()
    .insert(workspaces)
    .values({
      name: personalWorkspaceName(user),
      createdBy: user.id,
      personal: true,
    })
    .onConflictDoNothing()
    .returning();

  const workspace = inserted ?? (await readPersonalWorkspace(user.id));
  if (!workspace) {
    // Only reachable if the row vanished between the conflict and the re-read, which
    // means somebody deleted it mid-request. Better to say so than to return a scope
    // pointing at nothing.
    throw new Error(`Could not create or find a personal workspace for user ${user.id}`);
  }

  await db()
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
    .onConflictDoNothing();

  return workspace;
}

/**
 * The name a personal workspace is given.
 *
 * **Kept in step with the backfill in `drizzle/0005_nappy_vampiro.sql`**, which names
 * the same thing in SQL for accounts that predate this phase. Two implementations of
 * one rule is a smell, and the alternative — a migration that calls into application
 * code — is not available. If this changes, change the migration's comment too; it is
 * already applied, so its rows keep whatever name they were given.
 */
export function personalWorkspaceName(user: { name?: string | null; email?: string | null }): string {
  const fromName = user.name?.trim();
  if (fromName) return `${fromName}'s workspace`;

  const fromEmail = user.email?.split("@")[0]?.trim();
  if (fromEmail) return `${fromEmail}'s workspace`;

  return "Personal workspace";
}

async function readPersonalWorkspace(userId: string): Promise<Workspace | null> {
  const [workspace] = await db()
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.createdBy, userId), eq(workspaces.personal, true)))
    .limit(1);
  return workspace ?? null;
}

/**
 * Create a personal workspace for a user who has just signed up for the first time.
 *
 * Called from the `createUser` event in `src/auth.ts`, where `user` is the row the
 * adapter has just written. It reads the user back rather than trusting the event's
 * payload shape across an Auth.js beta upgrade.
 */
export async function createPersonalWorkspaceForNewUser(userId: string): Promise<void> {
  const [user] = await db()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return;
  await ensurePersonalWorkspace(user);
}

/**
 * The shape the UI reads. Carries nothing that is not already on screen.
 *
 * **`own` is separate from `personal`, and driving a browser is what proved it had to
 * be.** `personal` is a fact about the row — it was created automatically for somebody.
 * Once a personal workspace can be shared, that somebody is not necessarily the person
 * reading the page, and every screen that used `personal` alone said the wrong thing to
 * a guest: the switcher labelled the *inviter's* workspace `PERSONAL`, and the workflow
 * list called it "your workspace". `own` is the question the UI actually wants answered.
 *
 * `viewerUserId` is required rather than optional so that no call site can forget to
 * answer it and silently get the old, wrong behaviour back.
 */
export function describeWorkspace(membership: Membership, viewerUserId: string) {
  return {
    id: membership.workspace.id,
    name: membership.workspace.name,
    personal: membership.workspace.personal,
    /** This is the personal workspace created for *the person reading this*. */
    own: membership.workspace.personal && membership.workspace.createdBy === viewerUserId,
    role: membership.role,
  };
}

/* ------------------------------------------------------------------ *
 * Phase 19B — more than one workspace, and more than one person in one
 * ------------------------------------------------------------------ */

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const renameWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

/**
 * A new, shared workspace, with its creator as the owner.
 *
 * **`personal: false`, always.** The partial unique index allows exactly one personal
 * workspace per creator and that one is made at sign-in; a second personal workspace is
 * not a thing the product has a meaning for, so this cannot create one by accident.
 *
 * It starts genuinely empty — no workflows, and **no credentials**, because credentials
 * belong to a workspace rather than to a person (Phase 19A). That surprises people, so
 * the settings page says it rather than leaving the first run of a workflow in a new
 * workspace to explain it with an error.
 */
export async function createWorkspace(
  userId: string,
  body: z.infer<typeof createWorkspaceSchema>,
): Promise<Membership> {
  const [workspace] = await db()
    .insert(workspaces)
    .values({ name: body.name, createdBy: userId, personal: false })
    .returning();

  await db()
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId, role: "owner" })
    .onConflictDoNothing();

  return { workspace, role: "owner" };
}

export async function renameWorkspace(
  scope: WorkspaceScope,
  body: z.infer<typeof renameWorkspaceSchema>,
): Promise<Workspace> {
  const [workspace] = await db()
    .update(workspaces)
    .set({ name: body.name, updatedAt: new Date() })
    .where(eq(workspaces.id, scope.workspaceId))
    .returning();

  // Unreachable through a route — the scope was resolved from a membership row a moment
  // ago, which cannot exist without the workspace. Reachable if somebody deletes a
  // workspace mid-request, and then saying so beats returning undefined.
  if (!workspace) throw new ApiError("not_found", "No such workspace.");
  return workspace;
}

export interface Member {
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: WorkspaceRole;
  joinedAt: Date;
}

/**
 * Who is in this workspace.
 *
 * **Every member can see the list, and that is a decision rather than an oversight.**
 * The alternative — a viewer who cannot see who else is in the workspace they share —
 * hides the thing they most need to know, which is who can read the credentials they are
 * about to connect. What the list does *not* carry is anything about those people beyond
 * what they are already sharing by being in it: a name, an address and a role.
 */
export async function listMembers(scope: WorkspaceScope): Promise<Member[]> {
  const rows = await db()
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, scope.workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));

  // Field by field rather than a spread, so the projection is exactly the six columns
  // above and a column added to `user` later cannot arrive in a members list by accident.
  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    image: row.image,
    joinedAt: row.joinedAt,
    // Same boundary as `listMemberships`: whatever is in the column becomes a role the
    // application recognises, and an unrecognised one is read as the least privileged.
    role: isWorkspaceRole(row.role) ? row.role : ("viewer" as WorkspaceRole),
  }));
}

/**
 * Remove a member, or leave.
 *
 * One function for both, because they are the same write and differ only in who is
 * allowed to make it — `removalRefusal` in `./roles.ts` holds that rule and explains why
 * the last owner cannot be removed even by themselves.
 *
 * `ownerCount` is read first and the delete is conditional on the role that was read, so
 * two admins removing the last two owners simultaneously cannot both pass the check:
 * the second delete matches no row, because the row it was counting on is gone. Without
 * transactions (D6) that is the available shape, and it fails closed.
 */
export async function removeMember(scope: WorkspaceScope, targetUserId: string): Promise<void> {
  const members = await listMembers(scope);
  const target = members.find((m) => m.userId === targetUserId);
  if (!target) throw new ApiError("not_found", "That person is not in this workspace.");

  const refusal = removalRefusal({
    actorRole: scope.role,
    actorUserId: scope.userId,
    targetUserId,
    targetRole: target.role,
    ownerCount: members.filter((m) => m.role === "owner").length,
  });
  if (refusal) {
    throw new ApiError(
      refusal === "last_owner" ? "conflict" : "forbidden",
      REMOVAL_MESSAGES[refusal],
    );
  }

  const deleted = await db()
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, scope.workspaceId),
        eq(workspaceMembers.userId, targetUserId),
        // The role as it was when it was checked. If it changed in between, this matches
        // nothing and the caller is told to look again rather than the check being void.
        eq(workspaceMembers.role, target.role),
      ),
    )
    .returning({ userId: workspaceMembers.userId });

  if (deleted.length === 0) {
    throw new ApiError("conflict", "That membership changed while this was in flight. Try again.");
  }
}

export const changeMemberRoleSchema = z.object({ role: z.enum(WORKSPACE_ROLES) });

/**
 * Change a member's role — **Phase 20**, and what makes the four roles a thing a
 * workspace can be administered with rather than a label an invitation fixes for ever.
 *
 * Built as `removeMember`'s twin on purpose, down to the two-step shape: read the members,
 * let the pure rule in `./roles.ts` decide, then write **conditionally on the role that
 * was read**. Without transactions (D6) that last part is the whole of the concurrency
 * story — if the target's role changed between the read and the write, the UPDATE matches
 * nothing and the caller is told to look again, rather than the check silently having been
 * about a row that no longer exists. Two admins demoting the last two owners at once
 * cannot both succeed.
 *
 * The status codes: `last_owner` and `no_change` are **409**, because the request was
 * allowed and the state refused it; everything else is **403**, because the request was
 * not. That is the same split `removeMember` makes and it is the distinction
 * `CONTRACT.md` → *Two refusals that mean different things* exists to protect.
 */
export async function changeMemberRole(
  scope: WorkspaceScope,
  targetUserId: string,
  nextRole: unknown,
): Promise<Member> {
  const members = await listMembers(scope);
  const target = members.find((m) => m.userId === targetUserId);
  // 404 before the rule, and it is not a leak: `requireScopeFor` has already established
  // that the caller is a member of this workspace, and every member may read its member
  // list — so "that person is not in here" is something they could have looked up.
  if (!target) throw new ApiError("not_found", "That person is not in this workspace.");

  const refusal = roleChangeRefusal({
    actorRole: scope.role,
    actorUserId: scope.userId,
    targetUserId,
    targetRole: target.role,
    nextRole,
    ownerCount: members.filter((m) => m.role === "owner").length,
  });
  if (refusal) {
    throw new ApiError(
      refusal === "last_owner" || refusal === "no_change" ? "conflict" : "forbidden",
      ROLE_CHANGE_MESSAGES[refusal],
    );
  }

  const [updated] = await db()
    .update(workspaceMembers)
    .set({ role: nextRole as WorkspaceRole })
    .where(
      and(
        eq(workspaceMembers.workspaceId, scope.workspaceId),
        eq(workspaceMembers.userId, targetUserId),
        // The role as it was when the rule was applied. See the note above.
        eq(workspaceMembers.role, target.role),
      ),
    )
    .returning({ role: workspaceMembers.role });

  if (!updated) {
    throw new ApiError("conflict", "That membership changed while this was in flight. Try again.");
  }

  return { ...target, role: isWorkspaceRole(updated.role) ? updated.role : target.role };
}

/** The shape the members list is sent as. `you` saves the client comparing ids. */
export function describeMember(member: Member, viewerUserId: string) {
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    you: member.userId === viewerUserId,
  };
}

/**
 * Which of this user's workspaces holds this workflow, if any — Phase 19B.
 *
 * **It exists for one state that only starts happening once workspaces are shared**: a
 * teammate pastes a link to a workflow, and the person opening it is currently in a
 * different workspace. Every query in the product is workspace-scoped, so the honest
 * answer from `getWorkflow` is 404 — and a 404 on a workflow they can genuinely see is
 * the kind of thing that makes a product look broken.
 *
 * So the canvas asks this, and when the answer is one of their own workspaces it renders
 * a card saying where the workflow lives with a button to switch, rather than silently
 * moving them. Silently switching would mean a link in a chat window could change which
 * workspace somebody is working in without saying so, which is worse than a clear
 * explanation.
 *
 * It reads `workflow` joined to the caller's memberships, so it can only ever name a
 * workspace they are already in: a workflow belonging to a stranger answers null and is
 * indistinguishable from one that does not exist.
 */
export async function findMembershipForWorkflow(
  userId: string,
  workflowId: string,
): Promise<Membership | null> {
  const [row] = await db()
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workflows)
    .innerJoin(workspaces, eq(workspaces.id, workflows.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(workflows.id, workflowId))
    .limit(1);

  if (!row) return null;
  return {
    workspace: row.workspace,
    role: isWorkspaceRole(row.role) ? row.role : ("viewer" as WorkspaceRole),
  };
}

/* ---------------------------- invitations ---------------------------- */

/**
 * Issue an invitation, or re-issue one — **the same call, on purpose.**
 *
 * Inviting an address that already has a live invitation rotates its token and resets
 * its clock rather than refusing or creating a second row. That is what makes "send it
 * again" possible at all: only the hash is stored, so the original link cannot be shown
 * twice (`./invitations.ts`), and the honest way to re-send is to mint a new one and
 * invalidate the old.
 *
 * **The upsert is the interlock**, not a preceding read. `workspace_invitation_live_idx`
 * is unique on `(workspaceId, email)` among rows that are neither accepted nor revoked,
 * and `neon-http` has no transactions (D6), so two invitations issued at the same moment
 * for the same address must be resolved by the database or not at all. `targetWhere`
 * names that index's predicate, which is what lets Postgres use a partial index for
 * `ON CONFLICT`.
 *
 * It returns the token **once**, to be put in one link. Nothing stores it.
 */
export async function issueInvitation(
  scope: WorkspaceScope,
  body: { email: string; role: InvitableRole },
): Promise<{ invitation: WorkspaceInvitation; token: string }> {
  const email = normaliseEmail(body.email);

  const already = await db()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, scope.workspaceId), eq(users.email, email)))
    .limit(1);

  // Refused rather than made a no-op: an invitation sent to somebody who is already in
  // the workspace would sit in the pending list for ever, since accepting it changes
  // nothing they do not already have.
  if (already.length > 0) {
    throw new ApiError("conflict", "That person is already in this workspace.");
  }

  const token = mintInvitationToken();
  const expiresAt = invitationExpiry();

  const [invitation] = await db()
    .insert(workspaceInvitations)
    .values({
      workspaceId: scope.workspaceId,
      email,
      role: body.role,
      tokenHash: hashInvitationToken(token),
      invitedBy: scope.userId,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [workspaceInvitations.workspaceId, workspaceInvitations.email],
      targetWhere: sql`${workspaceInvitations.acceptedAt} is null and ${workspaceInvitations.revokedAt} is null`,
      set: {
        role: body.role,
        tokenHash: hashInvitationToken(token),
        invitedBy: scope.userId,
        expiresAt,
        createdAt: new Date(),
      },
    })
    .returning();

  return { invitation, token };
}

/**
 * This workspace's invitations, newest first.
 *
 * Every state, not only the live ones: a list that hides the expired and the revoked
 * cannot answer "did I already invite them?", which is the question somebody opening
 * this list is usually asking. Capped, because it is an unbounded history of a thing
 * that costs metered storage and nobody scrolls.
 */
export async function listInvitations(scope: WorkspaceScope): Promise<InvitationSummary[]> {
  const rows = await db()
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.workspaceId, scope.workspaceId))
    .orderBy(desc(workspaceInvitations.createdAt))
    .limit(50);

  return rows.map(describeInvitation);
}

/**
 * Revoke one. An update rather than a delete, so the list keeps the record that it
 * happened — and so the partial unique index stops counting it, which is what allows the
 * same address to be invited again afterwards.
 */
export async function revokeInvitation(scope: WorkspaceScope, id: string): Promise<InvitationSummary> {
  const [revoked] = await db()
    .update(workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.id, id),
        eq(workspaceInvitations.workspaceId, scope.workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
      ),
    )
    .returning();

  // Either it is in another workspace, or it is already spent. Both answer 404 — an
  // invitation in another workspace must not be confirmed to exist (D20), and one
  // already accepted or revoked has nothing left to revoke.
  if (!revoked) throw new ApiError("not_found", "No invitation to revoke.");
  return describeInvitation(revoked);
}

/**
 * Look an invitation up by the token in a link.
 *
 * **Unauthenticated.** It is reached by whoever opens the link, before any session
 * exists, which is why it returns the workspace's *name* and the role and nothing else
 * (`describeInvitationForHolder` states the rest of that reasoning). A token that
 * matches nothing returns null, and every caller renders the same thing for null as for
 * a spent token, so probing cannot tell the two apart.
 */
export async function findInvitationByToken(token: string): Promise<
  | {
      invitation: WorkspaceInvitation;
      workspace: Workspace;
    }
  | null
> {
  const [row] = await db()
    .select({ invitation: workspaceInvitations, workspace: workspaces })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .where(eq(workspaceInvitations.tokenHash, hashInvitationToken(token)))
    .limit(1);

  if (!row) return null;
  // The lookup above was already an equality on the hash; this re-check is what makes
  // the comparison constant-time in this process as well, and costs one hash.
  if (!invitationTokenMatches(token, row.invitation.tokenHash)) return null;
  return row;
}

/**
 * Accept it.
 *
 * **Both halves are required and they are checked in one place** (`canAcceptAs`): the
 * token proves the holder was sent the link, and the session proves who they are, matched
 * on the verified address from the identity provider rather than on anything in the URL.
 *
 * Single use is enforced by the `where` on the update, not by the read above it. The
 * membership is written first and the invitation is spent second, which is the safe order
 * of the two: if the second write fails, the person is in the workspace and the link is
 * still live, and re-accepting is a no-op. The other order would spend the link and leave
 * them outside it.
 */
export async function acceptInvitation(
  token: string,
  user: { id: string; email?: string | null },
): Promise<Membership> {
  const found = await findInvitationByToken(token);
  // Deliberately the same error as a token that matched nothing.
  if (!found) throw new ApiError("not_found", "That invitation link is not valid.");

  const check = canAcceptAs(found.invitation, user.email);
  if (!check.ok) {
    throw new ApiError(
      check.state === "wrong_email" ? "forbidden" : "conflict",
      ACCEPT_REFUSALS[check.state],
    );
  }

  await db()
    .insert(workspaceMembers)
    .values({
      workspaceId: found.invitation.workspaceId,
      userId: user.id,
      role: found.invitation.role,
    })
    // Already a member: the accept still succeeds and still spends the link. Anything
    // else would mean a second click on the same link reported a failure for a state
    // that is exactly what the user wanted.
    .onConflictDoNothing();

  const [spent] = await db()
    .update(workspaceInvitations)
    .set({ acceptedAt: new Date(), acceptedBy: user.id })
    .where(
      and(
        eq(workspaceInvitations.id, found.invitation.id),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
      ),
    )
    .returning({ id: workspaceInvitations.id });

  if (!spent) {
    // Two clicks arriving together: one spent it. The membership write above is
    // idempotent, so the loser is a member too and this is not an error.
    logWarn("system.warning", "An invitation was already spent when it was accepted.", {
      invitationId: found.invitation.id,
    });
  }

  return { workspace: found.workspace, role: found.invitation.role };
}

/** One message per refusal, so the route and the page cannot word them differently. */
export const ACCEPT_REFUSALS: Record<"expired" | "revoked" | "accepted" | "wrong_email" | "live", string> = {
  expired: "That invitation has expired. Ask for a new link.",
  revoked: "That invitation was revoked.",
  accepted: "That invitation has already been used. Ask for a new link.",
  wrong_email: "That invitation was sent to a different email address than the one you signed in with.",
  live: "That invitation cannot be accepted.",
};
