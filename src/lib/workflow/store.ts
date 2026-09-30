import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { workflows, type Workflow } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { validateGraph } from "@/lib/engine/validate";
import { required } from "@/lib/env";
import { nextScheduleState, scheduleCron } from "@/lib/triggers/schedule";
import { mintWebhookToken, webhookTriggerNode, webhookUrl } from "@/lib/triggers/webhook";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { emptyGraph, graphsEqual, workflowGraphSchema } from "./graph";
import {
  mayChangeVisibility,
  mintShareToken,
  shareUrl,
  visibleWorkflows,
  workflowVisibilitySchema,
} from "./visibility";
import { getVersion, recordVersion } from "./versions";

/**
 * Workspace-scoped workflow persistence. Every query here filters on
 * `scope.workspaceId` — the scoping is server-side and there is no code path that
 * reads a workflow by id alone (ARCHITECTURE.md → "API surface").
 *
 * **Phase 19A moved the filter from `ownerId` to `workspaceId`.** `ownerId` is still
 * written, and still means what it always did — who created this workflow — but it is
 * no longer what decides who may see it. A workflow made by one member of a workspace
 * is visible to the workspace, which is the entire point of having one.
 */

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  graph: workflowGraphSchema.optional(),
});

export const updateWorkflowSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullish(),
    graph: workflowGraphSchema.optional(),
    /**
     * Who in the workspace may see this — Phase 20. Carried on the ordinary update
     * rather than on a route of its own, because it is a property of the workflow and
     * the canvas already PATCHes the workflow; but it is **authorised separately**, by
     * `mayChangeVisibility` below, because `editor` is not the right bar for it.
     */
    visibility: workflowVisibilitySchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

export async function listWorkflows(scope: WorkspaceScope): Promise<Workflow[]> {
  return db()
    .select()
    .from(workflows)
    // Two filters doing two things: the workspace boundary, and — since Phase 20 — which
    // of that workspace's workflows this member may see. `visibleWorkflows` is
    // `undefined` for an admin, which `and()` drops, so there is no branch here.
    .where(and(eq(workflows.workspaceId, scope.workspaceId), visibleWorkflows(scope)))
    .orderBy(desc(workflows.updatedAt));
}

export async function getWorkflow(scope: WorkspaceScope, id: string): Promise<Workflow> {
  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.id, id),
        eq(workflows.workspaceId, scope.workspaceId),
        // Phase 20. In the `where` rather than checked after the read, so there is no
        // moment at which this function holds a row the caller may not see — which is
        // what makes every route downstream of it correct without a second thought.
        visibleWorkflows(scope),
      ),
    )
    .limit(1);

  // A workflow in somebody else's workspace answers 404 rather than 403, so the reply
  // does not confirm that the id exists (D20). **A colleague's `private` workflow answers
  // the same 404 for the same reason** — that it exists is the fact `private` hides.
  if (!workflow) throw new ApiError("not_found", "No such workflow.");
  return workflow;
}

export async function createWorkflow(
  scope: WorkspaceScope,
  body: z.infer<typeof createWorkflowSchema>,
  /** Names version 1. The generator passes one; an empty new workflow does not. */
  versionLabel?: string,
): Promise<Workflow> {
  const graph = body.graph ?? emptyGraph();

  const [workflow] = await db()
    .insert(workflows)
    .values({
      // Two columns, two different facts: the workspace decides who can see it, the
      // owner records who made it.
      workspaceId: scope.workspaceId,
      ownerId: scope.userId,
      name: body.name,
      description: body.description ?? null,
      graph,
      // Minted for every workflow, not only for one holding a webhook trigger: the
      // token is the workflow's identity on that endpoint, and minting it lazily
      // would mean the URL changes depending on when the node was added.
      webhookToken: mintWebhookToken(),
      ...nextScheduleState({ graph, previousCron: null, previousNextAt: null }),
    })
    .returning();

  // Version 1 is written at creation rather than on the first edit, so "restore it to
  // how it started" is answerable for every workflow. A generated one needs this most:
  // the model's first draft is exactly the thing a user edits away from and then wants
  // back.
  await recordVersion({
    workflowId: workflow.id,
    workspaceId: scope.workspaceId,
    ownerId: scope.userId,
    number: workflow.version,
    name: workflow.name,
    graph: workflow.graph,
    label: versionLabel ?? null,
  });

  return workflow;
}

