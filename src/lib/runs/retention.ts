import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { runs } from "@/db/schema";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { pruneRunsSql } from "./history-sql";

/**
 * **How long run history is kept — Phase 33, D153, `CONTRACT.md` → *Run retention*.**
 *
 * The numbers come from a measurement, not a habit. On 2026-10-08 the production database held
 * 155 runs and 859 steps in **1.19 MB** of `run` and `run_step` — **~7.7 KB a run on disk**, indexes
 * and page overhead included (3.6 KB of row data on average, 6.7 KB at the 95th percentile,
 * 10.3 KB at most). Neon's free plan stores **0.5 GB**, of which the rest of the database uses ~12 MB.
 *
 *   30 days   covers "find last week's run" with three weeks to spare, and is when a run stops
 *             being something anybody opens to understand today's behaviour
 *   200 runs  bounds one workflow however often it fires. At the measured size that is ~1.5 MB; at
 *             the worst a run can be — an HTTP step's body is capped at 256 KB (`integrations/net.ts`)
 *             — it is ~51 MB, a tenth of the plan, so one noisy workflow cannot fill the database
 *             for everybody else. An hourly schedule keeps about eight days; a daily one, thirty
 *
 * Pruned by the **daily sweep** (`lib/triggers/tick.ts`), the only thing in this system that runs on
 * a clock — never by a schedule of its own, because a new reason to wake an idle database is the
 * one thing the zero-cost rule forbids (`BUILD_PLAN.md` → *The zero-cost problem*). The sweep has
 * woken the database already, so the prune costs no compute that was not spent.
 */
export const RUN_RETENTION_DAYS = 30;
export const RUNS_KEPT_PER_WORKFLOW = 200;

/** Runs one sweep deletes at most. A backlog larger than this drains over the following days. */
export const MAX_PRUNED_PER_SWEEP = 5000;

export interface PruneOutcome {
  /** Runs deleted — or that would be, on a dry run. */
  runs: number;
  /** Their steps, which go with them. */
  steps: number;
  /** The runs' ids, only when asked for. */
  ids: string[];
}

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RUN_RETENTION_DAYS * 86_400_000);
}

/**
 * Apply the retention rule — or, with `dryRun`, say what applying it would delete.
 *
 * One statement either way (`history-sql.ts` → `pruneRunsSql`). `workspaceId` confines it to one
 * workspace, which only the verification uses; the sweep prunes every workspace at once.
 */
export async function pruneRuns(
  options: { now?: Date; dryRun?: boolean; workspaceId?: string; withIds?: boolean } = {},
): Promise<PruneOutcome> {
  const now = options.now ?? new Date();
  const result = await db().execute<{ runs: number; steps: number; ids: string[] }>(
    pruneRunsSql({
      cutoff: retentionCutoff(now),
      keep: RUNS_KEPT_PER_WORKFLOW,
      limit: MAX_PRUNED_PER_SWEEP,
      dryRun: options.dryRun ?? false,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      withIds: options.withIds ?? false,
    }),
  );
  const row = result.rows[0];
  return { runs: Number(row?.runs ?? 0), steps: Number(row?.steps ?? 0), ids: row?.ids ?? [] };
}

/** What *Settings → Workspace* says about this workspace's history: how much, and since when. */
export interface RetentionSummary {
  days: number;
  perWorkflow: number;
  runs: number;
  /** ISO. The oldest run still kept, or null when there is none. */
  oldest: string | null;
}

/**
 * The workspace's run count and its oldest run, for the settings page. One statement on
 * `run_workspace_idx`. **Not filtered by visibility**: it describes the workspace's storage, not
 * any workflow, and a count says nothing about a private workflow that the workspace's own
 * analytics would not.
 */
export async function readRetention(scope: WorkspaceScope): Promise<RetentionSummary> {
  const [row] = await db()
    .select({
      runs: sql<number>`count(*)::int`,
      oldest: sql<string | null>`min(${runs.startedAt})`,
    })
    .from(runs)
    .where(and(eq(runs.workspaceId, scope.workspaceId)));

  const oldest = row?.oldest ? new Date(row.oldest) : null;
  return {
    days: RUN_RETENTION_DAYS,
    perWorkflow: RUNS_KEPT_PER_WORKFLOW,
    runs: Number(row?.runs ?? 0),
    oldest: oldest && !Number.isNaN(oldest.getTime()) ? oldest.toISOString() : null,
  };
}
