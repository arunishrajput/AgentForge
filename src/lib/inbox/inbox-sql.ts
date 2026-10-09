import { sql, type SQL } from "drizzle-orm";

import type { InboxKind } from "./kinds";

/**
 * **The inbox's two statements drizzle's builder cannot say — written out, every name qualified**
 * (Phase 37, D177). The library's rule (`workflow/library-sql.ts`): drizzle renders an interpolated
 * column unqualified in a select list, so identifiers here are literal and aliased, and
 * `inbox-sql.test.ts` renders each statement and checks what it says.
 *
 * Kept in a module that imports no database, so that test can run.
 */

/** The longest error an entry keeps — enough to say what went wrong, never a payload. */
export const DETAIL_MAX = 500;

/**
 * **Tell everybody who may see a workflow that its run failed** — one statement, in the failure's
 * own path (the run has already woken the database).
 *
 * Who: the workspace's members for whom the workflow is visible — **the same rule as
 * `canSeeWorkflow` (D101)**, read from the workflow row in this statement rather than handed in, so
 * a visibility changed a moment ago is the one applied: everybody for `workspace`, and for
 * `private` its creator and the workspace's admins and owners. A viewer is told too; they can read
 * the run.
 *
 * **Collapsed while unread**: a person with an unread entry for this workflow already has it
 * updated — one more failure counted, the newest run and error in, moved to the top — rather than
 * a second entry, by the partial unique index `inbox_item_unread_idx`. So a webhook that fails every
 * second is one row a reader, not a table. Answers the people it reached.
 */
export function recordFailureSql(input: {
  workspaceId: string;
  workflowId: string;
  runId: string;
  detail: string | null;
  kind?: InboxKind;
}): SQL<{ userId: string }> {
  const kind = input.kind ?? "run_failed";
  return sql<{ userId: string }>`
    insert into "inbox_item" ("id", "workspaceId", "userId", "kind", "workflowId", "runId", "detail", "count", "createdAt")
    select gen_random_uuid()::text, m."workspaceId", m."userId", ${kind}, w."id", ${input.runId}, ${input.detail}, 1, now()
    from "workspace_member" m
    join "workflow" w on w."id" = ${input.workflowId} and w."workspaceId" = m."workspaceId"
    where m."workspaceId" = ${input.workspaceId}
      and (w."visibility" <> 'private' or m."userId" = w."ownerId" or m."role" in ('admin', 'owner'))
    on conflict ("userId", "workflowId", "kind") where "readAt" is null
    do update set
      "count" = "inbox_item"."count" + 1,
      "runId" = excluded."runId",
      "detail" = excluded."detail",
      "createdAt" = excluded."createdAt"
    returning "userId"
  `;
}

/** One entry as the header reads it, with its workflow's name as it is now. */
export type InboxRow = {
  id: string;
  kind: InboxKind;
  workflowId: string;
  workflowName: string;
  runId: string | null;
  detail: string | null;
  count: number;
  createdAt: string | Date;
  readAt: string | Date | null;
  /** Every unread entry the reader has, not only the ones in this page — the bell's number. */
  unread: number;
};

/**
 * **One person's newest entries in one workspace, and how many are unread — one statement.**
 *
 * Visibility is applied again here, in the `where` (D101's rule: filtered, never checked after
 * the read): an entry written while a workflow was shared stops being shown the moment its creator
 * makes it private. `admin` is the reader's role at least admin, which sees every workflow.
 */
export function readInboxSql(input: {
  userId: string;
  workspaceId: string;
  admin: boolean;
  limit: number;
}): SQL<InboxRow> {
  const visible = input.admin ? sql`true` : sql`(w."visibility" <> 'private' or w."ownerId" = ${input.userId})`;
  return sql<InboxRow>`
    with mine as (
      select i."id", i."kind", i."workflowId", w."name" as "workflowName", i."runId", i."detail",
             i."count", i."createdAt", i."readAt"
      from "inbox_item" i
      join "workflow" w on w."id" = i."workflowId"
      where i."userId" = ${input.userId} and i."workspaceId" = ${input.workspaceId} and ${visible}
    )
    select m.*, (select count(*)::int from mine u where u."readAt" is null) as "unread"
    from mine m
    order by m."createdAt" desc, m."id" desc
    limit ${input.limit}
  `;
}
