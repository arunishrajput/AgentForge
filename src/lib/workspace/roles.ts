/**
 * Workspace roles — the vocabulary, written in Phase 19A and **enforced in Phase 20**.
 *
 * **Read that sentence again before relying on one.** This module defines what a role
 * *is*; nothing in Phase 19A refuses an action because of one. That is inert here and
 * only here, for a reason worth stating rather than assuming: Phase 19A creates
 * exactly one kind of member — the `owner` of their own personal workspace — so there
 * is no member whose role could be enforced against them.
 *
 * **Phase 19B is where that stops being true.** The moment an invitation can create a
 * member who is not an owner, an unenforced role is a badge saying `viewer` next to
 * full write access. `BUILD_PLAN.md` → *Phase 19B* carries that handoff; the ranking
 * in this file is the other half of it, so the check Phase 20 writes has an ordering
 * to be written against rather than inventing one.
 *
 * The type lives in its own module rather than in `db/schema.ts` because the schema
 * imports it and so does everything above the database. A cycle through the schema
 * would drag the database client into the test runner, which D18 exists to prevent.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * Most-privileged first, which is the order `WORKSPACE_ROLES` is written in. Keep the
 * two in step — a role inserted into the middle of that array changes every comparison
 * below it, which is the point of having one ranking rather than four comparisons.
 */
const RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  viewer: 0,
};

/** Whether `role` carries at least the privilege of `required`. */
export function atLeast(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return RANK[role] >= RANK[required];
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}
