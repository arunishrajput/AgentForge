import { and, eq, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { workflows, type Workflow } from "@/db/schema";
import { startRun } from "@/lib/engine/run";

import { nextTimeFor } from "./cron";
import { scheduleCron } from "./schedule";
import { cronSecretMatches } from "./secret";

/**
 * Firing due schedules — CONTRACT.md → "Trigger shapes".
 *
 * Cloud Run has no timers and scales to zero, so "every day at 09:00" is Cloud
 * Scheduler POSTing this and nothing else (ARCHITECTURE.md → "Queue — deliberately
 * none"). The route is the transport; the rules are here so they can be reasoned
 * about without a cron job.
 */

/**
 * How many due workflows one tick will fire.
 *
 * Bounded because runs are synchronous and in-process: the tick holds the request
 * open for the sum of its runs, and Cloud Scheduler abandons and retries an attempt
 * that outlives its deadline. Three runs at the engine's 120 s ceiling is 360 s,
 * inside the 540 s attempt deadline the job is created with. Anything still due is
 * picked up by the next tick — `scheduleNextAt` is in the past, so it stays due.
 */
export const MAX_FIRES_PER_TICK = 3;

/** Re-exported so the route has one import; the implementation is in `./secret`. */
export { cronSecretMatches };

export interface TickOutcome {
  checkedAt: string;
  due: number;
  fired: { workflowId: string; runId: string; status: string; scheduledFor: string }[];
  /** Claimed by another tick between the select and the update. */
  skipped: string[];
  /** Due, but the schedule trigger has since gone or stopped parsing. */
  cleared: string[];
}

/**
 * Claims a due workflow by compare-and-set, then runs it.
 *
 * `neon-http` has no transactions (D6), so this conditional `UPDATE ... RETURNING` is
 * the atomic primitive available — and it is enough. The claim advances
 * `scheduleNextAt` off the value that was observed, so a second tick reading the same
 * row updates zero rows and fires nothing. That is what makes a duplicate tick — a
 * Scheduler retry, an overlapping manual run of the job, two containers under
 * `max-instances 3` — safe, rather than a schedule that fires twice.
 *
 * The claim happens **before** the run, never after. A run that crashes the container
 * therefore loses its slot instead of re-firing on every tick for ever.
 */
async function claim(workflow: Workflow, now: Date): Promise<Date | null> {
  const cron = scheduleCron(workflow.graph);
  const observed = workflow.scheduleNextAt;
  if (cron === null || observed === null) return null;

  const [claimed] = await db()
    .update(workflows)
    .set({
      scheduleNextAt: nextTimeFor(cron, now),
      scheduleLastFiredAt: now,
    })
    .where(
      and(eq(workflows.id, workflow.id), eq(workflows.scheduleNextAt, observed)),
    )
    .returning({ id: workflows.id });

  return claimed ? observed : null;
}

export async function runDueSchedules(options: { now?: Date; signal?: AbortSignal } = {}): Promise<TickOutcome> {
  const { now = new Date(), signal } = options;

  const due = await db()
    .select()
    .from(workflows)
    .where(and(isNotNull(workflows.scheduleNextAt), lte(workflows.scheduleNextAt, now)))
    .orderBy(workflows.scheduleNextAt)
    .limit(MAX_FIRES_PER_TICK);

  const outcome: TickOutcome = {
    checkedAt: now.toISOString(),
    due: due.length,
    fired: [],
    skipped: [],
    cleared: [],
  };

  for (const workflow of due) {
    // A workflow whose schedule trigger was removed while its due time stood would
    // otherwise be selected on every tick for ever. Clear the column instead.
    if (scheduleCron(workflow.graph) === null) {
      await db()
        .update(workflows)
        .set({ scheduleNextAt: null })
        .where(eq(workflows.id, workflow.id));
      outcome.cleared.push(workflow.id);
      continue;
    }

    const scheduledFor = await claim(workflow, now);
    if (!scheduledFor) {
      outcome.skipped.push(workflow.id);
      continue;
    }

    const { run } = await startRun({
      ownerId: workflow.ownerId,
      workflow,
      trigger: "schedule",
      input: {
        scheduledFor: scheduledFor.toISOString(),
        firedAt: now.toISOString(),
        cron: scheduleCron(workflow.graph),
      },
      signal,
    });

    outcome.fired.push({
      workflowId: workflow.id,
      runId: run.id,
      status: run.status,
      scheduledFor: scheduledFor.toISOString(),
    });
  }

  return outcome;
}
