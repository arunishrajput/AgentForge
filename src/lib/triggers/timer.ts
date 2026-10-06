import { and, eq, lte } from "drizzle-orm";

import { db } from "@/db";
import { workflows, type Workflow } from "@/db/schema";
import { startDurableRun } from "@/lib/engine/run";
import { enqueueFire } from "@/lib/engine/queue";
import { required } from "@/lib/env";
import { logError } from "@/lib/logging";
import { systemScope } from "@/lib/workspace/scope";

import { nextTimeFor } from "./cron";
import { scheduleCron } from "./schedule";
import { fireToken, fireTokenMatches } from "./secret";

/**
 * Schedule timers — **Phase 26**, and the reason a schedule fires without a clock.
 *
 * Until this phase a schedule fired only when Cloud Scheduler's `*\/15` tick swept it, and
 * that tick woke Neon 96 times a day whether anything was due or not — ~60 of the free
 * plan's 100 CU-hours a month, spent on asking. M12 paused it to save them, and from then
 * on no schedule fired at all. Now each due time gets **one Cloud Tasks task scheduled for
 * that exact time**: the database is woken when there is something to do, and the tick
 * shrinks to a daily safety sweep (`tick.ts`).
 *
 * **The timer is never the correctness mechanism.** A delivery fires only by claiming the
 * slot with D42's compare-and-set — `WHERE scheduleNextAt = <the slot this task was armed
 * for>` — so a task armed for a slot that has since moved (the expression changed, the
 * workflow was switched off or deleted, another delivery already fired it) updates zero
 * rows and starts nothing. Nothing ever needs to *delete* a task for the system to be
 * right, which is why tasks are unnamed and deletion is not attempted.
 */

export type ArmOutcome =
  | { armed: true }
  | { armed: false; reason: "nothing_due" | "unconfigured" | "unauthenticated" | "rejected" | "moved" };

/**
 * Create the timer for a workflow's current due time, and record that it exists.
 *
 * The record (`scheduleArmedFor`) is written **after** the task is created and only while
 * the slot is still the one it was armed for, so it never claims a timer that does not
 * exist, and a save that moved the slot in between is not overwritten. A failed enqueue
 * leaves the slot unarmed — the trigger panel says so, and the daily sweep tries again —
 * and is logged as `queue.degraded`, the event the alerting policy is built on, because an
 * unarmed schedule is the silent failure this phase exists to remove.
 */
export async function armSchedule(workflow: {
  id: string;
  scheduleNextAt: Date | null;
  active: boolean;
}): Promise<ArmOutcome> {
  if (!workflow.active || workflow.scheduleNextAt === null) {
    return { armed: false, reason: "nothing_due" };
  }

  const slot = workflow.scheduleNextAt;
  const scheduledFor = slot.toISOString();
  const result = await enqueueFire({
    workflowId: workflow.id,
    scheduledFor,
    token: fireToken(workflow.id, scheduledFor, required("AUTH_SECRET")),
    baseUrl: required("APP_BASE_URL"),
    secret: required("CRON_SECRET"),
  });

  if (!result.enqueued) {
    if (result.reason !== "unconfigured") {
      logError("queue.degraded", `The schedule timer for workflow ${workflow.id} could not be armed.`, result.detail, {
        reason: result.reason,
        workflowId: workflow.id,
      });
    }
    return { armed: false, reason: result.reason };
  }

  const [recorded] = await db()
    .update(workflows)
    .set({ scheduleArmedFor: slot })
    .where(and(eq(workflows.id, workflow.id), eq(workflows.scheduleNextAt, slot)))
    .returning({ id: workflows.id });

  return recorded ? { armed: true } : { armed: false, reason: "moved" };
}

export type FireOutcome =
  | {
      kind: "fired";
      runId: string;
      status: string;
      scheduledFor: string;
      /** False when the queue was unavailable and the run executed in-process. */
      queued: boolean;
      /** The next slot, and whether its timer was armed. */
      nextAt: string | null;
      armed: boolean;
    }
  /** The slot was claimed by somebody else, or moved, between the read and the claim. */
  | { kind: "skipped" }
  /** Due, but the schedule trigger has gone or stopped parsing. The column is cleared. */
  | { kind: "cleared" };

