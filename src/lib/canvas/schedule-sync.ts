import type { Run, Workflow } from "./client";

/**
 * **Keeping the trigger panel honest on an open canvas — Phase 26.**
 *
 * When a schedule fires, the server moves `scheduleNextAt` to the next slot, records
 * `scheduleLastFiredAt` and arms a timer for the new slot. The canvas sees the *run* — the
 * stream reports it live — but the panel reads the editor's copy of the workflow row, which
 * nothing refreshed. So a person watching a 16:41 schedule fire saw both nodes tick green
 * while the panel still said "Next run 16:41", a time already past. A reload fixed it, and a
 * reload is exactly what the live canvas exists to make unnecessary.
 *
 * The fix re-reads the row once per scheduled run the canvas sees. That is one request per
 * *firing watched*, never per page load: a stream reports only runs that were not already
 * finished when it first looked (`followDecision`), so a scheduled run here is a new one.
 * `fireDue` arms the next slot before it starts the run, so the row is already final by the
 * time the run is visible.
 */

/** Whether `run` is a schedule firing this canvas has not yet re-read the schedule for. */
export function isNewScheduledRun(
  run: Pick<Run, "id" | "trigger"> | null,
  lastSeenRunId: string | null,
): boolean {
  return run !== null && run.trigger === "schedule" && run.id !== lastSeenRunId;
}

/**
 * `saved` with only the schedule's server-owned fields taken from `fresh`. Nothing else is
 * touched: `saved.graph` and `saved.name` are what the editor measures unsaved changes
 * against, and someone mid-edit must not have their Save button change under them because
 * a timer went off.
 */
export function withScheduleOf(saved: Workflow, fresh: Workflow): Workflow {
  return {
    ...saved,
    scheduleNextAt: fresh.scheduleNextAt,
    scheduleArmed: fresh.scheduleArmed,
    scheduleLastFiredAt: fresh.scheduleLastFiredAt,
  };
}
