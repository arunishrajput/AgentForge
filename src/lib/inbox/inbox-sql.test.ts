import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { readInboxSql, recordFailureSql } from "./inbox-sql";
import { describeEntry, entryDetail } from "./store";

const dialect = new PgDialect();
const render = (fragment: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(fragment);
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * **The inbox's statements — Phase 37, D177.** They were planned against the real database with
 * `EXPLAIN` while being written (the conflict arbiter is `inbox_item_unread_idx`); these hold what
 * they say, so a later edit cannot quietly change who is told or who reads.
 */

test("a failure reaches exactly the members who may see the workflow — canSeeWorkflow's rule, read in the statement", () => {
  const { sql: text, params } = render(
    recordFailureSql({ workspaceId: "ws-1", workflowId: "wf-1", runId: "run-1", detail: "Post to Slack: 403" }),
  );
  const flat = squash(text);
  // Members of the workflow's own workspace only.
  assert.match(flat, /join "workflow" w on w\."id" = \$\d+ and w\."workspaceId" = m\."workspaceId"/);
  assert.match(flat, /where m\."workspaceId" = \$\d+/);
  // Visibility from the row, not from the caller: shared → everybody; private → creator, admins, owners.
  assert.match(flat, /w\."visibility" <> 'private' or m\."userId" = w\."ownerId" or m\."role" in \('admin', 'owner'\)/);
  // Every value a parameter, never spliced into the text.
  assert.ok(params.includes("ws-1") && params.includes("wf-1") && params.includes("run-1"));
  assert.ok(params.includes("Post to Slack: 403"));
  assert.doesNotMatch(flat, /Post to Slack/);
});

test("a second failure while the first is unread updates the reader's entry instead of adding one", () => {
  const flat = squash(render(recordFailureSql({ workspaceId: "w", workflowId: "f", runId: "r", detail: null })).sql);
  assert.match(flat, /on conflict \("userId", "workflowId", "kind"\) where "readAt" is null do update set/);
  assert.match(flat, /"count" = "inbox_item"\."count" \+ 1/);
  assert.match(flat, /"runId" = excluded\."runId"/);
  assert.match(flat, /"createdAt" = excluded\."createdAt"/);
});

test("the reader reads only their own entries, in their active workspace, for workflows they can still see", () => {
  const member = render(readInboxSql({ userId: "u-1", workspaceId: "ws-1", admin: false, limit: 12 }));
  const flat = squash(member.sql);
  assert.match(flat, /i\."userId" = \$\d+ and i\."workspaceId" = \$\d+/);
  assert.match(flat, /w\."visibility" <> 'private' or w\."ownerId" = \$\d+/);
  assert.match(flat, /order by m\."createdAt" desc, m\."id" desc limit \$\d+/);
  // The bell's number counts every unread entry, not only the page shown.
  assert.match(flat, /\(select count\(\*\)::int from mine u where u\."readAt" is null\) as "unread"/);

  // An admin sees every workflow, so the filter is not there to fail.
  const admin = squash(render(readInboxSql({ userId: "u-1", workspaceId: "ws-1", admin: true, limit: 12 })).sql);
  assert.doesNotMatch(admin, /visibility/);
});

test("an entry keeps one line of the error, bounded — never a payload", () => {
  assert.equal(entryDetail(null), null);
  assert.equal(entryDetail("Post to Slack:\n  403   Forbidden"), "Post to Slack: 403 Forbidden");
  const long = entryDetail("x".repeat(2_000))!;
  assert.equal(long.length, 500);
  assert.ok(long.endsWith("…"));
});

test("a row from the driver becomes an entry with ISO times and a read flag", () => {
  const entry = describeEntry({
    id: "i-1",
    kind: "run_failed",
    workflowId: "wf-1",
    workflowName: "Invoice sync",
    runId: "run-1",
    detail: "boom",
    count: 3,
    createdAt: "2026-10-09 08:00:00.123+00",
    readAt: null,
    unread: 1,
  });
  assert.equal(entry.createdAt, "2026-10-09T08:00:00.123Z");
  assert.equal(entry.read, false);
  assert.equal(entry.count, 3);
});
