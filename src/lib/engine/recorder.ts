import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import { runs, runSteps } from "@/db/schema";

import type { RunRecorder, StepRecord } from "./types";

/**
 * The database-backed recorder. The only module in the engine that imports `@/db`,
 * which is what lets the critical-path tests run the engine with no database at
 * all.
 *
 * Writes are one statement each — `drizzle-orm/neon-http` has no transactions
 * (D6). That is sound here because a step record is independently meaningful: a
 * run cut short mid-write loses at most the tail of its history, and
 * `reapStaleRuns` marks the run failed regardless. Re-checked deliberately this
 * phase rather than assumed.
 */

/** How long a `running` run may go without a heartbeat before it is presumed dead. */
export const STALE_RUN_MS = 5 * 60_000;

export function dbRecorder(runId: string): RunRecorder {
  /**
   * Every write for this run goes through one chain.
   *
   * `stepLogged` cannot be awaited — `context.log` is synchronous by design — so a
   * log write is in flight while the engine moves on. Unchained, a late log write
   * carrying `[a]` could land after the finished step wrote `[a, b]` and silently
   * take the second line back. Serialising them means the last write always holds
   * the longest log array, and `then(work, work)` means one failed write does not
   * stall the rest.
   */
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  };

  const insert = async (step: StepRecord) => {
    await db()
      .insert(runSteps)
      .values({
        runId,
        seq: step.seq,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        iteration: step.iteration,
        status: step.status,
        config: step.config ?? null,
        input: step.input ?? null,
        output: step.output ?? null,
        branch: step.branch,
        logs: [...step.logs],
        error: step.error,
        startedAt: step.startedAt ? new Date(step.startedAt) : null,
        finishedAt: step.finishedAt ? new Date(step.finishedAt) : null,
      })
      .onConflictDoUpdate({
        target: [runSteps.runId, runSteps.seq],
        set: {
          status: step.status,
          config: step.config ?? null,
          output: step.output ?? null,
          branch: step.branch,
          logs: [...step.logs],
          error: step.error,
          finishedAt: step.finishedAt ? new Date(step.finishedAt) : null,
        },
      });
  };

  /** Only the log column: the step is mid-flight, so nothing else is settled yet. */
  const writeLogs = async (step: StepRecord) => {
    await db()
      .update(runSteps)
      .set({ logs: [...step.logs] })
      .where(and(eq(runSteps.runId, runId), eq(runSteps.seq, step.seq)));
  };

  return {
    stepStarted: (step) => queue(() => insert(step)),
    stepFinished: (step) => queue(() => insert(step)),
    stepLogged: (step) => {
      // A log line that cannot be persisted must not fail the run — the line is
      // still in the step record the engine returns, and `stepFinished` writes it.
      void queue(() => writeLogs(step)).catch(() => {});
    },
    heartbeat: () =>
      queue(async () => {
        await db().update(runs).set({ heartbeatAt: new Date() }).where(eq(runs.id, runId));
      }),
  };
}

/**
 * Fails runs whose engine died — a redeploy, an instance recycle, a crash. Without
 * this a run sits in `running` for ever, which ARCHITECTURE.md rules out. Called
 * before listing or starting runs rather than on a timer, because Cloud Run scales
 * to zero and a timer would simply not fire.
 */
export async function reapStaleRuns(ownerId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const reaped = await db()
    .update(runs)
    .set({
      status: "failed",
      error: "Run was interrupted before it finished — the server restarted or the request was cut short.",
      finishedAt: new Date(),
    })
    .where(
      and(eq(runs.ownerId, ownerId), eq(runs.status, "running"), lt(runs.heartbeatAt, cutoff)),
    )
    .returning({ id: runs.id });

  return reaped.length;
}
