import assert from "node:assert/strict";
import { test } from "node:test";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { PgDialect } from "drizzle-orm/pg-core";
import { neon } from "@neondatabase/serverless";

import { runs, workflows } from "@/db/schema";

import { historyOrder, newerThan, olderThan, pruneRunsSql, runKeyAt } from "./history-sql";

/**
 * **The run history's SQL, rendered and read — Phase 33.** Every query here joins `run` to
 * `workflow`, two tables with an `"id"`, and Phase 32 found that drizzle renders an interpolated
 * column unqualified in some positions. These check every reference names its table, and that
 * the cursor is formatted by the database to the microsecond.
 */

const dialect = new PgDialect();
const render = (fragment: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(fragment);
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const KEY = { at: "2026-10-08T09:00:09.155123Z", id: "run-1" };

test("the page query keysets on the run's own columns, by qualified name", () => {
  const db = drizzle(neon("postgres://user:pass@localhost/db"));
  const { sql: text, params } = db
    .select({ id: runs.id, key: runKeyAt() })
    .from(runs)
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(and(eq(runs.workspaceId, "ws-1"), olderThan(KEY)))
    .orderBy(historyOrder("newest"))
    .limit(26)
    .toSQL();
  const flat = squash(text);

  assert.match(flat, /\("run"\."startedAt", "run"\."id"\) < \(\$\d::timestamptz, \$\d\)/);
  assert.match(flat, /order by "run"\."startedAt" desc, "run"\."id" desc/);
  // Never a bare "id": with `workflow` joined it would be ambiguous, or worse, the wrong table's.
  assert.doesNotMatch(flat, /\(\s*"startedAt", "id"\)/);
  assert.ok(params.includes(KEY.at) && params.includes(KEY.id));
});

test("the cursor is the database's own UTC time to the microsecond, not a JavaScript Date", () => {
  const flat = squash(render(runKeyAt()).sql);
  assert.match(flat, /to_char\("run"\."startedAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\)/);
});

test("a newer page reads the other way", () => {
  assert.match(squash(render(newerThan(KEY)).sql), /\("run"\."startedAt", "run"\."id"\) > \(\$1::timestamptz, \$2\)/);
  assert.equal(squash(render(historyOrder("oldest")).sql), `"run"."startedAt" asc, "run"."id" asc`);
});

test("retention deletes only finished runs, older than the cutoff or past the per-workflow count", () => {
  const cutoff = new Date("2026-09-08T00:00:00.000Z");
  const query = render(pruneRunsSql({ cutoff, keep: 200, limit: 5000, dryRun: false }));
  const flat = squash(query.sql);

  assert.match(flat, /row_number\(\) over \(partition by r\."workflowId" order by r\."startedAt" desc, r\."id" desc\)/);
  assert.match(flat, /ranked\."status" in \(\$1, \$2, \$3\)/);
  assert.deepEqual(query.params.slice(0, 3), ["succeeded", "failed", "cancelled"]);
  assert.match(flat, /ranked\."finishedAt" < \$4::timestamptz or ranked\."rank" > \$5/);
  assert.deepEqual(query.params.slice(3, 6), [cutoff.toISOString(), 200, 5000]);
  assert.match(flat, /order by ranked\."finishedAt" asc limit \$6/);
  assert.match(flat, /delete from "run" where "run"\."id" in \(select d\."id" from doomed d\)/);
  // Every workspace, unless narrowed.
  assert.doesNotMatch(flat, /"workspaceId" =/);
  // One statement.
  assert.equal(flat.includes(";"), false);
});

test("a dry run is the same rule and deletes nothing", () => {
  const options = { cutoff: new Date("2026-09-08T00:00:00.000Z"), keep: 200, limit: 5000 };
  const dry = squash(render(pruneRunsSql({ ...options, dryRun: true })).sql);
  const real = squash(render(pruneRunsSql({ ...options, dryRun: false })).sql);

  assert.doesNotMatch(dry, /delete/);
  // Up to the point where one deletes, the two statements are the same text: one rule.
  const rule = (text: string) => text.slice(0, text.indexOf("limit $6") + "limit $6".length);
  assert.equal(rule(dry), rule(real));
});

test("narrowed to a workspace, it cannot reach another one's runs", () => {
  const query = render(
    pruneRunsSql({ cutoff: new Date(), keep: 200, limit: 5000, dryRun: true, workspaceId: "ws-throwaway", withIds: true }),
  );
  const flat = squash(query.sql);
  assert.match(flat, /from "run" r where r\."workspaceId" = \$1/);
  assert.equal(query.params[0], "ws-throwaway");
  assert.match(flat, /json_agg\(d\."id"\)/);
});
