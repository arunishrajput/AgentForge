import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { workflows, type Workflow } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { validateGraph } from "@/lib/engine/validate";

import { emptyGraph, workflowGraphSchema } from "./graph";

/**
 * Owner-scoped workflow persistence. Every query here filters on `ownerId` — the
 * scoping is server-side and there is no code path that reads a workflow by id
 * alone (ARCHITECTURE.md → "API surface").
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

export async function listWorkflows(ownerId: string): Promise<Workflow[]> {
  return db()
    .select()
    .from(workflows)
    .where(eq(workflows.ownerId, ownerId))
    .orderBy(desc(workflows.updatedAt));
}

export async function getWorkflow(ownerId: string, id: string): Promise<Workflow> {
  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.ownerId, ownerId)))
    .limit(1);

  if (!workflow) throw new ApiError("not_found", "No such workflow.");
  return workflow;
}

export async function createWorkflow(
  ownerId: string,
  body: z.infer<typeof createWorkflowSchema>,
): Promise<Workflow> {
  const [workflow] = await db()
    .insert(workflows)
    .values({
      ownerId,
      name: body.name,
      description: body.description ?? null,
      graph: body.graph ?? emptyGraph(),
    })
    .returning();

  return workflow;
}

export async function updateWorkflow(
  ownerId: string,
  id: string,
  body: z.infer<typeof updateWorkflowSchema>,
): Promise<Workflow> {
  await getWorkflow(ownerId, id);

  const [workflow] = await db()
    .update(workflows)
    .set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description ?? null }),
      ...(body.graph === undefined ? {} : { graph: body.graph }),
      updatedAt: new Date(),
    })
    .where(and(eq(workflows.id, id), eq(workflows.ownerId, ownerId)))
    .returning();

  return workflow;
}

export async function deleteWorkflow(ownerId: string, id: string): Promise<void> {
  const deleted = await db()
    .delete(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.ownerId, ownerId)))
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
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}