export async function updateWorkflow(
  scope: WorkspaceScope,
  id: string,
  body: z.infer<typeof updateWorkflowSchema>,
  /** Names the version this save produces. A restore passes one; the canvas does not. */
  versionLabel?: string,
): Promise<Workflow> {
  const previous = await getWorkflow(scope, id);

  /**
   * **Which saves become versions — the debounce `BUILD_PLAN.md` asks for.**
   *
   * A save that changes neither the graph nor the name is not a version. The canvas
   * PATCHes the whole graph whenever Save is pressed and again before every run, so
   * without this a user who runs the same workflow five times would have five
   * identical snapshots in their history and five rows of metered storage spent to say
   * nothing.
   *
   * The comparison is structural, never a string one: `jsonb` normalises key order, so
   * a graph read back and written again is deeply equal and not byte-identical, and a
   * byte comparison would version every save (D25, now shared with the canvas through
   * `graph.ts`).
   *
   * A description change is deliberately **not** a version. A version is what the
   * workflow *is* — the graph and the name it goes by; the description is annotation
   * about it, and it is not restored either, so versioning it would offer a restore
   * that silently did not restore it.
   */
  const graphChanged = body.graph !== undefined && !graphsEqual(body.graph, previous.graph);
  const nameChanged = body.name !== undefined && body.name !== previous.name;
  const versioned = graphChanged || nameChanged;

  /**
   * **Visibility is on this request and is not authorised by it** — Phase 20.
   *
   * Every other field here needs `editor`, which `requireScope("editor")` has already
   * established at the route. Visibility needs *the creator or an admin*
   * (`mayChangeVisibility` says why), and that is a fact about this workflow rather than
   * about the workspace, so it cannot be a `requireScope` argument and has to be checked
   * where the row is in hand.
   *
   * It is checked **before the UPDATE**, on the row just read, which is the ordering
   * Phase 19B's `removalRefusal` bug was about: a check after the write is not a check.
   * And it is a `forbidden`, not a 404 — the caller can see this workflow, they simply
   * may not change this one property of it.
   */
  if (
    body.visibility !== undefined &&
    body.visibility !== previous.visibility &&
    !mayChangeVisibility({
      actorRole: scope.role,
      actorUserId: scope.userId,
      workflowOwnerId: previous.ownerId,
    })
  ) {
    throw new ApiError(
      "forbidden",
      "Only the person who created this workflow, or a workspace admin, can change who sees it.",
    );
  }

  const [workflow] = await db()
    .update(workflows)
    .set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description ?? null }),
      // **Not a version, deliberately** — the same rule the description follows. A
      // version is what the workflow *is*: its graph and the name it goes by. Who is
      // allowed to look at it is a fact about the present, it is not restored by a
      // restore, and versioning it would fill a history with rows that say nothing about
      // the workflow and cost metered storage to do it.
      ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
      ...(body.graph === undefined
        ? {}
        : {
            graph: body.graph,
            // The graph is the source of truth; this column is its derived index.
            // Re-derived on every graph write so adding, editing or deleting a
            // schedule trigger cannot leave a stale due time behind.
            ...nextScheduleState({
              graph: body.graph,
              previousCron: scheduleCron(previous.graph),
              previousNextAt: previous.scheduleNextAt,
            }),
          }),
      // Bumped in the same single-row UPDATE that writes the graph, which is what
      // makes the number unique without a transaction — see the column's own note in
      // `db/schema.ts`. `RETURNING` below hands back the number no concurrent save can
      // also have been given.
      ...(versioned ? { version: sql`${workflows.version} + 1` } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(workflows.id, id), eq(workflows.workspaceId, scope.workspaceId)))
    .returning();

  if (versioned) {
    await recordVersion({
      workflowId: workflow.id,
      workspaceId: scope.workspaceId,
      // The version records who saved it, which is not necessarily who created the
      // workflow — the first thing in this file where the two genuinely differ.
      ownerId: scope.userId,
      number: workflow.version,
      name: workflow.name,
      graph: workflow.graph,
      label: versionLabel ?? null,
    });
  }

  return workflow;
}

/**
 * Restore a version — **forward, never backward**.
 *
 * Version 3's graph and name are written as an ordinary save, which produces version
 * 8. Nothing is renumbered, nothing between 3 and 7 is deleted, and a run that
 * recorded version 5 still refers to the graph it actually executed.
 *
 * Rewinding instead — deleting 4 through 7, or resetting the counter — would be the
 * obvious implementation and it would quietly corrupt the run history, which is the
 * one thing versioning was added to make trustworthy.
 *
 * The restored save is labelled, because "Restored from v3" is exactly the row
 * somebody scrolling this history a week later is looking for, and it is also what
 * exempts it from the retention cap.
 */
export async function restoreVersion(
  scope: WorkspaceScope,
  id: string,
  number: number,
): Promise<Workflow> {
  const version = await getVersion(scope, id, number);
  return updateWorkflow(
    scope,
    id,
    { name: version.name, graph: version.graph },
    `Restored from v${number}`,
  );
}

