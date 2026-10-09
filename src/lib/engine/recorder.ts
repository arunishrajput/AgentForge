import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { runSteps } from "@/db/schema";
import { recordRequest, reissueLink } from "@/lib/approvals/store";

import { checkpointRun } from "./lease";
import type { Checkpoint, RunRecorder, StepRecord } from "./types";

/**
 * The database-backed recorder. The only module in the engine that imports `@/db`,
 * which is what lets the critical-path tests run the engine with no database at
 * all.
 *
 * Writes are one statement each — `drizzle-orm/neon-http` has no transactions
 * (D6). That is sound here because a step record is independently meaningful: a
 * run cut short mid-write loses at most the tail of its history. In Chapter 1 that
 * history was all a cut-short run left behind; from Phase 17 the step rows are also
 * where a *resumed* run reads its predecessor's outputs from (`cursor.ts`), which
 * makes the independence of each row load-bearing rather than merely convenient.
 */

export function dbRecorder(
  runId: string,
  leaseOwner: string,
  /**
   * Phase 38 — where an approval request this run makes belongs. Given by every driver; without it
   * the recorder cannot keep a request, and an approval fails its step saying so.
   */
  owner?: { workspaceId: string; workflowId: string },
): RunRecorder {
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
    /**
     * Serialised on the same chain as the step writes, which is what guarantees the
     * cursor is never written *ahead* of the step it describes. A cursor that named
     * outstanding work whose step row had not landed yet would, on a redelivery,
     * resume from a `fromSeq` with no output behind it.
     *
     * A checkpoint that cannot be written is reported as a lost lease rather than
     * swallowed. That is the conservative reading: the engine stops, and either a
     * redelivery resumes the run or the sweeper closes it — where carrying on would
     * mean executing a run whose progress nothing is recording.
     */
    checkpoint: (cursor): Promise<Checkpoint> =>
      queue(() => checkpointRun({ runId, owner: leaseOwner, cursor })).catch(() => ({
        cancelRequested: false,
        leaseHeld: false,
      })),
    /**
     * Phase 38. Not on the chain: the request's row depends on no step row, and the engine awaits it
     * before it records the step that hands its link on — so the step can never name a request that
     * is not there. A failed write throws, and fails the approval's step with the reason.
     */
    ...(owner
      ? {
          requestApproval: (request) => recordRequest({ ...request, runId, ...owner }),
          reissueApproval: (approvalId) => reissueLink(approvalId),
        }
      : {}),
  };
}
