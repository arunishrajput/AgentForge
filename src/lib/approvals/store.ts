import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { approvals, runs } from "@/db/schema";
import { enqueueRun } from "@/lib/engine/queue";
import type { IssuedApproval } from "@/lib/engine/types";
import { required } from "@/lib/env";
import { logError, logInfo } from "@/lib/logging";
import { atLeast } from "@/lib/workspace/roles";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import {
  approvalByIdSql,
  approvalForLinkSql,
  approvalForMemberSql,
  decideSql,
  pendingForReaderSql,
  timeoutSql,
  type ApprovalRow,
  type PendingRow,
} from "./approvals-sql";
import {
  mayDecide,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalStatus,
  type DecisionVia,
} from "./rules";
import { approvalUrl, hashApprovalToken, mintApprovalToken } from "./token";

/**
 * **Approval requests — Phase 38**, `CONTRACT.md` → *Approvals* (D178–D182). Every statement an
 * approval makes, and the only module that touches the `approval` table.
 *
 * Nothing here wakes an idle database: a request is written by the run that asked (awake already), a
 * decision by a person pressing a button or opening a link, a timeout by the delivery that wakes the
 * run, and the inbox reads requests on the page load it already makes. Nothing polls.
 */

/* ------------------------------------------------------------------ *
 * The engine's side — through the run's recorder
 * ------------------------------------------------------------------ */

/**
 * **Record a request and mint its link.** An upsert on `(runId, nodeId, iteration)`: an attempt that
 * re-executes the same approval after a lost container gives the existing request a new token —
 * the old link was never sent, because the Ask path runs after the checkpoint that follows this.
 * A request already decided is never reopened; that answers no row and fails the step.
 */
export async function recordRequest(
  input: ApprovalRequest & {
    runId: string;
    workspaceId: string;
    workflowId: string;
    nodeId: string;
    iteration: number;
    seq: number;
  },
): Promise<IssuedApproval> {
  const token = mintApprovalToken();
  const tokenHash = hashApprovalToken(token);
  const [row] = await db()
    .insert(approvals)
    .values({
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      runId: input.runId,
      nodeId: input.nodeId,
      iteration: input.iteration,
      seq: input.seq,
      message: input.message,
      approvers: input.approvers,
      tokenHash,
      onTimeout: input.onTimeout,
      expiresAt: new Date(input.expiresAt),
    })
    .onConflictDoUpdate({
      target: [approvals.runId, approvals.nodeId, approvals.iteration],
      set: {
        tokenHash,
        seq: input.seq,
        message: input.message,
        approvers: input.approvers,
        onTimeout: input.onTimeout,
        expiresAt: new Date(input.expiresAt),
      },
      setWhere: eq(approvals.status, "pending"),
    })
    .returning({ id: approvals.id });

  if (!row) throw new Error("This approval was already decided in an earlier attempt of this run, and is not asked again.");

  logInfo("approval.requested", `Approval ${row.id} requested.`, {
    approvalId: row.id,
    nodeId: input.nodeId,
    iteration: input.iteration,
    named: input.approvers?.length ?? 0,
    onTimeout: input.onTimeout,
    expiresAt: input.expiresAt,
  });
  return { id: row.id, token, url: approvalUrl(required("APP_BASE_URL"), token) };
}

/** **A new link for a request still pending** — the old one stops working. Null once it is not. */
export async function reissueLink(approvalId: string): Promise<IssuedApproval | null> {
  const token = mintApprovalToken();
  const [row] = await db()
    .update(approvals)
    .set({ tokenHash: hashApprovalToken(token) })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning({ id: approvals.id });
  if (!row) return null;
  return { id: row.id, token, url: approvalUrl(required("APP_BASE_URL"), token) };
}

/**
 * **What a resumed run needs to know about its request** — its decision, or nothing yet. If the
 * timeout has passed with nobody deciding, the timeout decides first, by the request's `onTimeout`
 * (one compare-and-set; a person who decided a moment before wins). Then the row is read.
 */
export async function decisionFor(approvalId: string): Promise<ApprovalDecision | undefined> {
  const timedOut = await db().execute<{ id: string }>(timeoutSql(approvalId));
  const [row] = (await db().execute<ApprovalRow>(approvalByIdSql(approvalId))).rows;
  if (!row || row.status === "pending" || row.status === "void") return undefined;

  if (timedOut.rows.length > 0) {
    logInfo("approval.decided", `Approval ${approvalId} was decided by its timeout.`, {
      approvalId,
      status: row.status,
      via: "timeout",
    });
  }
  return {
    outcome: row.status,
    via: row.via ?? "timeout",
    decidedBy: row.via === "member" ? { name: row.deciderName, email: row.deciderEmail } : null,
    comment: row.comment,
    decidedAt: iso(row.decidedAt ?? new Date()),
  };
}

/**
 * **Close a run's requests that nobody decided** — its run finished without them. Their links stop
 * working the moment the run is over in any case (`decideSql` checks the run); this makes the row say
 * so, for the inbox and the canvas. Answers how many it closed.
 */
export async function closeRequests(runId: string): Promise<number> {
  const rows = await db()
    .update(approvals)
    .set({ status: "void" })
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")))
    .returning({ id: approvals.id });
  return rows.length;
}

/* ------------------------------------------------------------------ *
 * Deciding — a member, or a link
 * ------------------------------------------------------------------ */

export type DecideOutcome =
  | { decided: true; status: Extract<ApprovalStatus, "approved" | "rejected">; runId: string }
  | { decided: false };

