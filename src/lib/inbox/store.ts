import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { inboxItems } from "@/db/schema";
import { pendingFor, type PendingApproval } from "@/lib/approvals/store";
import { RUN_RETENTION_DAYS } from "@/lib/runs/retention";
import { atLeast } from "@/lib/workspace/roles";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { DETAIL_MAX, readInboxSql, recordFailureSql, type InboxRow } from "./inbox-sql";
import type { InboxKind } from "./kinds";

/**
 * **The in-app inbox — Phase 37, `CONTRACT.md` → *The inbox* (D177).**
 *
 * The zero-cost answer to "a mail provider": somebody hears that a workflow failed with nobody
 * watching, inside the product, at no cost the database was not already paying.
 *
 *  - **Written in the failure's own path** — `engine/run.ts` → `announceFailure`, after the
 *    statement that finished the run, so the database is awake already
 *  - **Read when a page loads**, by the header, in one statement — **never polled**. A failure that
 *    happens while somebody is reading a page is in the bell on their next navigation, which is
 *    exactly what `/runs` and `/workflows` already do with their own data
 *  - **Pruned by the daily sweep** at the run-retention age, and taken with its run before that
 *    (`runId` cascades)
 */

/** How many entries the bell shows. The count above it is all of them. */
export const INBOX_PAGE = 12;

export interface InboxEntry {
  id: string;
  kind: InboxKind;
  workflowId: string;
  workflowName: string;
  runId: string | null;
  detail: string | null;
  /** How many failures this entry stands for — more than one while it waited unread. */
  count: number;
  createdAt: string;
  read: boolean;
}

export interface Inbox {
  unread: number;
  entries: InboxEntry[];
  /**
   * **Phase 38 — requests waiting on this reader to decide** (D180). Not entries: read live from the
   * approval table, so they have no read or unread of their own and leave every inbox the moment
   * anybody decides them. Newest first; `pending` counts them all, not only the ones listed.
   */
  pending: number;
  approvals: PendingApproval[];
}

export const EMPTY_INBOX: Inbox = { unread: 0, entries: [], pending: 0, approvals: [] };

const iso = (value: string | Date) => (typeof value === "string" ? new Date(value) : value).toISOString();

export function describeEntry(row: InboxRow): InboxEntry {
  return {
    id: row.id,
    kind: row.kind,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    runId: row.runId,
    detail: row.detail,
    count: Number(row.count),
    createdAt: iso(row.createdAt),
    read: row.readAt !== null,
  };
}

/** A failure's words, bounded for an entry: one line, never a payload. */
export function entryDetail(error: string | null): string | null {
  if (error === null) return null;
  const line = error.replace(/\s+/g, " ").trim();
  return line.length <= DETAIL_MAX ? line : `${line.slice(0, DETAIL_MAX - 1)}…`;
}

/** Tell everybody who may see the workflow that this run failed. Answers how many were told. */
export async function recordFailure(input: {
  workspaceId: string;
  workflowId: string;
  runId: string;
  error: string | null;
}): Promise<number> {
  const result = await db().execute<{ userId: string }>(
    recordFailureSql({
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      runId: input.runId,
      detail: entryDetail(input.error),
    }),
  );
  return result.rows.length;
}

/**
 * The reader's newest entries in their active workspace, how many are unread — and, since Phase 38,
 * the approval requests waiting on them. Two statements, side by side, on the page load that already
 * woke the database.
 */
export async function readInbox(scope: WorkspaceScope, limit = INBOX_PAGE): Promise<Inbox> {
  const [result, waiting] = await Promise.all([
    db().execute<InboxRow>(
      readInboxSql({
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        admin: atLeast(scope.role, "admin"),
        limit,
      }),
    ),
    pendingFor(scope, limit),
  ]);
  const rows = result.rows;
  return {
    unread: rows[0] ? Number(rows[0].unread) : 0,
    entries: rows.map(describeEntry),
    pending: waiting.pending,
    approvals: waiting.approvals,
  };
}

/**
 * Mark the reader's own entries read — the ones named, or all of them. Scoped to the person and
 * the workspace in the `where`, so an id that is somebody else's matches nothing and says nothing.
 * Answers how many changed.
 */
export async function markRead(scope: WorkspaceScope, which: { ids: readonly string[] } | { all: true }): Promise<number> {
  if ("ids" in which && which.ids.length === 0) return 0;
  const rows = await db()
    .update(inboxItems)
    .set({ readAt: sql`now()` as unknown as Date })
    .where(
      and(
        eq(inboxItems.userId, scope.userId),
        eq(inboxItems.workspaceId, scope.workspaceId),
        isNull(inboxItems.readAt),
        ...("ids" in which ? [inArray(inboxItems.id, [...which.ids])] : []),
      ),
    )
    .returning({ id: inboxItems.id });
  return rows.length;
}

/** The daily sweep's prune: entries older than run history is kept. One indexed delete. */
export async function pruneInbox(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RUN_RETENTION_DAYS * 86_400_000);
  const rows = await db()
    .delete(inboxItems)
    .where(lt(inboxItems.createdAt, cutoff))
    .returning({ id: inboxItems.id });
  return rows.length;
}