/* ------------------------- the public share link ------------------------- *
 *
 * Phase 20. Three functions, and the split between them is the security boundary: the
 * first two take a `WorkspaceScope` and are reached only through `requireScope("admin")`;
 * the third takes a bare token and is reached by anybody on the internet.
 * ------------------------------------------------------------------------ */

/**
 * Mint a link, or return the one that already exists.
 *
 * **Idempotent rather than rotating**, which is the opposite of the choice invitations
 * made, and the difference is what each token is for. An invitation is delivered once and
 * then dead, so re-issuing it should rotate — the old link sitting in somebody's chat
 * history is a liability. A share link is a URL somebody pastes into a README or a
 * ticket; re-minting it on every press of a Share button would break those quietly, and
 * the user pressed a button labelled "Share", not "Rotate".
 *
 * Rotation is therefore `DELETE` then `POST`, which is two deliberate acts and reads as
 * what it is.
 */
export async function shareWorkflowPublicly(
  scope: WorkspaceScope,
  id: string,
): Promise<{ workflow: Workflow; url: string; minted: boolean }> {
  const workflow = await getWorkflow(scope, id);
  if (workflow.shareToken) {
    return {
      workflow,
      url: shareUrl(required("APP_BASE_URL"), workflow.shareToken),
      minted: false,
    };
  }

  const token = mintShareToken();
  const [updated] = await db()
    .update(workflows)
    .set({ shareToken: token, sharedAt: new Date() })
    // `shareToken is null` as well as the id: two admins pressing Share at the same
    // moment must not produce two tokens, one of which is then unreachable and live for
    // ever. `neon-http` has no transactions (D6), so the conditional update is the
    // interlock — the loser matches no row and re-reads.
    .where(
      and(
        eq(workflows.id, id),
        eq(workflows.workspaceId, scope.workspaceId),
        isNull(workflows.shareToken),
      ),
    )
    .returning();

  if (!updated) {
    const existing = await getWorkflow(scope, id);
    if (!existing.shareToken) throw new ApiError("conflict", "That link could not be created. Try again.");
    return {
      workflow: existing,
      url: shareUrl(required("APP_BASE_URL"), existing.shareToken),
      minted: false,
    };
  }

  return { workflow: updated, url: shareUrl(required("APP_BASE_URL"), token), minted: true };
}

/**
 * Revoke the link. The token is discarded rather than remembered, so the URL can never
 * come back — which is what "stop sharing" has to mean for it to be worth trusting.
 *
 * Idempotent: unsharing a workflow that is not shared succeeds. The caller asked for a
 * state, and it is the state they get; a 404 here would only ever be two tabs racing.
 */
export async function unshareWorkflow(scope: WorkspaceScope, id: string): Promise<Workflow> {
  await getWorkflow(scope, id);
  const [updated] = await db()
    .update(workflows)
    .set({ shareToken: null, sharedAt: null })
    .where(and(eq(workflows.id, id), eq(workflows.workspaceId, scope.workspaceId)))
    .returning();

  if (!updated) throw new ApiError("not_found", "No such workflow.");
  return updated;
}

/**
 * Rotate the webhook trigger's token — **Phase 21**, and the third of the phase's three
 * rotations.
 *
 * **The old URL is dead the instant this returns**, which is the whole point and also the
 * cost: whatever was calling it — a Zap, a GitHub webhook, a cron on somebody's laptop —
 * stops working until it is given the new URL. So this is a deliberate, confirmed act in the
 * UI and not a button beside the URL, and the response carries the new URL so there is one
 * moment where the user has it.
 *
 * **`admin`, matching the share link rather than matching `editor`.** An editor may already
 * change the graph this token fires; what they may not do is invalidate a secret that things
 * outside this product depend on. Phase 20's rule again: the bar is about the class of act.
 *
 * The update is conditional on the token that was observed, for the same reason
 * `shareWorkflowPublicly` is conditional on `shareToken is null` (D6 — `neon-http` has no
 * transactions): two admins rotating at the same moment must not both succeed, because the
 * loser would hand its user a URL that had already been replaced. The loser matches no row
 * and is told to look again.
 *
 * **There is no grace period, and that is a decision.** A token that keeps working for an
 * hour after being rotated is a token that is still live for an hour after somebody rotated it
 * *because it leaked*, which is the case rotation exists for.
 */
