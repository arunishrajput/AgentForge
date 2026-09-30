import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { runs, runSteps, workflows } from "@/db/schema";
import { getNode } from "@/lib/nodes";
import { visibleWorkflows } from "@/lib/workflow/visibility";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import {
  bucketByDay,
  groupFailures,
  median,
  percentile,
  summarise,
  toDurations,
  type RunRow,
} from "./shape";
import { DEFAULT_RANGE, type Analytics, type ModelStat, type NodeStat, type Range } from "./types";

/**
 * **Run analytics — Phase 22, and the phase's one genuinely expensive decision.**
 *
 * `BUILD_PLAN.md` states the constraint before it states the feature: *an analytics page
 * that polls is exactly the pattern that pins the database awake*. Neon's free plan meters
 * **compute time awake**, not statements (`DEPLOYMENT.md` → *Free-tier headroom*, sharpened
 * in Phase 19A), and the quarter-hourly cron tick already commits ~61 of the 100 CU-hours a
 * month.
 * What spends the rest is **a new reason to wake an idle database**.
 *
 * So the design is, in order of how much each one saves:
 *
 *  1. **Nothing here runs on a clock.** No aggregation job, no materialised rollup, no
 *     cache warmer. The queries run when a person opens the page, and a person opening a
 *     page has already woken the database by signing in. This is the whole saving; the
 *     rest is housekeeping.
 *  2. **The page does not poll and does not stream.** The range selector is a link, so a
 *     new window is a navigation the reader asked for. `DEPLOYMENT.md` records what the
 *     alternative costs: a 30-second refresh on one open tab is 120 wakes an hour.
 *  3. **Three statements, not one per card.** Every figure on the page comes from three
 *     round trips — runs, steps, models — because a statement against a database that is
 *     already awake is close to free and a *round trip* over the pooled connection is the
 *     only part that is not.
 *  4. **The window is bounded and indexed.** Every query opens on
 *     `(workspaceId, startedAt)`, which is `run_workspace_idx`, already present since
 *     Phase 19A. Nothing here added an index and nothing here scans a table.
 *
 * **Aggregating in Postgres or in Node.** The run query returns rows and shapes them here,
 * in `shape.ts`; the step and model queries aggregate in Postgres. That is not an
 * inconsistency: the run rows are needed individually anyway for error grouping, which
 * runs a normaliser Postgres does not have, so returning them costs nothing extra. The
 * step rows are not — there are an order of magnitude more of them and nothing needs one
 * on its own — so they are counted where they live.
 *
 * **Every query is scoped twice**, by workspace and by `visibleWorkflows`, exactly as
 * `run.ts` does it and for the same reason recorded there: a run carries the name of its
 * workflow, so a viewer with no access to a private workflow must not learn its failure
 * rate from a chart. The join is an equality on a primary key, and `run.workflowId`
 * cascades, so it can never drop a row it should have kept.
 */

/** Runs read per window. Above this the page is an export, not a dashboard. */
const MAX_RUNS = 2000;

/** How many rows the node and model tables show. */
const MAX_NODES = 10;
const MAX_MODELS = 8;

export async function readAnalytics(
  scope: WorkspaceScope,
  range: Range = DEFAULT_RANGE,
): Promise<Analytics> {
  const startedAt = Date.now();
  const to = new Date();
  const from = new Date(to.getTime() - range * 86_400_000);

  const visible = visibleWorkflows(scope);
  const inWindow = and(
    eq(runs.workspaceId, scope.workspaceId),
    gte(runs.startedAt, from),
    visible,
  );

  const runRows = await db()
    .select({
      id: runs.id,
      status: runs.status,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      error: runs.error,
    })
    .from(runs)
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(inWindow)
    .orderBy(desc(runs.startedAt))
    .limit(MAX_RUNS);

  const [nodes, models] = await Promise.all([
    readNodeStats(scope, from),
    readModelStats(scope, from),
  ]);

  const rows: RunRow[] = runRows;

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: summarise(rows),
    days: bucketByDay(rows, from, to),
    failures: groupFailures(rows),
    nodes,
    models,
    queryMs: Date.now() - startedAt,
  };
}

