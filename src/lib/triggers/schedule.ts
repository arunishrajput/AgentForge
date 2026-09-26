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
  scheduleNextAt: Date | null;
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
 */
export function nextScheduleState(options: {
  graph: WorkflowGraph;
  previousCron: string | null;
  previousNextAt: Date | null;
  now?: Date;
}): ScheduleState {
  const { graph, previousCron, previousNextAt, now = new Date() } = options;
  const cron = scheduleCron(graph);

  if (cron === null) return { scheduleNextAt: null };

  if (cron === previousCron && previousNextAt !== null) {
    return { scheduleNextAt: previousNextAt };
  }

  return { scheduleNextAt: nextTimeFor(cron, now) };
}
