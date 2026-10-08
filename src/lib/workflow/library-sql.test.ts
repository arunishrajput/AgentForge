import assert from "node:assert/strict";
import { test } from "node:test";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { PgDialect } from "drizzle-orm/pg-core";
import { neon } from "@neondatabase/serverless";

import { workflows } from "@/db/schema";

import { copyTags, replaceWorkflowTags, starredBy, workflowTagsJson } from "./library-sql";

const dialect = new PgDialect();
const render = (fragment: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(fragment);
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * **The bug this module exists for**, kept as a test: in a select list, drizzle renders an
 * interpolated column unqualified. The list query as first written correlated its subquery as
 * `"workflowId" = "id"`, which bound `"id"` to the tag, and every workflow's tags read back empty.
 * This renders the list query the way the store builds it and checks the correlation names both
 * tables — it fails on the interpolated form.
 */
test("the list query's subqueries correlate to the outer workflow by qualified name", () => {
  // A client that never connects: only the SQL text is wanted.
  const db = drizzle(neon("postgres://user:pass@localhost/db"));
  const { sql: text } = db
    .select({ id: workflows.id, tags: workflowTagsJson(), starred: starredBy("user-1") })
    .from(workflows)
    .where(eq(workflows.workspaceId, "ws-1"))
    .toSQL();
  const flat = squash(text);

  assert.match(flat, /wt\."workflowId" = "workflow"\."id"/);
  assert.match(flat, /s\."workflowId" = "workflow"\."id"/);
  assert.match(flat, /t\."id" = wt\."tagId"/);
  // The interpolated form, which is the bug.
  assert.doesNotMatch(flat, /"workflowId" = "id"/);
  // The outer table really is unaliased, which is what makes `"workflow"."id"` resolve.
  assert.match(flat, /from "workflow" where/);
});

test("the star is the asker's: their id is a parameter, never spliced into the text", () => {
  const query = render(starredBy("user'); drop table tag; --"));
  assert.match(squash(query.sql), /s\."userId" = \$1/);
  assert.deepEqual(query.params, ["user'); drop table tag; --"]);
});

test("replacing a workflow's tags selects them through the workspace, in one statement", () => {
  const query = render(replaceWorkflowTags({ workflowId: "wf-1", workspaceId: "ws-1", tagIds: ["t1", "t2"] }));
  const flat = squash(query.sql);
  assert.match(flat, /t\."id" in \(\$1, \$2\) and t\."workspaceId" = \$3/);
  assert.match(flat, /delete from "workflow_tag" wt where wt\."workflowId" = \$4/);
  assert.match(flat, /insert into "workflow_tag" \("workflowId", "tagId"\) select \$5, w\."id" from wanted w on conflict do nothing/);
  assert.deepEqual(query.params, ["t1", "t2", "ws-1", "wf-1", "wf-1"]);
  // One statement: a single `with`, no statement separator.
  assert.equal((flat.match(/\bwith\b/g) ?? []).length, 1);
  assert.equal(flat.includes(";"), false);
});

test("an empty set wants nothing — `false`, never the invalid `in ()` — and so removes everything", () => {
  const flat = squash(render(replaceWorkflowTags({ workflowId: "wf-1", workspaceId: "ws-1", tagIds: [] })).sql);
  assert.match(flat, /where false and t\."workspaceId" = \$1/);
  assert.doesNotMatch(flat, /in \(\)/);
});

test("a duplicate's tags are copied from the original's rows, by parameter", () => {
  const query = render(copyTags({ fromWorkflowId: "wf-original", toWorkflowId: "wf-copy" }));
  assert.match(squash(query.sql), /select \$1, wt\."tagId" from "workflow_tag" wt where wt\."workflowId" = \$2/);
  assert.deepEqual(query.params, ["wf-copy", "wf-original"]);
});
