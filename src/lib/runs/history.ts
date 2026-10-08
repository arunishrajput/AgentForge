import { and, asc, eq, gte, lt, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { runs, runSteps, workflows, type Run } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import type { RunTest } from "@/lib/engine/partial";
import type { RunOrigin } from "@/lib/engine/retry";
import type { RunMode, RunStatus, StepStatus, TriggerKind } from "@/lib/engine/types";
import type { StepLog } from "@/lib/nodes/types";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { visibleWorkflows } from "@/lib/workflow/visibility";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { historyOrder, newerThan, olderThan, runKeyAt } from "./history-sql";
import { dayBounds, RUN_PAGE_SIZE, shapePage, type RunKey, type RunQuery } from "./query";

/**
 * **Reading run history — Phase 33.** The workspace's runs, a page at a time; one run with its
 * steps; one step's bodies.
 *
 * Three rules hold for every read here:
 *
 *  1. **Visibility is a join, never a check after the read** (D101). A run is addressed by its own
 *     id and carries its workflow's name, so every query joins `workflow` and applies
 *     `visibleWorkflows` — a private workflow's runs are 404 to everybody it is hidden from, and
 *     absent from their lists.
 *  2. **Bodies are loaded when they are asked for.** A run's steps carry the config each node ran
 *     with, what arrived and what it produced, and an HTTP step's output can be 256 KB. A list
 *     carries none of them, a run's detail page carries its steps without them, and one step's
 *     are a request of their own.
 *  3. **Nothing here writes.** Rendering a page must not sweep (`engine/run.ts` → `liveRun`); the
 *     API's list route still sweeps first, as it always has.
 */

/** A run as a list shows it: no input, no output, no steps — and its workflow's name. */
export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  trigger: TriggerKind;
  mode: RunMode;
  attempt: number;
  cancelRequested: boolean;
  wakeAt: string | null;
  test: RunTest | null;
  origin: RunOrigin | null;
  workflowVersion: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface RunPage {
  runs: RunSummary[];
  /** The cursor for the next, older page — null on the last. */
  next: RunKey | null;
  /** The cursor for the previous, newer page — null on the first. */
  prev: RunKey | null;
  /** Milliseconds spent asking, measured the way Phase 22 measured analytics. */
  queryMs: number;
}

const SUMMARY = {
  id: runs.id,
  workflowId: runs.workflowId,
  workflowName: workflows.name,
  status: runs.status,
  trigger: runs.trigger,
  mode: runs.mode,
  attempt: runs.attempt,
  cancelRequestedAt: runs.cancelRequestedAt,
  wakeAt: runs.wakeAt,
  test: runs.test,
  origin: runs.origin,
  workflowVersion: runs.workflowVersion,
  error: runs.error,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
} as const;

type SummaryRow = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  trigger: TriggerKind;
  mode: RunMode;
  attempt: number;
  cancelRequestedAt: Date | null;
  wakeAt: Date | null;
  test: RunTest | null;
  origin: RunOrigin | null;
  workflowVersion: number | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export function describeRunSummary(row: SummaryRow): RunSummary {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    status: row.status,
    trigger: row.trigger,
    mode: row.mode,
    attempt: row.attempt,
    cancelRequested: row.cancelRequestedAt !== null,
    wakeAt: row.wakeAt?.toISOString() ?? null,
    test: row.test ?? null,
    origin: row.origin ?? null,
    workflowVersion: row.workflowVersion,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
  };
}

/**
 * **One page of the workspace's runs, newest first — keyset on `(startedAt, id)`** (D150).
 *
 * A keyset rather than an offset because the history grows at its newest end while somebody is
 * reading it: an offset would shift by every run that arrived and show a run twice across two
 * pages, and it costs a scan of everything it skips. The keyset opens on `run_workspace_idx`
 * (`run_workflow_idx` when a workflow is chosen) and reads one row past the page to learn whether
 * another follows.
 */
