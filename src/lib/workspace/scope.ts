import type { WorkspaceRole } from "./roles";

/**
 * **The scoping token every query in the product is filtered by — Phase 19A.**
 *
 * It replaces the bare `ownerId: string` that used to be threaded through every store
 * function, and the fact that it is a *type* rather than another string is the whole
 * safety argument. The refactor that introduced it changed the meaning of the first
 * argument of about thirty functions from "the user" to "the workspace". Had both been
 * `string`, every call site missed in that sweep would have compiled, run, and read one
 * tenant's rows under another tenant's name. As an object, a missed call site is a
 * typecheck failure.
 *
 * Both fields are needed and they are not interchangeable:
 *
 *   workspaceId  what a row must belong to for this request to see it. Every `where`
 *                clause in every store module filters on it.
 *   userId       who is doing this. It is written to `ownerId` on anything created, so
 *                a run still records who triggered it and a workflow still records who
 *                made it — neither of which `workspaceId` can answer.
 *
 * `role` is carried because **Phase 20 needs somewhere to put the authorisation check
 * and this is it**: one object, resolved once per request, already in the hand of every
 * function that mutates anything. It is not consulted in Phase 19A — see
 * `./roles.ts`, which explains why that is currently inert and exactly when it stops
 * being.
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
}

/**
 * The scope for work that no user asked for: a webhook delivery, a scheduled run, a
 * queue redelivery.
 *
 * **These three routes have no session and cannot have one** (`CONTRACT.md` → the
 * three routes with no session). They authorise themselves another way — an
 * unguessable token, `CRON_SECRET` — and then they hold a workflow row, which already
 * names both the workspace it lives in and the user it belongs to. Deriving the scope
 * from the row rather than inventing one means a webhook can still only ever act inside
 * the workspace of the workflow whose token was presented.
 *
 * The role is the workflow owner's `owner`, deliberately: the alternative is looking up
 * a membership row on a path that has no user at the keyboard, to answer a question
 * nobody is asking. Phase 20 should revisit this the moment a role gates execution.
 */
export function systemScope(workflow: {
  workspaceId: string;
  ownerId: string;
}): WorkspaceScope {
  return {
    workspaceId: workflow.workspaceId,
    userId: workflow.ownerId,
    role: "owner",
  };
}