/**
 * Fire one due slot: claim it, start the run, arm the next one. Shared by the timer's
 * own delivery and by the daily sweep, so "what firing a schedule means" lives once.
 *
 * The claim happens **before** the run, never after (D42): a run that kills the container
 * loses its slot instead of firing it for ever. It also clears `scheduleArmedFor`, because
 * the timer that was armed has now been spent.
 *
 * The run is **durable, always** — a scheduled run is the case with nobody watching and
 * nobody to press Run again, which is exactly what durability is for.
 */
export async function fireDue(
  workflow: Workflow,
  now: Date,
  signal?: AbortSignal,
): Promise<FireOutcome> {
  const cron = scheduleCron(workflow.graph);
  const observed = workflow.scheduleNextAt;

  if (cron === null || observed === null) {
    // A workflow whose schedule trigger was removed while its due time stood would
    // otherwise be selected on every sweep for ever. Clear the column instead.
    await db()
      .update(workflows)
      .set({ scheduleNextAt: null, scheduleArmedFor: null })
      .where(eq(workflows.id, workflow.id));
    return { kind: "cleared" };
  }

  const next = nextTimeFor(cron, now);
  const [claimed] = await db()
    .update(workflows)
    .set({ scheduleNextAt: next, scheduleLastFiredAt: now, scheduleArmedFor: null })
    .where(
      and(
        eq(workflows.id, workflow.id),
        eq(workflows.scheduleNextAt, observed),
        eq(workflows.active, true),
        lte(workflows.scheduleNextAt, now),
      ),
    )
    .returning({ id: workflows.id });

  if (!claimed) return { kind: "skipped" };

  const { run, queued } = await startDurableRun({
    // No session here — the scope comes off the workflow row, so a scheduled run lands
    // in the same workspace as the workflow that scheduled it.
    scope: systemScope(workflow),
    workflow,
    trigger: "schedule",
    input: { scheduledFor: observed.toISOString(), firedAt: now.toISOString(), cron },
    signal,
  });

  const arm = await armSchedule({ id: workflow.id, scheduleNextAt: next, active: true });

  return {
    kind: "fired",
    runId: run.id,
    status: run.status,
    scheduledFor: observed.toISOString(),
    queued,
    nextAt: next?.toISOString() ?? null,
    armed: arm.armed,
  };
}

export type DeliveryOutcome =
  | FireOutcome
  /** Not yet due: the slot is further out than the queue's horizon, or a clock ran early. */
  | { kind: "rearmed"; armed: boolean }
  /** Nothing to do, and the reason is worth a log line. Answered 200 so it is not retried. */
  | { kind: "declined"; reason: "forged" | "gone" | "stale" };

/**
 * What a timer delivery does — the whole of `POST /api/cron/fire` below its outer gate.
 *
 * In order, cheapest first:
 *
 *   forged   the token does not match this workflow and slot. Checked before any query,
 *            so a scan of the route costs no database time.
 *   gone     the workflow no longer exists.
 *   stale    the workflow is switched off, or its due time is no longer this slot — the
 *            expression changed, or this slot already fired. **Zero runs.** This is the
 *            case the phase's validation asserts by editing a schedule after arming it.
 *   rearmed  the slot is current but not yet due: arm it again for the real time.
 *   fired / skipped / cleared — `fireDue`.
 */
export async function deliverFire(
  options: { workflowId: string; scheduledFor: string; token: string },
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<DeliveryOutcome> {
  if (!fireTokenMatches(options.token, options.workflowId, options.scheduledFor, required("AUTH_SECRET"))) {
    return { kind: "declined", reason: "forged" };
  }

  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.id, options.workflowId))
    .limit(1);

  if (!workflow) return { kind: "declined", reason: "gone" };

  if (
    !workflow.active ||
    workflow.scheduleNextAt === null ||
    workflow.scheduleNextAt.toISOString() !== options.scheduledFor
  ) {
    return { kind: "declined", reason: "stale" };
  }

  if (workflow.scheduleNextAt.getTime() > now.getTime()) {
    const arm = await armSchedule(workflow);
    return { kind: "rearmed", armed: arm.armed };
  }

  return fireDue(workflow, now, signal);
}
