import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { runs, runSteps, workflows, type Run, type RunStep, type Workflow } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { required } from "@/lib/env";
import { versionGraph } from "@/lib/workflow/versions";

import { readCursor } from "./cursor";
import { executeWorkflow, GraphInvalidError } from "./execute";
import {
  claimOwnRun,
  claimRun,
  finishRun,
  finishUnclaimedRun,
  mintDispatchToken,
  mintLeaseOwner,
  MAX_DELIVERIES,
  sweepAbandonedRuns,
} from "./lease";
import { enqueueRun } from "./queue";
import { dbRecorder } from "./recorder";
import type { RunMode, RunOutcome, StepRecord, TriggerKind } from "./types";

/**
 * Starting, resuming and reading runs.
 *
 * Two modes, and the difference is only *who executes the run*
 * (ARCHITECTURE.md → "Execution engine design"):
 *
 *   sync     this request executes it, and does not answer until it is over. Chapter
 *            1's only path, and still the right one for a run somebody is watching:
 *            `POST /runs` returns the finished run, which is what the canvas's Run
 *            button, `DEMO.md` and every verification script read.
 *   durable  a Cloud Tasks delivery executes it. This request answers as soon as the
 *            task is on the queue. Survives a redeploy, an instance recycle and a
 *            crash, because the queue redelivers and the engine resumes from the
 *            cursor the previous attempt left.
 *
 * Both take a lease and both checkpoint, so cancellation and progress work identically
 * and there is exactly one engine driver below.
 */

/** Minted per attempt, so a lease can be checked against the process that holds it. */
export interface StartOptions {
  ownerId: string;
  workflow: Workflow;
  trigger: TriggerKind;
  input?: unknown;
  signal?: AbortSignal;
}

/**
 * Create the run row. Always `queued` — including for a synchronous run, which claims
 * it to `running` a moment later.
 *
 * `queued` was the one status in `CONTRACT.md`'s state machine that Chapter 1 reserved
 * and never wrote. It is written now, and it means what it says: the run exists, and
 * nothing is executing it yet.
 */
async function createRun(options: StartOptions & { mode: RunMode }): Promise<Run> {
  const [created] = await db()
    .insert(runs)
    .values({
      workflowId: options.workflow.id,
      ownerId: options.ownerId,
      status: "queued",
      trigger: options.trigger,
      input: options.input ?? null,
      mode: options.mode,
      dispatchToken: mintDispatchToken(),
      // Which graph this run is executing (Phase 18). Recorded at creation, never
      // updated — a resume three deliveries later must still say what it started on.
      workflowVersion: options.workflow.version,
    })
    .returning();

  return created;
}

/**
 * Run the engine over a claimed run and write its outcome.
 *
 * The one place `executeWorkflow` is called from, so the rules about what a caller may
 * write after an interruption live here once rather than in each route:
 *
 *  - `preempted` writes **nothing**. Another worker holds this run and is executing it;
 *    stamping a status would report a lie about a run that is still going.
 *  - a terminal outcome is written through `finishRun`, which is itself guarded on the
 *    lease, so a worker that lost its lease between the last checkpoint and the final
 *    write still cannot overwrite the new owner's work.
 */
