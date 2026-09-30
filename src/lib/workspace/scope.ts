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
 * `role` is carried because **the authorisation check needs somewhere to live and this is
 * it**: one object, resolved once per request, already in the hand of every function that
 * mutates anything. Phase 19A wrote it and consulted it nowhere; Phase 19B made
 * `requireScope(minimumRole)` gate every route on it; Phase 20 added the two rules that
 * are not a simple ranking — `roleChangeRefusal` in `./roles.ts` and
 * `visibleWorkflows` in `lib/workflow/visibility.ts`, which filters *rows* rather than
 * refusing *requests*.
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
 * nobody is asking.
 *
 * **Phase 20 revisited this, as it said it would, and kept it.** Execution *is* gated on a
 * role now — running a workflow needs `editor` — but that gate is at the route, where a
 * person is making the request. These three paths have no person, and the thing that
 * authorises them is the token they presented. Per-workflow `visibility` is deliberately
 * not consulted here either: a trigger is not a person, and a private workflow still fires
 * on its own webhook and its own schedule.
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
