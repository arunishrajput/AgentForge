import { and, eq, gt, isNotNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { pruneCredentialEvents } from "@/lib/credentials/audit";
import { sweepRuns } from "@/lib/engine/run";
import { enqueueRun } from "@/lib/engine/queue";
import { required } from "@/lib/env";
import { pruneInbox } from "@/lib/inbox/store";
import { pruneRuns } from "@/lib/runs/retention";

import { cronSecretMatches } from "./secret";
import { armSchedule, fireDue } from "./timer";

/**
 * The daily safety sweep — CONTRACT.md → "Trigger shapes".
 *
 * **Phase 26 changed what this is.** It was the only thing that fired schedules, on a
 * `*\/15` Cloud Scheduler tick that kept Neon awake around the clock. Schedules now fire
 * from their own Cloud Tasks timers (`timer.ts`), so this runs **once a day** and does the
 * things a timer cannot do for itself:
 *
 *   fire     any slot that is due and was never fired — its timer was lost, or it was due
 *            before this phase existed. Caught up once, not once per missed slot (D42).
 *   arm      every slot not armed, and every slot due before the next sweep whether or not
 *            it says it is armed. The second half is what covers a task that was created
 *            and then deleted or purged, which no column can see. A duplicate timer is
 *            harmless — the compare-and-set lets one of them fire — so arming without
 *            asking is cheaper and safer than asking Cloud Tasks what exists.
 *   wake     a `waiting` run whose wake time passed a while ago — its wake task was lost.
 *   sweep    abandoned runs, across every workspace (the sweeper's only scheduled caller).
 *   prune    credential audit events past retention (Phase 21), runs past theirs (Phase 33:
 *            finished, and over 30 days old or past their workflow's newest 200 — `runs/retention.ts`),
 *            and inbox entries as old (Phase 37 — `inbox/store.ts`).
 *
 * The route is the transport; the rules are here so they can be reasoned about without a
 * cron job.
 */

/**
 * How many due workflows one sweep will fire.
 *
 * Phase 17 raised this from 3 to 25 when the tick stopped executing runs and only enqueued
 * them. Since Phase 26 it bounds only the catch-up half of a daily sweep — a slot fires
 * from its own timer, not from here — so 25 is generous: anything still due stays due and
 * is taken by the next sweep, or by its re-armed timer first.
 */
export const MAX_FIRES_PER_TICK = 25;

/** How many schedules one sweep will arm. One enqueue each; bounded so a sweep is bounded. */
export const MAX_ARMS_PER_TICK = 100;

/** How many lost wakes one sweep will re-schedule. */
export const MAX_WAKES_PER_TICK = 50;

/**
 * Re-arm everything due before the next sweep, plus two hours. The sweep runs daily, so a
 * slot due 25 hours from now is re-armed by tomorrow's — the margin covers a sweep that
 * runs a little late.
 */
export const REARM_WINDOW_MS = 26 * 60 * 60 * 1000;

/**
 * How long past its wake time a waiting run must be before the sweep calls its task lost.
 * The queue retries a failed delivery with backoff from 5 to 60 seconds, so ten minutes
 * is well clear of a wake that is merely being retried.
 */
export const WAKE_GRACE_MS = 10 * 60 * 1000;

/** Re-exported so the route has one import; the implementation is in `./secret`. */
export { cronSecretMatches };

export interface TickOutcome {
  checkedAt: string;
  due: number;
  fired: {
    workflowId: string;
    runId: string;
    status: string;
    scheduledFor: string;
    /** False when the queue was unavailable and the tick executed the run itself. */
    queued: boolean;
  }[];
  /** Claimed by another tick between the select and the update. */
  skipped: string[];
  /** Due, but the schedule trigger has since gone or stopped parsing. */
  cleared: string[];
  /** Phase 26: schedules whose timer this sweep armed. */
  armed: number;
  /** Phase 26: waiting runs whose lost wake this sweep re-scheduled. */
  woken: number;
  /** Abandoned runs closed by this tick. The sweeper's only scheduled caller. */
  swept: number;
  /**
   * Credential audit events dropped past their retention window — Phase 21. The tick is the
   * only thing in this system that runs on a clock, so it is the only place a retention
   * policy can live (`lib/credentials/audit.ts`).
   */
  pruned: number;
  /**
   * Runs dropped past their retention — Phase 33, D153. Finished runs only, with their steps;
   * a queued, running or waiting run is never touched (`lib/runs/retention.ts`).
   */
  prunedRuns: number;
  /**
   * Inbox entries dropped past the run-retention age — Phase 37, D177. Most go sooner, with the
   * run they point at; this catches the rest.
   */
  prunedInbox: number;
}

export async function runDueSchedules(options: { now?: Date; signal?: AbortSignal } = {}): Promise<TickOutcome> {
  const { now = new Date(), signal } = options;

  const due = await db()
    .select()
    .from(workflows)
    .where(
      and(
        isNotNull(workflows.scheduleNextAt),
        lte(workflows.scheduleNextAt, now),
        eq(workflows.active, true),
      ),
    )
    .orderBy(workflows.scheduleNextAt)
    .limit(MAX_FIRES_PER_TICK);

  const outcome: TickOutcome = {
    checkedAt: now.toISOString(),
    due: due.length,
    fired: [],
    skipped: [],
    cleared: [],
    armed: 0,
    woken: 0,
    // Across every owner, which no other caller does: the run list sweeps only the workspace
    // asking, so a run abandoned by a user who never comes back would otherwise stay
    // `running` for ever on nobody looking at it.
    swept: await sweepRuns(),
    /**
     * Every tick rather than on a slower clock of its own. The statement is one indexed
     * delete that matches nothing on almost every tick, the database is already awake for
     * the sweep above, and a prune that runs rarely is a prune nobody notices has stopped.
     */
    pruned: await pruneCredentialEvents(now),
    /**
     * Phase 33. Here for the reason the line above is: the sweep has already woken the database,
     * so this costs no wake of its own, and run history is pruned by nothing else — never by a
     * schedule of its own (`BUILD_PLAN.md` → *The zero-cost problem*).
     */
    prunedRuns: (await pruneRuns({ now })).runs,
    /** Phase 37. The same reasoning: awake already, and nothing else prunes it. */
    prunedInbox: await pruneInbox(now),
  };

  for (const workflow of due) {
    const fired = await fireDue(workflow, now, signal);
    if (fired.kind === "cleared") outcome.cleared.push(workflow.id);
    else if (fired.kind === "skipped") outcome.skipped.push(workflow.id);
    else {
      outcome.fired.push({
        workflowId: workflow.id,
        runId: fired.runId,
        status: fired.status,
        scheduledFor: fired.scheduledFor,
        queued: fired.queued,
      });
      if (fired.armed) outcome.armed += 1;
    }
  }

  // Arm: every active, future slot that is unarmed, or due before the next sweep.
  const toArm = await db()
    .select({ id: workflows.id, scheduleNextAt: workflows.scheduleNextAt, active: workflows.active })
    .from(workflows)
    .where(
      and(
        eq(workflows.active, true),
        gt(workflows.scheduleNextAt, now),
        or(
          sql`${workflows.scheduleArmedFor} is distinct from ${workflows.scheduleNextAt}`,
          lte(workflows.scheduleNextAt, new Date(now.getTime() + REARM_WINDOW_MS)),
        ),
      ),
    )
    .orderBy(workflows.scheduleNextAt)
    .limit(MAX_ARMS_PER_TICK);

  for (const workflow of toArm) {
    if ((await armSchedule(workflow)).armed) outcome.armed += 1;
  }

  // Wake: a waiting run well past its wake time lost its task. Its dispatch token is the
  // only thing a delivery needs, and the claim takes it exactly once however many arrive.
  const lost = await db()
    .select({ id: runs.id, dispatchToken: runs.dispatchToken })
    .from(runs)
    .where(
      and(
        eq(runs.status, "waiting"),
        lt(runs.wakeAt, sql`now() - make_interval(secs => ${WAKE_GRACE_MS / 1000})`),
      ),
    )
    .limit(MAX_WAKES_PER_TICK);

  for (const run of lost) {
    if (!run.dispatchToken) continue;
    const result = await enqueueRun({
      runId: run.id,
      token: run.dispatchToken,
      baseUrl: required("APP_BASE_URL"),
      secret: required("CRON_SECRET"),
    });
    if (result.enqueued) outcome.woken += 1;
  }

  return outcome;
}
