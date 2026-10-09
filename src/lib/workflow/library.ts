import { and, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { tags, workflowStars, type Workflow } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { validateGraph } from "@/lib/engine/validate";
import { logWarn } from "@/lib/logging";
import { ERROR_TRIGGER_TYPE } from "@/lib/triggers/failure";
import { scheduleCron } from "@/lib/triggers/schedule";
import { formTriggerNode } from "@/lib/triggers/form";
import { webhookTriggerNode } from "@/lib/triggers/webhook";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import type { WorkflowGraph } from "./graph";
import { copyTags, replaceWorkflowTags } from "./library-sql";
import { createWorkflow, getWorkflow } from "./store";
import {
  WORKFLOW_TAG_LIMIT,
  WORKSPACE_TAG_LIMIT,
  sortTags,
  tagNameSchema,
  type TagSummary,
} from "./tags";
import {
  IMPORT_LABEL,
  copyName,
  duplicateLabel,
  unknownNodeTypes,
  unknownTypesMessage,
  type ImportedWorkflow,
} from "./transfer";

/**
 * **The library — tags, stars, duplicate and import** (Phase 32). The rules are in `./tags.ts`
 * and `./transfer.ts`; this is where they meet the database.
 *
 * Every function takes a `WorkspaceScope` and filters on `scope.workspaceId`, the rule
 * `./store.ts` states for workflows. A tag is the workspace's, so every member may read the
 * workspace's tags; a star is the person's, so the only star a request can see or touch is
 * its own (`scope.userId`). Anything reached through a workflow goes through `getWorkflow`
 * first, so a workflow the caller cannot see (D101) is a 404 here exactly as everywhere else.
 *
 * **Tagging is not editing.** Neither a tag nor a star bumps the workflow's version or its
 * `updatedAt`: both are how a workspace *files* a workflow, not what the workflow does — the
 * rule a description already follows for versions — and "Recently updated" should not reorder
 * itself because somebody filed something.
 */

export const createTagSchema = z.object({ name: tagNameSchema });
export const renameTagSchema = z.object({ name: tagNameSchema });
export const setWorkflowTagsSchema = z.object({
  tagIds: z
    .array(z.string().min(1).max(64))
    .max(WORKFLOW_TAG_LIMIT, `A workflow can wear at most ${WORKFLOW_TAG_LIMIT} tags.`),
});

/**
 * The refusal for a name that is taken — **naming the tag that holds it**, as it is spelled, not
 * as it was typed: asked for "BILLING", the answer is that "Billing" exists, which is the tag the
 * person is then looking for.
 */
async function taken(scope: WorkspaceScope, name: string): Promise<ApiError> {
  const [holder] = await db()
    .select({ name: tags.name })
    .from(tags)
    .where(and(eq(tags.workspaceId, scope.workspaceId), sql`lower(${tags.name}) = lower(${name})`))
    .limit(1);
  return new ApiError("conflict", `This workspace already has a tag called “${holder?.name ?? name}”.`);
}

export async function listTags(scope: WorkspaceScope): Promise<TagSummary[]> {
  const rows = await db()
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.workspaceId, scope.workspaceId));
  return sortTags(rows);
}

export async function createTag(scope: WorkspaceScope, name: string): Promise<TagSummary> {
  const [{ value: existing }] = await db()
    .select({ value: count() })
    .from(tags)
    .where(eq(tags.workspaceId, scope.workspaceId));
  if (existing >= WORKSPACE_TAG_LIMIT) {
    throw new ApiError(
      "conflict",
      `This workspace has ${WORKSPACE_TAG_LIMIT} tags, the most it can hold. Delete one you no longer use first.`,
    );
  }

  try {
    const [created] = await db()
      .insert(tags)
      .values({ workspaceId: scope.workspaceId, name })
      .returning({ id: tags.id, name: tags.name });
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw await taken(scope, name);
    throw error;
  }
}

/**
 * Rename a tag. **One row, whatever wears it** — including workflows the person renaming it
 * cannot see, which is why a tag is a row of its own and not a word copied onto each
 * workflow (D144): renaming touches nothing but the tag.
 */
export async function renameTag(scope: WorkspaceScope, id: string, name: string): Promise<TagSummary> {
  try {
    const [renamed] = await db()
      .update(tags)
      .set({ name })
      .where(and(eq(tags.id, id), eq(tags.workspaceId, scope.workspaceId)))
      .returning({ id: tags.id, name: tags.name });
    if (!renamed) throw new ApiError("not_found", "No such tag.");
    return renamed;
  } catch (error) {
    if (isUniqueViolation(error)) throw await taken(scope, name);
    throw error;
  }
}

/** Delete a tag. It comes off every workflow wearing it, by the foreign key's cascade. */
export async function deleteTag(scope: WorkspaceScope, id: string): Promise<void> {
  const deleted = await db()
    .delete(tags)
    .where(and(eq(tags.id, id), eq(tags.workspaceId, scope.workspaceId)))
    .returning({ id: tags.id });
  if (deleted.length === 0) throw new ApiError("not_found", "No such tag.");
}

/**
 * Replace the set of tags a workflow wears — **one statement**, so the set is never half
 * written. The tags are selected *through* the caller's workspace (`wanted`), so a tag id from
 * another workspace matches nothing and is never inserted; the check before it exists only to
 * say so, with a 404, rather than to keep it out.
 */