export async function listRunPage(
  scope: WorkspaceScope,
  query: RunQuery,
  options: { limit?: number } = {},
): Promise<RunPage> {
  const started = Date.now();
  const limit = Math.max(1, options.limit ?? RUN_PAGE_SIZE);
  const { from, to } = dayBounds(query);

  const filters: (SQL | undefined)[] = [
    eq(runs.workspaceId, scope.workspaceId),
    visibleWorkflows(scope),
    query.status ? eq(runs.status, query.status) : undefined,
    query.trigger ? eq(runs.trigger, query.trigger) : undefined,
    query.workflowId ? eq(runs.workflowId, query.workflowId) : undefined,
    from ? gte(runs.startedAt, from) : undefined,
    to ? lt(runs.startedAt, to) : undefined,
    query.before ? olderThan(query.before) : query.after ? newerThan(query.after) : undefined,
  ];

  const rows = await db()
    .select({ ...SUMMARY, key: runKeyAt() })
    .from(runs)
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(and(...filters))
    .orderBy(historyOrder(query.after ? "oldest" : "newest"))
    .limit(limit + 1);

  const page = shapePage(
    rows.map((row) => ({ ...row, key: { at: row.key, id: row.id } })),
    query,
    limit,
  );

  return {
    runs: page.rows.map((row) => describeRunSummary(row)),
    next: page.next,
    prev: page.prev,
    queryMs: Date.now() - started,
  };
}

/** A step without its bodies — what a run's detail page renders before anything is opened. */
export interface StepHeader {
  seq: number;
  nodeId: string;
  nodeType: string;
  iteration: number;
  status: StepStatus;
  branch: string | null;
  logs: StepLog[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** What one step was given, ran with and produced — loaded when somebody opens it. */
export interface StepBodies {
  seq: number;
  config: unknown;
  input: unknown;
  output: unknown;
}

/**
 * The run row, if the asker may see it — the join and the predicate `getRun` uses (D101), with
 * the workflow's name and current version, which the detail page states beside the run's.
 */
async function visibleRun(
  scope: WorkspaceScope,
  runId: string,
): Promise<{ run: Run; workflow: { id: string; name: string; version: number; graph: WorkflowGraph } }> {
  const [row] = await db()
    .select({ run: runs, name: workflows.name, version: workflows.version, graph: workflows.graph })
    .from(runs)
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, scope.workspaceId), visibleWorkflows(scope)))
    .limit(1);

  if (!row) throw new ApiError("not_found", "No such run.");
  return {
    run: row.run,
    workflow: { id: row.run.workflowId, name: row.name, version: row.version, graph: row.graph },
  };
}

/**
 * One run with the headers of its steps — config, input and output left behind (rule 2). The
 * run's own input and output are left behind too: the input is its trigger step's, the output its
 * last step's, and both are a step's bodies away.
 */
export async function getRunDetail(
  scope: WorkspaceScope,
  runId: string,
): Promise<{
  run: RunSummary;
  /** With its current graph, for when the version the run executed is no longer kept. */
  workflow: { id: string; name: string; version: number; graph: WorkflowGraph };
  steps: StepHeader[];
}> {
  const { run, workflow } = await visibleRun(scope, runId);

  const steps = await db()
    .select({
      seq: runSteps.seq,
      nodeId: runSteps.nodeId,
      nodeType: runSteps.nodeType,
      iteration: runSteps.iteration,
      status: runSteps.status,
      branch: runSteps.branch,
      logs: runSteps.logs,
      error: runSteps.error,
      startedAt: runSteps.startedAt,
      finishedAt: runSteps.finishedAt,
    })
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.seq));

  return {
    run: describeRunSummary({ ...run, workflowName: workflow.name }),
    workflow,
    steps: steps.map((step) => ({
      ...step,
      logs: step.logs ?? [],
      startedAt: step.startedAt?.toISOString() ?? null,
      finishedAt: step.finishedAt?.toISOString() ?? null,
    })),
  };
}

/** One step's bodies, behind the same visibility join as its run. */
export async function getStepBodies(scope: WorkspaceScope, runId: string, seq: number): Promise<StepBodies> {
  await visibleRun(scope, runId);

  const [step] = await db()
    .select({ seq: runSteps.seq, config: runSteps.config, input: runSteps.input, output: runSteps.output })
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.seq, seq)))
    .limit(1);

  if (!step) throw new ApiError("not_found", "No such step.");
  return step;
}


/**
 * The workflows the history can be filtered by: the ones the asker may see, by name. Id and name
 * only — the filter does not need a graph, a tag or a star, and the workflow list's query carries
 * all three.
 */
export async function listWorkflowChoices(scope: WorkspaceScope): Promise<{ id: string; name: string }[]> {
  return db()
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(and(eq(workflows.workspaceId, scope.workspaceId), visibleWorkflows(scope)))
    .orderBy(asc(workflows.name));
}
