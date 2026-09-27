import { and, desc, eq, sql } from "drizzle-orm";
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
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

export async function listWorkflows(scope: WorkspaceScope): Promise<Workflow[]> {
  return db()
    .select()
    .from(workflows)
    .where(eq(workflows.workspaceId, scope.workspaceId))
    .orderBy(desc(workflows.updatedAt));
}

export async function getWorkflow(scope: WorkspaceScope, id: string): Promise<Workflow> {
  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.workspaceId, scope.workspaceId)))
    .limit(1);

  // A workflow in somebody else's workspace answers 404 rather than 403, so the reply
  // does not confirm that the id exists (D20).
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

  const [workflow] = await db()
    .update(workflows)
    .set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description ?? null }),
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
    scheduleCron: scheduleCron(workflow.graph),
    scheduleNextAt: workflow.scheduleNextAt?.toISOString() ?? null,
    scheduleLastFiredAt: workflow.scheduleLastFiredAt?.toISOString() ?? null,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}
