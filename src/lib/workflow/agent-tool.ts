import { and, asc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { workflows, type Workflow } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { getWorkflow } from "./store";
import type { WorkflowAgentTool } from "./tool";
import { visibleWorkflows } from "./visibility";

/**
 * **Marking a workflow callable by agents — Phase 39, task 2** (D186).
 *
 * `editor`, like the graph it exposes: it decides what a model may start, which is the same kind
 * of act as wiring a node into an agent's tools. It is **not a version and not an edit** — the
 * marking is a standing property of the workflow like `active` and `visibility`, it is not restored
 * by a restore, and it does not move `updatedAt`, so marking a workflow does not push it to the top
 * of the library.
 *
 * The name is unique among the workspace's tools: two workflows presenting one name would make an
 * agent listing both ambiguous, and the model cannot tell them apart. Checked here rather than by
 * an index because the column is a `jsonb` document, and answered as a conflict that names the
 * name without naming the other workflow (which the saver may not be allowed to see, D101).
 */
export async function setAgentTool(
  scope: WorkspaceScope,
  id: string,
  tool: WorkflowAgentTool,
): Promise<Workflow> {
  // Visibility first: a workflow the caller cannot see is a 404, never a name clash.
  await getWorkflow(scope, id);

  const [clash] = await db()
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.workspaceId, scope.workspaceId),
        ne(workflows.id, id),
        sql`${workflows.agentTool}->>'name' = ${tool.name}`,
      ),
    )
    .limit(1);
  if (clash) {
    throw new ApiError(
      "conflict",
      `Another workflow in this workspace is already an agent tool called "${tool.name}". Choose a different name.`,
    );
  }

  const [updated] = await db()
    .update(workflows)
    .set({ agentTool: tool })
    .where(and(eq(workflows.id, id), eq(workflows.workspaceId, scope.workspaceId)))
    .returning();
  return updated!;
}

/** Idempotent: a workflow that is not a tool stays not one. */
export async function clearAgentTool(scope: WorkspaceScope, id: string): Promise<Workflow> {
  await getWorkflow(scope, id);
  const [updated] = await db()
    .update(workflows)
    .set({ agentTool: null })
    .where(and(eq(workflows.id, id), eq(workflows.workspaceId, scope.workspaceId)))
    .returning();
  return updated!;
}

/** What a picker needs to offer a workflow: who it is, and whether (and as what) agents may call it. */
export interface CallableWorkflow {
  id: string;
  name: string;
  tool: { name: string; description: string } | null;
}

/**
 * The workflows this person may see, lightly — id, name and the marking, never the graph, which is
 * what makes it cheap enough for a node's picker to ask for. Visibility is in the `where` (D101).
 * `exclude` leaves out the workflow being edited: it can call nothing it is.
 */
export async function listCallable(scope: WorkspaceScope, exclude?: string): Promise<CallableWorkflow[]> {
  const rows = await db()
    .select({ id: workflows.id, name: workflows.name, agentTool: workflows.agentTool })
    .from(workflows)
    .where(
      and(
        eq(workflows.workspaceId, scope.workspaceId),
        visibleWorkflows(scope),
        exclude ? ne(workflows.id, exclude) : undefined,
      ),
    )
    .orderBy(asc(workflows.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tool: row.agentTool ? { name: row.agentTool.name, description: row.agentTool.description } : null,
  }));
}
