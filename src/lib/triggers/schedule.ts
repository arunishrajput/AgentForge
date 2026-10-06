import { scheduleTrigger } from "@/lib/nodes/core/schedule-trigger";
import type { WorkflowGraph } from "@/lib/workflow/graph";

import { nextTimeFor } from "./cron";

/**
 * Deriving a workflow's schedule state from its graph — CONTRACT.md → "Trigger shapes".
 *
 * The graph stays the source of truth (D14); `scheduleNextAt` on the row is a
 * derived index so the cron tick is one indexed query instead of a scan that parses
 * every stored graph.
 */

/** The cron expression of the graph's schedule trigger, or null if it has none. */
export function scheduleCron(graph: WorkflowGraph): string | null {
  const node = graph.nodes.find((candidate) => candidate.type === scheduleTrigger.type);
  if (!node) return null;

  const parsed = scheduleTrigger.configSchema.safeParse(node.config ?? {});
  // An invalid expression yields no schedule rather than a throw. Validation already
  // reports it as `invalid_config`, and a workflow that cannot be scheduled must
  // still be saveable — a half-built canvas is (CONTRACT.md → "Graph validation").
  if (!parsed.success) return null;

  return (parsed.data as { cron: string }).cron;
}

export interface ScheduleState {
  /**
   * Absent means **leave the stored value alone** — not "set it to undefined". A save that
   * does not change the expression must not write this column at all; see below.
   */
  scheduleNextAt?: Date | null;
}

/**
 * What `scheduleNextAt` should become after a save.
 *
 * The rule that matters: when the expression has not changed, the stored due time is
 * **kept**, never recomputed. Recomputing looks harmless and is not — a schedule that
 * already fired for 09:00 today holds tomorrow 09:00, and recomputing from 08:59
 * would move it back to today and fire the same slot twice. Keeping it also means a
 * due time in the past survives a save and is caught up by the next tick, rather than
 * editing a workflow silently skipping a missed slot.
 *
 * **Phase 26 made "kept" mean "not written".** It used to write back the value the save
 * had read, which is the same thing unless a timer claims the slot in between: the claim
 * advances 09:00 to tomorrow, then the save writes 09:00 back, and the slot fires twice.
 * A timer firing within milliseconds of a save is rare, and a schedule firing twice is
 * the failure this column exists to prevent, so the save now leaves the column out of its
 * `UPDATE` and the claim's write stands.
 *
 * `active` false (Phase 26) means no due time at all: a switched-off workflow is not
 * scheduled, and switching it back on recomputes from now — deliberately, because the
 * person who switched it off did not ask for the slots they skipped to be caught up.
 */
export function nextScheduleState(options: {
  graph: WorkflowGraph;
  previousCron: string | null;
  previousNextAt: Date | null;
  active?: boolean;
  now?: Date;
}): ScheduleState {
  const { graph, previousCron, previousNextAt, active = true, now = new Date() } = options;
  const cron = scheduleCron(graph);

  if (cron === null || !active) return { scheduleNextAt: null };

  if (cron === previousCron && previousNextAt !== null) return {};

  return { scheduleNextAt: nextTimeFor(cron, now) };
}

/**
 * Whether a timer is armed for the due time — Phase 26. It says a task was *created* for
 * this slot; the daily sweep is what covers a task that was created and then lost.
 */
export function scheduleArmed(workflow: {
  scheduleNextAt: Date | null;
  scheduleArmedFor: Date | null;
}): boolean {
  return (
    workflow.scheduleNextAt !== null &&
    workflow.scheduleArmedFor !== null &&
    workflow.scheduleNextAt.getTime() === workflow.scheduleArmedFor.getTime()
  );
}
