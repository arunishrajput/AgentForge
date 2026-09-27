import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { users, workspaceMembers, workspaces, type Workspace } from "@/db/schema";

import { isWorkspaceRole, type WorkspaceRole } from "./roles";
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
 * one is `activeMembership`'s job; having the ordering here as well meant that function
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
 * Which of a user's workspaces is the active one.
 *
 * **In Phase 19A this is "the only one they have", and the function exists anyway** —
 * because it is the single line Phase 19B's switcher replaces, and a switcher that has
 * to find every place a workspace was chosen is how a switcher ships half-working.
 * There is deliberately no cookie, no preference column and no `activeWorkspaceId`
 * yet: every user has exactly one workspace until invitations exist, so any of those
 * would be machinery with nothing to select between.
 */
export function activeMembership(memberships: Membership[]): Membership | null {
  return memberships.find((m) => m.workspace.personal) ?? memberships[0] ?? null;
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
export async function resolveScope(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): Promise<WorkspaceScope> {
  const existing = activeMembership(await listMemberships(user.id));
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

/** The shape the UI reads. Carries nothing that is not already on screen. */
export function describeWorkspace(membership: Membership) {
  return {
    id: membership.workspace.id,
    name: membership.workspace.name,
    personal: membership.workspace.personal,
    role: membership.role,
  };
}
