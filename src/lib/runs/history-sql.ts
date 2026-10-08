import { sql, type SQL } from "drizzle-orm";

import { TERMINAL_RUN_STATUSES } from "@/lib/engine/types";

import type { RunKey } from "./query";

/**
 * **The run history's SQL that drizzle's builder cannot say — every name written out and
 * qualified** (Phase 33).
 *
 * Phase 32 learned that drizzle renders an interpolated column unqualified in some positions
 * (`PROGRESS.md` → *Engineering rules*), and every query here joins `run` to `workflow` — two
 * tables that both have an `"id"`. So the keyset is written as literal SQL naming `"run"`, and
 * `history-sql.test.ts` renders each fragment and checks it. Kept free of the database so that
 * test can run.
 */

/**
 * A run's position in the history as the **database** writes it: its start, in UTC, to the
 * microsecond. Never built from a `Date`, which would truncate to the millisecond and make the
 * next page skip runs (`query.ts` → `RunKey`).
 */
export function runKeyAt(): SQL<string> {
  return sql<string>`to_char("run"."startedAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Runs older than `key` — the page after it. A row comparison, so ties on time fall to the id. */
export function olderThan(key: RunKey): SQL {
  return sql`("run"."startedAt", "run"."id") < (${key.at}::timestamptz, ${key.id})`;
}

/** Runs newer than `key` — the page before it. */
export function newerThan(key: RunKey): SQL {
  return sql`("run"."startedAt", "run"."id") > (${key.at}::timestamptz, ${key.id})`;
}

/** Newest first, or oldest first when stepping back to a newer page. Id breaks a tie on time. */
export function historyOrder(direction: "newest" | "oldest"): SQL {
  return direction === "newest"
    ? sql`"run"."startedAt" desc, "run"."id" desc`
    : sql`"run"."startedAt" asc, "run"."id" asc`;
}

/**
 * **The retention rule as one statement — Phase 33, D153.** A run goes when it is finished and
 * either older than `cutoff` or not among the newest `keep` runs of its workflow.
 *
 * - **Only a finished run** (`succeeded`, `failed`, `cancelled`). A run that is queued, running or
 *   `waiting` — which may legitimately be thirty days into a wait — is never touched, whatever
 *   its age
 * - **Age from when it finished**, not from when it started: a run that waited 29 days and then
 *   finished is a day old, and pruning it at the next sweep would delete it before anybody read it
 * - **The count includes every run**, finished or not, so the newest `keep` are kept outright
 * - **At most `limit` a sweep, oldest first**, so one sweep is bounded; the rest go the next day
 *
 * `dryRun` answers what would go without deleting it — the same `doomed` set, so a dry run and the
 * real one cannot disagree about what the rule means. `workspaceId` narrows the statement to one
 * workspace: how the rule is verified in a throwaway one without touching anybody's history.
 * `withIds` returns the ids too, for that verification; the daily sweep does not want five
 * thousand of them. Steps go with their run (`run_step.runId` cascades) and are counted in the
 * same statement — every part of a statement reads the snapshot it began with, so the count is
 * of the steps the delete removes.
 */
export function pruneRunsSql(options: {
  cutoff: Date;
  keep: number;
  limit: number;
  dryRun: boolean;
  workspaceId?: string;
  withIds?: boolean;
}): SQL {
  const scoped = options.workspaceId ? sql`where r."workspaceId" = ${options.workspaceId}` : sql``;
  const finished = sql.join(
    TERMINAL_RUN_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );
  const ids = options.withIds
    ? sql`(select coalesce(json_agg(d."id"), '[]'::json) from doomed d)`
    : sql`'[]'::json`;
  const remove = options.dryRun
    ? sql``
    : sql`, gone as (
      delete from "run" where "run"."id" in (select d."id" from doomed d) returning "run"."id"
    )`;
  const count = options.dryRun
    ? sql`(select count(*)::int from doomed)`
    : sql`(select count(*)::int from gone)`;

  return sql`
    with ranked as (
      select r."id", r."status", r."finishedAt",
        row_number() over (partition by r."workflowId" order by r."startedAt" desc, r."id" desc) as "rank"
      from "run" r
      ${scoped}
    ), doomed as (
      select ranked."id" from ranked
      where ranked."status" in (${finished})
        and (ranked."finishedAt" < ${options.cutoff.toISOString()}::timestamptz or ranked."rank" > ${options.keep})
      order by ranked."finishedAt" asc
      limit ${options.limit}
    )${remove}
    select
      ${count} as "runs",
      (select count(*)::int from "run_step" s where s."runId" in (select d."id" from doomed d)) as "steps",
      ${ids} as "ids"`;
}
