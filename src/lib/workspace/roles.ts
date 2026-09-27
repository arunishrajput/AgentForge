import { ApiError } from "@/lib/api-error";

/**
 * Workspace roles — the vocabulary, and **the check, enforced since Phase 19B**.
 *
 * Phase 19A wrote `workspace_member.role` and enforced nothing, which was inert there
 * for one reason: it only ever created the `owner` of a personal workspace, so there
 * was no member a role could be enforced against. **Phase 19B's invitations end that**
 * — the moment a link can make somebody an `editor` or a `viewer`, an unenforced role
 * is a badge next to full write access. So `assertRole` below exists, every mutating
 * route calls it through `requireScope`, and `CONTRACT.md` → *What each role may do*
 * is the matrix it implements.
 *
 * **What is still Phase 20's**: per-workflow sharing, public share links, changing an
 * existing member's role, and hiding in the UI what the API already refuses. This is
 * the floor — an API that cannot be talked into a write the role does not carry — not
 * the finished authorisation story.
 *
 * The type lives in its own module rather than in `db/schema.ts` because the schema
 * imports it and so does everything above the database. A cycle through the schema
 * would drag the database client into the test runner, which D18 exists to prevent.
 * `assertRole` lives here rather than in `lib/api.ts` for the same reason in reverse:
 * `lib/api.ts` imports `@/auth`, which the test runner cannot load, and the one
 * decision worth testing is this one.
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

/**
 * The check itself. Throws rather than returning a boolean, because the one thing that
 * must never happen is a call site that computes the answer and forgets to act on it.
 *
 * **403 and not 404, deliberately, and the distinction is the contract** (`CONTRACT.md`
 * → *Two refusals that mean different things*). D20's 404 is for a resource in somebody
 * else's workspace: answering 403 there would confirm that the id exists. This is the
 * other case — the row is in *your* workspace, you may read it, and you may not change
 * it. You already know it exists, so hiding behind a 404 would only make a real
 * permission boundary look like a bug.
 *
 * The message names the role required rather than the role held: "this needs admin" is
 * actionable, "you are a viewer" is not.
 */
export function assertRole(role: WorkspaceRole, required: WorkspaceRole): void {
  if (atLeast(role, required)) return;
  throw new ApiError(
    "forbidden",
    `This needs the ${required} role in this workspace, or higher.`,
  );
}

/**
 * The roles an invitation may hand out — every role except `owner`.
 *
 * Ownership comes from creating a workspace, and (from Phase 20) from a deliberate
 * promotion by an existing owner. **It never arrives by link**, because an invitation is
 * a bearer token sitting in somebody's inbox and the blast radius of a leaked one must
 * stop short of "can delete the workspace and remove everybody in it".
 */
export const INVITABLE_ROLES = ["admin", "editor", "viewer"] as const satisfies readonly WorkspaceRole[];

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === "string" && (INVITABLE_ROLES as readonly string[]).includes(value);
}

/**
 * May this member remove that one? — Phase 19B.
 *
 * A pure rule with four inputs rather than four `if`s inside a store function, because
 * it is the one place in membership where a wrong answer is not recoverable: removing
 * the last owner leaves a workspace **nobody can administer**, with its workflows,
 * credentials and run history still in it and no route in the product able to invite a
 * replacement. There is no undo, so the rule is asserted directly.
 *
 * The three refusals, and why each one:
 *
 *   `not_allowed`  removing somebody else needs `admin`. Removing yourself never does:
 *                  any member may leave, which is the difference between membership and
 *                  a trap
 *   `owner_only`   an admin may not remove an owner. Otherwise `admin` is just `owner`
 *                  with extra steps, and an invitation that hands out `admin` would hand
 *                  out the ability to evict the person who sent it
 *   `last_owner`   the workspace would have no owner. Applies to *leaving* too — the
 *                  sole owner of a shared workspace has to promote somebody first
 *                  (Phase 20) or delete it
 *
 * **The order of the three is a bug fix, found by running the deployed check suite.** The
 * invariant used to be tested first, so a *viewer* aiming this at the owner was told
 * "this is the workspace's only owner" — a 409 that both leaked how many owners the
 * workspace has and described the request as a conflict rather than as refused. Authority
 * comes first: *may you do this at all*, and only then *would the result be legal*. The
 * last-owner test still covers leaving, which is the case it exists for.
 */
export type RemovalRefusal = "last_owner" | "not_allowed" | "owner_only";

export function removalRefusal(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: WorkspaceRole;
  /** How many members of this workspace currently hold `owner`. */
  ownerCount: number;
}): RemovalRefusal | null {
  const leaving = input.actorUserId === input.targetUserId;

  if (!leaving) {
    if (!atLeast(input.actorRole, "admin")) return "not_allowed";
    if (input.targetRole === "owner" && input.actorRole !== "owner") return "owner_only";
  }
  if (input.targetRole === "owner" && input.ownerCount <= 1) return "last_owner";
  return null;
}

export const REMOVAL_MESSAGES: Record<RemovalRefusal, string> = {
  last_owner:
    "This is the workspace's only owner. Make somebody else an owner first, or delete the workspace.",
  not_allowed: "Removing another member needs the admin role in this workspace, or higher.",
  owner_only: "Only an owner can remove an owner.",
};
