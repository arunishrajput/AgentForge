import { sql, type SQL } from "drizzle-orm";

import type { ApprovalStatus, DecisionVia } from "./rules";

/**
 * **The approval statements whose predicates carry the rules — written out, every name qualified**
 * (Phase 38). The library's lesson (`workflow/library-sql.ts`): drizzle renders an interpolated
 * column unqualified, which inside a subquery binds to the wrong table. So identifiers here are
 * literal and aliased, and `approvals-sql.test.ts` renders each statement and checks what it says.
 *
 * Kept in a module that imports no database, so that test can run.
 */

/** The run statuses in which a decision can still change anything. */
const LIVE_RUN = sql.raw(`('queued', 'running', 'waiting')`);

/**
 * **Decide a request — one compare-and-set.** It lands only while the request is `pending`, its
 * timeout has not passed (the database's clock, never a container's), and **its run is still going**:
 * a request whose run failed or was cancelled cannot be decided whatever its own row says, so a link
 * outliving its run is dead without anybody having to close it. Answers the request it decided, or
 * nothing — the caller cannot tell "already decided" from "never existed" from this, and does not
 * need to.
 *
 * `key` is the request's id (a member deciding) or its token's hash (a link).
 */
export function decideSql(input: {
  key: { id: string } | { tokenHash: string };
  status: Extract<ApprovalStatus, "approved" | "rejected">;
  via: Extract<DecisionVia, "member" | "link">;
  decidedBy: string | null;
  comment: string | null;
}): SQL<{ id: string; runId: string; workflowId: string; workspaceId: string; status: ApprovalStatus }> {
  const match = "id" in input.key ? sql`a."id" = ${input.key.id}` : sql`a."tokenHash" = ${input.key.tokenHash}`;
  return sql`
    update "approval" a
    set "status" = ${input.status}, "via" = ${input.via}, "decidedBy" = ${input.decidedBy},
        "comment" = ${input.comment}, "decidedAt" = now()
    where ${match}
      and a."status" = 'pending'
      and a."expiresAt" > now()
      and exists (select 1 from "run" r where r."id" = a."runId" and r."status" in ${LIVE_RUN})
    returning a."id", a."runId", a."workflowId", a."workspaceId", a."status"
  `;
}

/**
 * **The timeout decides — one compare-and-set**, by the request's own `onTimeout`, and only once the
 * timeout has passed. Made by the worker that claimed the waiting run at its wake time; a request a
 * person decided first matches nothing, and the caller reads that decision instead.
 */
export function timeoutSql(approvalId: string): SQL<{ id: string }> {
  return sql`
    update "approval" a
    set "status" = case a."onTimeout" when 'approve' then 'approved' when 'fail' then 'expired' else 'rejected' end,
        "via" = 'timeout', "decidedAt" = now()
    where a."id" = ${approvalId} and a."status" = 'pending' and a."expiresAt" <= now()
    returning a."id"
  `;
}

/** A pending request one reader may decide, as their inbox shows it. */
export type PendingRow = {
  id: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  message: string;
  expiresAt: string | Date;
  createdAt: string | Date;
  /** Every request the reader may decide, not only the ones in this page — the bell's number. */
  pending: number;
};

/**
 * **The requests waiting on one reader, in one workspace — one statement** (D180). Read live, never
 * written per reader: a request is a to-do whose state is its decision, so it has no read or unread of
 * its own, and a decision takes it out of every inbox at once.
 *
 * Waiting on them means: pending, not past its timeout, its run still going, its workflow visible to
 * them (D101's rule, applied in the `where` — an admin sees every workflow), and they may decide it —
 * **named**, by their address, or with nobody named, an editor or above (`mayDecide`, `rules.ts`).
 */