export async function rotateWebhookToken(
  scope: WorkspaceScope,
  id: string,
): Promise<{ workflow: Workflow; url: string }> {
  const workflow = await getWorkflow(scope, id);
  if (!webhookTriggerNode(workflow.graph)) {
    throw new ApiError(
      "invalid_request",
      "This workflow has no webhook trigger, so it has no URL to rotate.",
    );
  }

  const token = mintWebhookToken();
  const [updated] = await db()
    .update(workflows)
    .set({ webhookToken: token, webhookTokenRotatedAt: new Date() })
    .where(
      and(
        eq(workflows.id, id),
        eq(workflows.workspaceId, scope.workspaceId),
        eq(workflows.webhookToken, workflow.webhookToken),
      ),
    )
    .returning();

  if (!updated) {
    throw new ApiError(
      "conflict",
      "This URL was rotated by somebody else a moment ago. Reload to see the current one.",
    );
  }

  return { workflow: updated, url: webhookUrl(required("APP_BASE_URL"), token) };
}

/**
 * Resolve a share token — **the one function in this file with no `WorkspaceScope`.**
 *
 * It is reached from `GET /api/share/:token` and `/s/:token`, neither of which has a
 * session, so this is where the product's fourth unauthenticated surface meets the
 * database. Three properties, all deliberate:
 *
 *   the token is pattern-checked by the caller before this is reached, so a malformed one
 *   costs no query at all — the invitation route's rule, for the same reason;
 *
 *   the lookup is an indexed equality on `shareToken` and names no workspace, because
 *   nothing in the request could name one honestly. A token identifies one row through
 *   the partial unique index and there is no second input to get wrong;
 *
 *   **`visibility` is not consulted.** Publishing a link is a later, more deliberate act
 *   than marking a workflow private, and the two mean different things — see the column's
 *   note in `db/schema.ts`. A private workflow with a live link is shared with whoever
 *   holds the link and with nobody in the workspace, which is a coherent thing to want
 *   and is what the settings copy describes.
 *
 * It returns the row, and the row is **never** handed to a client: the route passes it
 * through `shareWorkflow` in `./share.ts`, which builds the response from an explicit
 * field list and redacts every authored value in the graph.
 */
export async function findSharedWorkflow(token: string): Promise<Workflow | null> {
  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.shareToken, token))
    .limit(1);

  return workflow ?? null;
}

export async function deleteWorkflow(scope: WorkspaceScope, id: string): Promise<void> {
  const deleted = await db()
    .delete(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.workspaceId, scope.workspaceId)))
    .returning({ id: workflows.id });

  if (deleted.length === 0) throw new ApiError("not_found", "No such workflow.");
}

/**
 * A graph is stored even when it will not run — a half-built canvas must be
 * saveable. Validation is reported alongside, so the client can show what is wrong
 * without the save failing.
 */
export function describeWorkflow(workflow: Workflow) {
  const validation = validateGraph(workflow.graph);
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    graph: workflow.graph,
    runnable: validation.valid,
    problems: validation.problems,
    /**
     * Only present when the graph actually holds a webhook trigger. The token is not
     * a secret from its workspace — every read here is already workspace-scoped — but a URL
     * shown for a workflow that will not answer on it is a support question, and an
     * unused live endpoint advertised in the UI is a wider surface than the product
     * needs.
     */
    webhookUrl: webhookTriggerNode(workflow.graph)
      ? webhookUrl(required("APP_BASE_URL"), workflow.webhookToken)
      : null,
    /** The version the stored graph is — every save produces a new one (Phase 18). */
    version: workflow.version,
    /**
     * Phase 20. Both are safe to send to a member of the workspace: `visibility` is a
     * setting they may already infer from whether they can see this at all, and
     * `shareUrl` is a bearer URL whose holder gets a redacted read of this one graph —
     * which every member of the workspace can already do in full.
     *
     * `shareUrl` rather than `shareToken`, so a client never has to know how to build
     * the URL and `APP_BASE_URL` stays the one place the public origin is decided (D53).
     * Null when the workflow is not shared, which is also how the UI knows which button
     * to draw.
     */
    visibility: workflow.visibility,
    /** Who created it, so the canvas knows whether the viewer may change `visibility`. */
    ownerId: workflow.ownerId,
    shareUrl: workflow.shareToken
      ? shareUrl(required("APP_BASE_URL"), workflow.shareToken)
      : null,
    sharedAt: workflow.sharedAt?.toISOString() ?? null,
    /**
     * Null while the workflow still has the token it was created with (Phase 21). Shown by
     * the trigger panel, because "this URL has never been rotated" is the honest answer and
     * is the one a user needs before deciding whether to.
     */
    webhookTokenRotatedAt: workflow.webhookTokenRotatedAt?.toISOString() ?? null,
    scheduleCron: scheduleCron(workflow.graph),
    scheduleNextAt: workflow.scheduleNextAt?.toISOString() ?? null,
    scheduleLastFiredAt: workflow.scheduleLastFiredAt?.toISOString() ?? null,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}