export async function setWorkflowTags(
  scope: WorkspaceScope,
  workflowId: string,
  tagIds: readonly string[],
): Promise<TagSummary[]> {
  await getWorkflow(scope, workflowId);
  const ids = [...new Set(tagIds)];

  if (ids.length > 0) {
    const found = await db()
      .select({ id: tags.id })
      .from(tags)
      .where(and(inArray(tags.id, ids), eq(tags.workspaceId, scope.workspaceId)));
    if (found.length !== ids.length) throw new ApiError("not_found", "No such tag.");
  }

  const result = await db().execute<{ tags: TagSummary[] }>(
    replaceWorkflowTags({ workflowId, workspaceId: scope.workspaceId, tagIds: ids }),
  );
  return sortTags(result.rows[0]?.tags ?? []);
}

/**
 * Give a new workflow the tags another one wears — a duplicate's (Phase 32). The source's
 * tags are already this workspace's, so this cannot carry a foreign one. Not fatal: the
 * duplicate is correct without them, and refusing it because a label failed to copy would be
 * the wrong trade — the one D83 declines for version history.
 */
export async function copyWorkflowTags(fromWorkflowId: string, toWorkflowId: string): Promise<void> {
  await db().execute(copyTags({ fromWorkflowId, toWorkflowId }));
}

/** Star a workflow for the person asking. Idempotent: starring twice is one star. */
export async function starWorkflow(scope: WorkspaceScope, workflowId: string): Promise<void> {
  await getWorkflow(scope, workflowId);
  await db()
    .insert(workflowStars)
    .values({ userId: scope.userId, workflowId })
    .onConflictDoNothing();
}

/** Unstar it. Idempotent, like starring: the caller asked for a state and gets it. */
export async function unstarWorkflow(scope: WorkspaceScope, workflowId: string): Promise<void> {
  await getWorkflow(scope, workflowId);
  await db()
    .delete(workflowStars)
    .where(and(eq(workflowStars.userId, scope.userId), eq(workflowStars.workflowId, workflowId)));
}

/**
 * Whether a graph's trigger runs it without anybody pressing Run — a webhook, a form (Phase 40), a schedule, or
 * (Phase 37) another workflow's failure. A manual workflow has nothing for the active switch to
 * stop; a copied or imported error workflow would start alerting the moment it existed.
 */
function runsByItself(graph: WorkflowGraph): boolean {
  return (
    scheduleCron(graph) !== null ||
    webhookTriggerNode(graph) !== undefined ||
    formTriggerNode(graph) !== undefined ||
    graph.nodes.some((node) => node.type === ERROR_TRIGGER_TYPE)
  );
}

/**
 * **Duplicate a workflow, on the server** (Phase 32, D147). The copy is a new workflow made by
 * `createWorkflow` — so it mints its **own** webhook token (D41) and starts its own history —
 * holding the original's graph as it is now, pins, notes and switched-off nodes included: it is
 * the same workspace and the same people, so nothing in the graph is anybody else's to withhold.
 *
 *   **It starts switched off when its trigger would run it by itself.** A duplicated schedule
 *   that began firing the moment it was made would do the original's job a second time; the
 *   author switches the copy on when it is ready, from the trigger panel.
 *
 *   **It keeps the original's visibility**, so duplicating a private workflow cannot publish
 *   its contents to the workspace. Its creator is whoever duplicated it.
 *
 *   **It wears the original's tags** — the same workspace files it the same way — and none of
 *   anybody's stars, which are a person's and not the workflow's.
 *
 * `getWorkflow` first, so a workflow the caller cannot see is a 404 and cannot be copied into
 * one they can (D101).
 */
export async function duplicateWorkflow(scope: WorkspaceScope, id: string): Promise<Workflow> {
  const source = await getWorkflow(scope, id);
  const copy = await createWorkflow(
    scope,
    { name: copyName(source.name), description: source.description, graph: source.graph },
    {
      versionLabel: duplicateLabel(source.name, source.version),
      visibility: source.visibility,
      ...(runsByItself(source.graph) ? { active: false } : {}),
    },
  );

  try {
    await copyWorkflowTags(source.id, copy.id);
  } catch (error) {
    logWarn("system.warning", "A duplicated workflow's tags could not be copied.", {
      workflowId: copy.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return copy;
}

/**
 * **Create a workflow from an export** (Phase 32, D146). The file has been read by `readImport`
 * — its format, its version and its shape — and this is the half that needs the registry:
 * `validateGraph`, the same function a run is checked with.
 *
 * **An unknown node type refuses the whole file, by name.** Every other problem is reported
 * rather than refused, because an export of a half-built workflow must come back as the
 * half-built workflow it was — `runnable: false`, with its problems, exactly as it would load
 * on the canvas. An unknown type is different in kind: this AgentForge cannot represent the
 * node at all, and keeping it would store a workflow nobody here can edit or run.
 *
 * Like a duplicate, an import whose trigger runs by itself **starts switched off**: it arrives
 * in a new workspace, with that workspace's credentials, and should not start posting with them
 * until somebody has looked at it.
 */
export async function importWorkflow(
  scope: WorkspaceScope,
  workflow: ImportedWorkflow,
): Promise<Workflow> {
  const { problems } = validateGraph(workflow.graph);
  const unknown = unknownNodeTypes(workflow.graph, problems);
  if (unknown.length > 0) {
    throw new ApiError(
      "invalid_graph",
      unknownTypesMessage(unknown),
      problems.filter((problem) => problem.code === "unknown_node_type"),
    );
  }

  return createWorkflow(scope, workflow, {
    versionLabel: IMPORT_LABEL,
    ...(runsByItself(workflow.graph) ? { active: false } : {}),
  });
}