/**
 * **Decide, then wake the run.** The decision is one compare-and-set (`decideSql`); waking is a
 * second statement — `wakeAt = now()` on the run if it is `waiting` — and a Cloud Tasks delivery for
 * now. If the run is not waiting yet — still sending the link down Ask — nothing is woken here: the
 * write that puts it down reads the decision in the same statement and wakes at once (`lease.ts` →
 * `suspendRun`). Between the two statements, every ordering wakes it exactly when it should.
 */
export async function decide(input: {
  key: { id: string } | { tokenHash: string };
  decision: "approved" | "rejected";
  via: Extract<DecisionVia, "member" | "link">;
  decidedBy: string | null;
  comment: string | null;
}): Promise<DecideOutcome> {
  const [row] = (
    await db().execute<{ id: string; runId: string; status: ApprovalStatus }>(
      decideSql({ key: input.key, status: input.decision, via: input.via, decidedBy: input.decidedBy, comment: input.comment }),
    )
  ).rows;
  if (!row) return { decided: false };

  logInfo("approval.decided", `Approval ${row.id} was ${input.decision}.`, {
    approvalId: row.id,
    runId: row.runId,
    status: input.decision,
    via: input.via,
    commented: input.comment !== null,
  });
  await wake(row.runId);
  return { decided: true, status: input.decision, runId: row.runId };
}

/** Wake a run that is waiting, now — a decision arrived. A run not waiting is left to its suspend. */
async function wake(runId: string): Promise<void> {
  const [row] = await db()
    .update(runs)
    .set({ wakeAt: sql`now()` as unknown as Date })
    .where(and(eq(runs.id, runId), eq(runs.status, "waiting")))
    .returning({ dispatchToken: runs.dispatchToken });
  if (!row?.dispatchToken) return;

  const result = await enqueueRun({
    runId,
    token: row.dispatchToken,
    baseUrl: required("APP_BASE_URL"),
    secret: required("CRON_SECRET"),
  });
  // Not a failed decision: the decision is recorded, and the daily sweep wakes a waiting run whose
  // wake time has passed (`triggers/tick.ts`). Loud, because until then nothing happens.
  if (!result.enqueued) {
    logError("queue.degraded", `Run ${runId} was decided but could not be woken.`, result.detail, { reason: result.reason });
  }
}

/* ------------------------------------------------------------------ *
 * Reading — the inbox, a member, a link
 * ------------------------------------------------------------------ */

/** A request as a member, the canvas, or the link's page sees it. */
export interface ApprovalView {
  id: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeId: string;
  seq: number;
  message: string;
  status: ApprovalStatus;
  /** Can still be decided: pending, not past its timeout, its run still going. */
  open: boolean;
  expiresAt: string;
  onTimeout: string;
  via: DecisionVia | null;
  decidedBy: { name: string | null; email: string | null } | null;
  comment: string | null;
  decidedAt: string | null;
}

export interface MemberApprovalView extends ApprovalView {
  /** Who it waits on — every address named, or null for any editor. Members may read it. */
  approvers: string[] | null;
  /** Whether *this* member may decide it now. */
  canDecide: boolean;
}

const iso = (value: string | Date) => (typeof value === "string" ? new Date(value) : value).toISOString();

export function describeApproval(row: ApprovalRow): ApprovalView {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    runId: row.runId,
    nodeId: row.nodeId,
    seq: Number(row.seq),
    message: row.message,
    status: row.status,
    open: row.open === true,
    expiresAt: iso(row.expiresAt),
    onTimeout: row.onTimeout,
    via: row.via,
    decidedBy: row.via === "member" ? { name: row.deciderName, email: row.deciderEmail } : null,
    comment: row.comment,
    decidedAt: row.decidedAt === null ? null : iso(row.decidedAt),
  };
}

/** One request, for a member who can see its workflow — 404 territory otherwise (null). */
export async function approvalForMember(scope: WorkspaceScope, approvalId: string): Promise<MemberApprovalView | null> {
  const [row] = (
    await db().execute<ApprovalRow>(
      approvalForMemberSql({
        approvalId,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        admin: atLeast(scope.role, "admin"),
      }),
    )
  ).rows;
  if (!row) return null;
  const view = describeApproval(row);
  return {
    ...view,
    approvers: row.approvers,
    canDecide: view.open && mayDecide({ role: scope.role, email: row.readerEmail }, row.approvers),
  };
}

/** One request, for whoever holds its link — found by the token's hash alone. */
export async function approvalForLink(token: string): Promise<ApprovalView | null> {
  const [row] = (await db().execute<ApprovalRow>(approvalForLinkSql(hashApprovalToken(token)))).rows;
  return row ? describeApproval(row) : null;
}

/** A request waiting on the reader, as the inbox lists it. */
export interface PendingApproval {
  id: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  message: string;
  expiresAt: string;
  createdAt: string;
}

export function describePending(row: PendingRow): PendingApproval {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    runId: row.runId,
    message: row.message,
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
  };
}

/** The requests waiting on the reader in their active workspace, newest first, and how many in all. */
export async function pendingFor(scope: WorkspaceScope, limit: number): Promise<{ pending: number; approvals: PendingApproval[] }> {
  const rows = (
    await db().execute<PendingRow>(
      pendingForReaderSql({
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        admin: atLeast(scope.role, "admin"),
        editor: atLeast(scope.role, "editor"),
        limit,
      }),
    )
  ).rows;
  return { pending: rows[0] ? Number(rows[0].pending) : 0, approvals: rows.map(describePending) };
}
