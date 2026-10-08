import { sql, type SQL } from "drizzle-orm";

import type { TagSummary } from "./tags";

/**
 * **The library's SQL that drizzle's builder cannot say — written out, every name qualified**
 * (Phase 32).
 *
 * Two of these are correlated subqueries inside the workflow list's `select`, and that is
 * exactly where interpolating a column is a trap: **drizzle renders `${column}` unqualified in a
 * select list**, so `${workflowTags.workflowId} = ${workflows.id}` came out as
 * `"workflowId" = "id"` — and inside a subquery over `tag`, the nearest `"id"` is the *tag's*.
 * The tags of every workflow read back empty, while the star beside it worked only because
 * `workflow_star` happens to have no `id` column of its own. Found by `verify-api.mjs` against a
 * local build, before it shipped. So the identifiers here are literal and aliased, and
 * `library-sql.test.ts` renders each fragment and checks every reference names its table.
 *
 * Kept in a module that imports no database, so that test can run.
 */

/** The tags a listed workflow wears, as `[{ id, name }]` — `[]` when it wears none. */
export function workflowTagsJson(): SQL<TagSummary[]> {
  return sql<TagSummary[]>`coalesce((
    select json_agg(json_build_object('id', t."id", 'name', t."name"))
    from "workflow_tag" wt
    join "tag" t on t."id" = wt."tagId"
    where wt."workflowId" = "workflow"."id"
  ), '[]'::json)`;
}

/** Whether this person has starred the listed workflow. */
export function starredBy(userId: string): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "workflow_star" s
    where s."workflowId" = "workflow"."id" and s."userId" = ${userId}
  )`;
}

/**
 * Replace the tags a workflow wears with `tagIds`, in **one statement** — so the set is never
 * half written (D6: no transaction). The tags are selected through the workspace, so an id from
 * another workspace matches nothing and is never inserted. Answers the set it ended with.
 */
export function replaceWorkflowTags(input: {
  workflowId: string;
  workspaceId: string;
  tagIds: readonly string[];
}): SQL<{ tags: TagSummary[] }> {
  // `in ()` is not SQL, so an empty set is `false`: nothing wanted, everything removed.
  const wanted = input.tagIds.length > 0 ? sql`t."id" in ${[...input.tagIds]}` : sql`false`;
  return sql`
    with wanted as (
      select t."id", t."name" from "tag" t
      where ${wanted} and t."workspaceId" = ${input.workspaceId}
    ), removed as (
      delete from "workflow_tag" wt
      where wt."workflowId" = ${input.workflowId}
        and wt."tagId" not in (select w."id" from wanted w)
    ), added as (
      insert into "workflow_tag" ("workflowId", "tagId")
      select ${input.workflowId}, w."id" from wanted w
      on conflict do nothing
    )
    select coalesce(json_agg(json_build_object('id', w."id", 'name', w."name")), '[]'::json) as tags
    from wanted w
  `;
}

/** Give one workflow the tags another wears — a duplicate's. Both are in one workspace. */
export function copyTags(input: { fromWorkflowId: string; toWorkflowId: string }): SQL {
  return sql`
    insert into "workflow_tag" ("workflowId", "tagId")
    select ${input.toWorkflowId}, wt."tagId" from "workflow_tag" wt
    where wt."workflowId" = ${input.fromWorkflowId}
    on conflict do nothing
  `;
}