/**
 * Per-node-type latency, aggregated in Postgres.
 *
 * **`array_agg` of the durations rather than `percentile_cont`**, so the percentile is
 * computed by the same `percentile()` the run figures use. Two definitions of p95 on one
 * page — Postgres interpolating and this module taking a nearest rank — would differ by a
 * few milliseconds on small samples and be impossible to explain to whoever noticed.
 * The array is bounded by the same window and by `MAX_NODES` rows.
 *
 * A step with no `finishedAt` is excluded rather than counted as zero: a `skipped` step
 * has no duration, and the untaken side of a branch is recorded as skipped for every run
 * (`engine/execute.ts`), so counting them would put a floor of zeros under every node
 * that sits after a branch.
 */
async function readNodeStats(scope: WorkspaceScope, from: Date): Promise<NodeStat[]> {
  const rows = await db()
    .select({
      nodeType: runSteps.nodeType,
      runs: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${runSteps.status} = 'failed')::int`,
      totalMs: sql<number>`coalesce(sum(extract(epoch from (${runSteps.finishedAt} - ${runSteps.startedAt})) * 1000), 0)::bigint`,
      /**
       * **`jsonb_agg`, not `array_agg`.** The HTTP driver returns a Postgres array as its
       * text literal — `{1200,34,5}` — and the first version of this query took `.map` of
       * it and answered 500 for the whole page. JSONB is parsed as JSON by every driver,
       * so this comes back as real numbers; `toDurations` keeps the guarantee anyway.
       */
      durations: sql<unknown>`coalesce(jsonb_agg(extract(epoch from (${runSteps.finishedAt} - ${runSteps.startedAt})) * 1000), '[]'::jsonb)`,
    })
    .from(runSteps)
    .innerJoin(runs, eq(runs.id, runSteps.runId))
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(
      and(
        eq(runs.workspaceId, scope.workspaceId),
        gte(runs.startedAt, from),
        visibleWorkflows(scope),
        inArray(runSteps.status, ["succeeded", "failed"]),
        sql`${runSteps.finishedAt} is not null and ${runSteps.startedAt} is not null`,
      ),
    )
    .groupBy(runSteps.nodeType)
    .orderBy(desc(sql`count(*)`))
    .limit(MAX_NODES);

  return rows.map((row) => {
    const durations = toDurations(row.durations);

    const definition = getNode(row.nodeType);
    return {
      nodeType: row.nodeType,
      // Null for a type the registry no longer has. A run is a historical record and
      // survives a node being renamed, so the table shows the recorded type and says
      // nothing it cannot stand behind.
      label: definition?.label ?? null,
      runs: Number(row.runs),
      failures: Number(row.failures),
      medianMs: median(durations),
      p95Ms: percentile(durations, 95),
      totalMs: Number(row.totalMs),
    };
  });
}

/**
 * Model usage, read out of the step rows the AI nodes already write.
 *
 * **No new column and no new table.** `ai.llm` and `ai.agent` both put `model` and `usage`
 * on their output (`nodes/ai/llm.ts`, `nodes/ai/agent.ts`), so which model answered and
 * what it cost is already recorded per step — by the model that *answered*, which is the
 * useful one, because after a fallback that is not the model that was asked for.
 *
 * It reads the JSONB rather than a registry list of AI node types, because a node type
 * added in Phase 23 that writes `output.model` is a model call whether or not anybody
 * remembered to add it to a list here.
 */
async function readModelStats(scope: WorkspaceScope, from: Date): Promise<ModelStat[]> {
  const rows = await db()
    .select({
      model: sql<string>`${runSteps.output}->>'model'`,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum((${runSteps.output}->'usage'->>'inputTokens')::bigint), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum((${runSteps.output}->'usage'->>'outputTokens')::bigint), 0)::bigint`,
    })
    .from(runSteps)
    .innerJoin(runs, eq(runs.id, runSteps.runId))
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(
      and(
        eq(runs.workspaceId, scope.workspaceId),
        gte(runs.startedAt, from),
        visibleWorkflows(scope),
        sql`${runSteps.output} ? 'model' and jsonb_typeof(${runSteps.output}->'model') = 'string'`,
      ),
    )
    .groupBy(sql`${runSteps.output}->>'model'`)
    .orderBy(desc(sql`count(*)`))
    .limit(MAX_MODELS);

  return rows.map((row) => ({
    model: row.model,
    calls: Number(row.calls),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
  }));
}