async function drive(options: {
  run: Run;
  workflow: Workflow;
  owner: string;
  signal?: AbortSignal;
  resume?: { cursor: NonNullable<ReturnType<typeof readCursor>>; steps: readonly StepRecord[] };
}): Promise<RunOutcome> {
  const { run, workflow, owner, signal, resume } = options;

  let outcome: RunOutcome;
  try {
    outcome = await executeWorkflow({
      runId: run.id,
      workflowId: workflow.id,
      ownerId: run.ownerId,
      graph: workflow.graph,
      input: run.input,
      recorder: dbRecorder(run.id, owner),
      signal,
      resume,
    });
  } catch (error) {
    const message =
      error instanceof GraphInvalidError
        ? `This workflow cannot run: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);

    await finishRun({ runId: run.id, owner, status: "failed", error: message });
    throw error;
  }

  if (outcome.stop === "interrupted") return outcome;

  await finishRun({
    runId: run.id,
    owner,
    status: outcome.status!,
    output: outcome.output,
    error: outcome.error,
    cursor: outcome.cursor,
  });

  return outcome;
}

/**
 * Execute a run inside this request and return it finished — the synchronous path.
 *
 * Sweeps first, so a previous instance's abandoned run does not sit in `running` next
 * to this one. The sweep is mode-aware now: a durable run waiting for its next delivery
 * looks exactly like an abandoned one and must not be touched (`lease.ts`).
 */
export async function startRun(
  options: StartOptions,
): Promise<{ run: Run; steps: RunStep[] }> {
  await sweepAbandonedRuns(options.ownerId);

  const created = await createRun({ ...options, mode: "sync" });
  const owner = mintLeaseOwner();
  const claimed = await claimOwnRun(created.id, owner);

  // Nothing else can hold a lease on a row created microseconds ago, so this is a
  // "cannot happen" that is nonetheless not worth an exception: report it as a failed
  // run rather than a 500, because the user's mental model is that their run failed.
  if (!claimed) {
    await finishUnclaimedRun({
      runId: created.id,
      status: "failed",
      error: "The run could not be started.",
    });
    return getRun(options.ownerId, created.id);
  }

  try {
    await drive({ run: claimed, workflow: options.workflow, owner, signal: options.signal });
  } catch (error) {
    if (error instanceof GraphInvalidError) {
      throw new ApiError(
        "invalid_graph",
        `This workflow cannot run: ${error.message}`,
        error.problems,
      );
    }
    // Any other failure is already recorded on the run by `drive`; returning the run
    // keeps the response shape identical to a run that failed in a node.
  }

  return getRun(options.ownerId, created.id);
}

export interface EnqueueOutcome {
  run: Run;
  /** False when the queue was unavailable and this process executed the run instead. */
  queued: boolean;
  detail?: string;
}

/**
 * Create a durable run and hand it to the queue. Returns as soon as the task exists —
 * the run is executed by the delivery, not by this request.
 *
 * **The fallback matters more than the happy path.** With no queue configured — a
 * developer machine, CI — this executes the run in-process instead, and *downgrades the
 * row to `sync`* so the sweeper tells the truth about it: a run nothing will redeliver
 * is a synchronous run, whatever it was asked to be. A rejection from a configured queue
 * is the same fallback plus a logged error, because a missing `cloudtasks.enqueuer`
 * binding should degrade to a working product and a loud log, not to a lost run.
 */
export async function startDurableRun(options: StartOptions): Promise<EnqueueOutcome> {
  await sweepAbandonedRuns(options.ownerId);

  const created = await createRun({ ...options, mode: "durable" });

  const result = await enqueueRun({
    runId: created.id,
    token: created.dispatchToken!,
    baseUrl: required("APP_BASE_URL"),
    secret: required("CRON_SECRET"),
  });

  if (result.enqueued) return { run: created, queued: true };

  if (result.reason !== "unconfigured") {
    console.error(
      `[queue] could not enqueue run ${created.id} (${result.reason}): ${result.detail ?? "no detail"} — falling back to in-process execution`,
    );
  }

  const [downgraded] = await db()
    .update(runs)
    .set({ mode: "sync" })
    .where(eq(runs.id, created.id))
    .returning();

  const owner = mintLeaseOwner();
  const claimed = await claimOwnRun(downgraded.id, owner);
  if (claimed) {
    try {
      await drive({ run: claimed, workflow: options.workflow, owner, signal: options.signal });
    } catch {
      // Recorded on the run by `drive`. A durable start has no caller waiting on a
      // throw, so it becomes a failed run rather than an exception.
    }
  }

  const [final] = await db().select().from(runs).where(eq(runs.id, created.id)).limit(1);
  return { run: final ?? downgraded, queued: false, detail: result.reason };
}

export type ResumeOutcome =
  | { handled: true; status: string }
  | { handled: false; reason: "unknown" | "not_claimable" | "deliveries_exhausted" | "cancelled" };

/**
 * Execute a delivered run — the worker side of the queue.
 *
 * Every early return here is a case where the correct behaviour is to do nothing and
 * tell the queue the delivery succeeded, so it is not retried:
 *
 *   unknown               no run with this id and token. A replayed or forged task.
 *   not_claimable         terminal already, or another worker holds a live lease.
 *   deliveries_exhausted  the queue has tried enough. The run is failed here rather
 *                         than left for the sweeper, so it closes at a known moment.
 *   cancelled             somebody asked it to stop before a worker ever saw it.
 */
export async function resumeRun(options: {
  runId: string;
  token: string;
  signal?: AbortSignal;
}): Promise<ResumeOutcome> {
  const owner = mintLeaseOwner();
  const claimed = await claimRun({ runId: options.runId, token: options.token, owner });

  if (!claimed) {
    const [existing] = await db()
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, options.runId), eq(runs.dispatchToken, options.token)))
      .limit(1);
    return { handled: false, reason: existing ? "not_claimable" : "unknown" };
  }

  if (claimed.cancelRequestedAt !== null) {
    await finishRun({
      runId: claimed.id,
      owner,
      status: "cancelled",
      error: "The run was cancelled.",
    });
    return { handled: false, reason: "cancelled" };
  }

  if (claimed.attempt > MAX_DELIVERIES) {
    await finishRun({
      runId: claimed.id,
      owner,
      status: "failed",
      error: `The run was retried ${MAX_DELIVERIES} times without finishing and has been given up on.`,
    });
    return { handled: false, reason: "deliveries_exhausted" };
  }

  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.id, claimed.workflowId))
    .limit(1);

  if (!workflow) {
    await finishRun({
      runId: claimed.id,
      owner,
      status: "failed",
      error: "The workflow this run belongs to no longer exists.",
    });
    return { handled: true, status: "failed" };
  }

  /**
   * **A redelivered run executes the graph it started on, not the graph as it is now.**
   *
   * This is the defect Phase 18 made visible and then fixed. A durable run survives a
   * redeploy by design, which means it can also survive an *edit*: delivery 1 runs
   * three nodes of version 4, the author saves version 5 removing one of them, and
   * delivery 2 resumes from a cursor whose queue names nodes that no longer exist. The
   * result is a run that executed half of one workflow and half of another and reports
   * a version number for neither.
   *
   * The snapshot is what closes it. A run with no recorded version — every run from
   * before this phase — and a run whose version was pruned both fall back to the live
   * graph, which is exactly the old behaviour, so nothing in flight was broken by
   * adding this.
   */
  const snapshot = await versionGraph(workflow.id, claimed.workflowVersion);
  const executing = snapshot ? { ...workflow, graph: snapshot } : workflow;

  // A cursor is present from the second delivery onward. Reading the steps back is what
  // lets the cursor stay small — node outputs live in the step rows, not in the cursor
  // (`cursor.ts`).
  const cursor = readCursor(claimed.cursor);
  const resume = cursor
    ? { cursor, steps: (await readSteps(claimed.id)).map(toStepRecord) }
    : undefined;

  try {
    const outcome = await drive({
      run: claimed,
      workflow: executing,
      owner,
      signal: options.signal,
      resume,
    });
    return {
      handled: true,
      status: outcome.stop === "interrupted" ? `interrupted:${outcome.reason}` : outcome.status!,
    };
  } catch {
    // `drive` has already failed the run. An invalid graph will still be invalid on the
    // next delivery, so this is answered as handled rather than retried.
    return { handled: true, status: "failed" };
  }
}

/** A persisted step row as the engine's own record type, for resuming. */
function toStepRecord(step: RunStep): StepRecord {
  return {
    seq: step.seq,
    nodeId: step.nodeId,
    nodeType: step.nodeType,
    iteration: step.iteration,
    status: step.status,
    config: step.config,
    input: step.input,
    output: step.output,
    branch: step.branch,
    logs: step.logs ?? [],
    error: step.error,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
  };
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
  await sweepAbandonedRuns(ownerId);

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
 * it deliberately does not read steps and does not sweep: one statement, no writes.
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
 * A run of this workflow that is genuinely still in flight, for a page load that lands
 * mid-run. A read, never a write: rendering a page must not sweep.
 *
 * **"In flight" is now the lease, not a heartbeat window.** Chapter 1 asked whether the
 * heartbeat was younger than five minutes, which was the best available proxy. The
 * lease answers the question exactly — a run with a live lease has a worker on it right
 * now — and it covers the case the proxy could not: a `queued` durable run, which has
 * no heartbeat to speak of because nothing has executed it yet, but is absolutely
 * about to run and must appear on the canvas.
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
        inArray(runs.status, ["queued", "running"]),
        gt(sql`coalesce(${runs.leaseExpiresAt}, ${runs.startedAt} + interval '2 minutes')`, sql`now()`),
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
    mode: run.mode,
    /** How many deliveries this run has had. Above 1 means it resumed after a failure. */
    attempt: run.attempt,
    /** A stop was asked for. The engine acts on it at its next step boundary. */
    cancelRequested: run.cancelRequestedAt !== null,
    /**
     * The workflow version this run executed (Phase 18). Null for a run recorded
     * before versioning existed — it is not claimed to be v1, because it is unknown.
     */
    workflowVersion: run.workflowVersion,
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
