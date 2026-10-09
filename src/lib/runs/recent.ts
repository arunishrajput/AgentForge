import type { StreamRun } from "@/lib/engine/stream";

import type { RunSummary } from "./history";

/**
 * **The canvas's recent runs, kept current without asking again — Phase 33.**
 *
 * The page hands the canvas a workflow's newest runs once; after that the run the canvas is
 * showing — streamed (D59), started here, or opened from this list — is merged in: an entry it
 * already has is updated in place, so a running row turns green as the run ends, and a run it
 * has not seen goes on top. No poll and no second request: the stream is already telling the
 * canvas everything that changes.
 */
export const RECENT_RUNS = 8;

export function summaryOf(run: StreamRun, workflowName: string): RunSummary {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName,
    status: run.status,
    trigger: run.trigger,
    mode: run.mode,
    attempt: run.attempt,
    cancelRequested: run.cancelRequested,
    wakeAt: run.wakeAt,
    test: run.test,
    origin: run.origin ?? null,
    handled: run.handled,
    workflowVersion: run.workflowVersion,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
  };
}

export function mergeRecent(
  recent: readonly RunSummary[],
  run: StreamRun | null,
  workflowName: string,
  cap = RECENT_RUNS,
): RunSummary[] {
  if (!run || run.workflowId !== (recent[0]?.workflowId ?? run.workflowId)) return [...recent];
  const summary = summaryOf(run, workflowName);
  const at = recent.findIndex((entry) => entry.id === run.id);
  if (at !== -1) return recent.with(at, summary);
  // Newest first by start time, as the server orders them; a run started here is always newest.
  return [summary, ...recent]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
    .slice(0, cap);
}