export function pendingForReaderSql(input: {
  userId: string;
  workspaceId: string;
  admin: boolean;
  editor: boolean;
  limit: number;
}): SQL<PendingRow> {
  const visible = input.admin ? sql`true` : sql`(w."visibility" <> 'private' or w."ownerId" = ${input.userId})`;
  const unnamed = input.editor ? sql`a."approvers" is null` : sql`false`;
  return sql<PendingRow>`
    select a."id", a."workflowId", w."name" as "workflowName", a."runId", a."message", a."expiresAt", a."createdAt",
           (count(*) over ())::int as "pending"
    from "approval" a
    join "workflow" w on w."id" = a."workflowId"
    join "run" r on r."id" = a."runId"
    join "user" u on u."id" = ${input.userId}
    where a."workspaceId" = ${input.workspaceId}
      and a."status" = 'pending'
      and a."expiresAt" > now()
      and r."status" in ${LIVE_RUN}
      and ${visible}
      and (${unnamed} or a."approvers" @> jsonb_build_array(lower(u."email")))
    order by a."createdAt" desc, a."id" desc
    limit ${input.limit}
  `;
}

/** One request as its own page and the canvas read it. */
export type ApprovalRow = {
  id: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeId: string;
  seq: number;
  message: string;
  approvers: string[] | null;
  status: ApprovalStatus;
  onTimeout: string;
  expiresAt: string | Date;
  via: DecisionVia | null;
  comment: string | null;
  decidedAt: string | Date | null;
  deciderName: string | null;
  deciderEmail: string | null;
  /** Whether it can still be decided: pending, not past its timeout, and its run still going. */
  open: boolean;
  /** The reader's own address, for `mayDecide`. Null on the link's page, which has no reader. */
  readerEmail: string | null;
};

const ROW = sql`
  a."id", a."workflowId", w."name" as "workflowName", a."runId", a."nodeId", a."seq", a."message", a."approvers",
  a."status", a."onTimeout", a."expiresAt", a."via", a."comment", a."decidedAt",
  d."name" as "deciderName", d."email" as "deciderEmail",
  (a."status" = 'pending' and a."expiresAt" > now() and r."status" in ${LIVE_RUN}) as "open"
`;

/**
 * **One request, for a member** — in their workspace and only if they can see its workflow (D101),
 * with their own address so the caller can answer `mayDecide` without a second read.
 */
export function approvalForMemberSql(input: {
  approvalId: string;
  userId: string;
  workspaceId: string;
  admin: boolean;
}): SQL<ApprovalRow> {
  const visible = input.admin ? sql`true` : sql`(w."visibility" <> 'private' or w."ownerId" = ${input.userId})`;
  return sql<ApprovalRow>`
    select ${ROW}, me."email" as "readerEmail"
    from "approval" a
    join "workflow" w on w."id" = a."workflowId"
    join "run" r on r."id" = a."runId"
    join "user" me on me."id" = ${input.userId}
    left join "user" d on d."id" = a."decidedBy"
    where a."id" = ${input.approvalId} and a."workspaceId" = ${input.workspaceId} and ${visible}
    limit 1
  `;
}

/** **One request, for whoever holds its link** — found by the token's hash and nothing else. */
export function approvalForLinkSql(tokenHash: string): SQL<ApprovalRow> {
  return sql<ApprovalRow>`
    select ${ROW}, null as "readerEmail"
    from "approval" a
    join "workflow" w on w."id" = a."workflowId"
    join "run" r on r."id" = a."runId"
    left join "user" d on d."id" = a."decidedBy"
    where a."tokenHash" = ${tokenHash}
    limit 1
  `;
}

/** **One request, as a resumed run reads its decision** — by id, with who decided it. */
export function approvalByIdSql(approvalId: string): SQL<ApprovalRow> {
  return sql<ApprovalRow>`
    select ${ROW}, null as "readerEmail"
    from "approval" a
    join "workflow" w on w."id" = a."workflowId"
    join "run" r on r."id" = a."runId"
    left join "user" d on d."id" = a."decidedBy"
    where a."id" = ${approvalId}
    limit 1
  `;
}
