import { and, asc, desc, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { runs, runSteps, type Run, type RunStep, type Workflow } from "@/db/schema";
import { ApiError } from "@/lib/api";

import { executeWorkflow, GraphInvalidError } from "./execute";
import { dbRecorder, reapStaleRuns, STALE_RUN_MS } from "./recorder";
import type { TriggerKind } from "./types";

/**
 * Starting and reading runs. Execution is in-process and synchronous within the
 * request (ARCHITECTURE.md → "Queue — deliberately none"), so this function
 * returns only once the run has finished.
 */

export async function startRun(options: {
  ownerId: string;
  workflow: Workflow;
  trigger: TriggerKind;
  input?: unknown;
  signal?: AbortSignal;
}): Promise<{ run: Run; steps: RunStep[] }> {
  const { ownerId, workflow, trigger, input = null, signal } = options;

  // Sweep before starting so a previous instance's abandoned run does not sit in
  // `running` next to this one.
  await reapStaleRuns(ownerId);

  const [created] = await db()
    .insert(runs)
    .values({
      workflowId: workflow.id,
      ownerId,
      status: "running",
      trigger,
      input: input ?? null,
    })
    .returning();

  try {
    const outcome = await executeWorkflow({
      runId: created.id,
      workflowId: workflow.id,
      ownerId,
      graph: workflow.graph,
      input,
      recorder: dbRecorder(created.id),
      signal,
    });

    await db()
      .update(runs)
      .set({
        status: outcome.status,
        output: outcome.output ?? null,
        error: outcome.error,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(runs.id, created.id));
  } catch (error) {
    const message =
      error instanceof GraphInvalidError
        ? `This workflow cannot run: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);

    await db()
      .update(runs)
      .set({
        status: "failed",
        error: message,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(runs.id, created.id));

    if (error instanceof GraphInvalidError) {
      throw new ApiError("invalid_graph", message, error.problems);
    }
  }

  return getRun(ownerId, created.id);
}

export async function getRun(
  ownerId: string,
  runId: string,
): Promise<{ run: Run; steps: RunStep[] }> {
  const [run] = await db()
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, ownerId)))
    .limit(1);

  if (!run) throw new ApiError("not_found", "No such run.");

  const steps = await db()
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.seq));

  return { run, steps };
}

export async function listRuns(
  ownerId: string,
  options: { workflowId?: string; limit?: number } = {},
): Promise<Run[]> {
  await reapStaleRuns(ownerId);

  const where = options.workflowId
    ? and(eq(runs.ownerId, ownerId), eq(runs.workflowId, options.workflowId))
    : eq(runs.ownerId, ownerId);

  return db()
    .select()
    .from(runs)
    .where(where)
    .orderBy(desc(runs.startedAt))
    .limit(Math.min(options.limit ?? 50, 200));
}

/**
 * The newest run of a workflow, row only. The SSE stream calls this every poll, so
 * it deliberately does not read steps and does not reap: one statement, no writes.
 */
export async function latestRun(
  ownerId: string,
  workflowId: string,
): Promise<Run | null> {
  const [run] = await db()
    .select()
    .from(runs)
    .where(and(eq(runs.ownerId, ownerId), eq(runs.workflowId, workflowId)))
    .orderBy(desc(runs.startedAt))
    .limit(1);

  return run ?? null;
}

export async function readSteps(runId: string): Promise<RunStep[]> {
  return db()
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.seq));
}

/**
 * A run of this workflow that is genuinely still in flight, for a page load that
 * lands mid-run. The heartbeat window rather than `reapStaleRuns` because rendering
 * a page must not write: an abandoned run is simply not returned here, and the
 * reaper still moves it to `failed` the next time a run is listed or started.
 */
export async function liveRun(
  ownerId: string,
  workflowId: string,
): Promise<{ run: Run; steps: RunStep[] } | null> {
  const [run] = await db()
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.ownerId, ownerId),
        eq(runs.workflowId, workflowId),
        eq(runs.status, "running"),
        gt(runs.heartbeatAt, new Date(Date.now() - STALE_RUN_MS)),
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(1);

  if (!run) return null;
  return { run, steps: await readSteps(run.id) };
}

export function describeRun(run: Run, steps?: RunStep[]) {
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    trigger: run.trigger,
    input: run.input,
    output: run.output,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    durationMs: run.finishedAt
      ? run.finishedAt.getTime() - run.startedAt.getTime()
      : null,
    ...(steps
      ? {
          steps: steps.map((step) => ({
            seq: step.seq,
            nodeId: step.nodeId,
            nodeType: step.nodeType,
            iteration: step.iteration,
            status: step.status,
            config: step.config,
            input: step.input,
            output: step.output,
            branch: step.branch,
            logs: step.logs,
            error: step.error,
            startedAt: step.startedAt?.toISOString() ?? null,
            finishedAt: step.finishedAt?.toISOString() ?? null,
          })),
        }
      : {}),
  };
}
