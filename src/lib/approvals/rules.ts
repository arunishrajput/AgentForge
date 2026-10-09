import { atLeast, type WorkspaceRole } from "@/lib/workspace/roles";

/**
 * **Human approval — Phase 38, `CONTRACT.md` → *Approvals*.** The rules about an approval that need
 * no database: what an approval node asks for, who may decide it, what a decision hands on, and
 * what a timeout means. Pure and client-safe, so the canvas, the inbox and the decision page read
 * the same words the server writes — and each rule is asserted in a millisecond (`rules.test.ts`).
 *
 * An approval is a step that **asks a person and waits for the answer**. `core.approval` creates a
 * request, leaves by its **Ask** output at once — carrying the link, for whatever step the author
 * uses to send it — and the run finishes everything else it can and is put down as `waiting`. A
 * decision in the inbox, on the canvas or through the link wakes it, and it carries on out of
 * **Approved** or **Rejected**; nobody deciding before the timeout decides by the node's
 * `onTimeout`.
 */

/** The three outputs of `core.approval`. All static, so the registry draws them (D23). */
export const ASK_HANDLE = "ask";
export const APPROVED_HANDLE = "approved";
export const REJECTED_HANDLE = "rejected";

export const APPROVAL_TYPE = "core.approval";

/**
 * An approval's life. `pending` until somebody decides; `approved` and `rejected` by a person or
 * by a timeout set to decide that way; `expired` when the timeout was set to fail the run; `void`
 * when its run finished — failed, cancelled — before anybody decided. Only `pending` can change.
 */
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "void"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** How a decision was made: by a member in the product, by whoever held the link, or by the clock. */
export const DECISION_VIA = ["member", "link", "timeout"] as const;
export type DecisionVia = (typeof DECISION_VIA)[number];

/** What a timeout does when nobody decided. `reject` is the default: no answer is not a yes. */
export const TIMEOUT_OUTCOMES = ["reject", "approve", "fail"] as const;
export type TimeoutOutcome = (typeof TIMEOUT_OUTCOMES)[number];

export const TIMEOUT_UNITS = ["minutes", "hours", "days"] as const;
export type TimeoutUnit = (typeof TIMEOUT_UNITS)[number];

const UNIT_MS: Record<TimeoutUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

/** The shortest timeout. Below a minute nobody could have read the request, let alone decided. */
export const MIN_TIMEOUT_MS = 60_000;

/** The longest — the same 30 days a run may wait at all (`MAX_WAIT_MS`, D16's family). */
export const MAX_TIMEOUT_MS = 30 * 86_400_000;

/** How many named approvers one node may list. A longer list is a group, which is what "editors" is. */
export const MAX_APPROVERS = 20;

/** The longest message a request carries — shown in the inbox, on the canvas and on the link's page. */
export const MESSAGE_MAX = 2_000;

/** The longest comment a decider may leave. */
export const COMMENT_MAX = 1_000;

export function timeoutMs(config: { timeout?: number; timeoutUnit?: TimeoutUnit }): number {
  return (config.timeout ?? 1) * UNIT_MS[config.timeoutUnit ?? "days"];
}

/**
 * What `core.approval` asks the engine for — returned as `NodeOutcome.approval`. The engine records
 * it (`RunRecorder.requestApproval`), which mints the link; the node never sees the database.
 */
export interface ApprovalRequest {
  message: string;
  /** Lower-cased addresses of the members who may decide, or null for any editor and above. */
  approvers: string[] | null;
  /** When the timeout decides. ISO. */
  expiresAt: string;
  onTimeout: TimeoutOutcome;
}

/** What the engine is handed when it wakes a run whose approval has been decided. */
export interface ApprovalDecision {
  outcome: "approved" | "rejected" | "expired";
  via: DecisionVia;
  /** The member who decided. Null for a link — whoever held it — and for a timeout. */
  decidedBy: { name: string | null; email: string | null } | null;
  comment: string | null;
  decidedAt: string;
}

/** The approval step's output while it waits — what Ask hands on. `url` is the one secret in a run. */
export interface AskOutput {
  approvalId: string;
  message: string;
  url: string;
  expiresAt: string;
}

/** The approval step's output once decided — what Approved and Rejected hand on. */
export interface DecidedOutput {
  approvalId: string;
  decision: "approved" | "rejected";
  via: DecisionVia;
  decidedBy: { name: string | null; email: string | null } | null;
  comment: string | null;
  decidedAt: string;
  message: string;
}

/**
 * The step's output once its decision is in, built from what it handed Ask. `expired` is not a
 * decision anybody made — it fails the step — so it has no output.
 */
export function decidedOutput(asked: { approvalId: string; message: string }, decision: ApprovalDecision): DecidedOutput {
  if (decision.outcome === "expired") throw new Error("An expired approval fails its step; it has no output.");
  return {
    approvalId: asked.approvalId,
    decision: decision.outcome,
    via: decision.via,
    decidedBy: decision.decidedBy,
    comment: decision.comment,
    decidedAt: decision.decidedAt,
    message: asked.message,
  };
}

/**
 * **An approval step still waiting for its decision**, and what it handed Ask — the request's id, its
 * message and deadline (its link is removed from everything a run keeps). Null for any other step. The
 * run panel and a run's page render the request's card under such a step.
 */
export function askingOf(step: { nodeType: string; status: string; output: unknown }): {
  approvalId: string;
  message?: string;
  expiresAt?: string;
} | null {
  if (step.nodeType !== APPROVAL_TYPE || step.status !== "running") return null;
  const output = step.output as { approvalId?: unknown; message?: unknown; expiresAt?: unknown } | null;
  if (!output || typeof output.approvalId !== "string") return null;
  return {
    approvalId: output.approvalId,
    ...(typeof output.message === "string" ? { message: output.message } : {}),
    ...(typeof output.expiresAt === "string" ? { expiresAt: output.expiresAt } : {}),
  };
}

/** The status a timeout writes, by the node's `onTimeout`. */
export function timeoutStatus(onTimeout: TimeoutOutcome): Extract<ApprovalStatus, "approved" | "rejected" | "expired"> {
  return onTimeout === "approve" ? "approved" : onTimeout === "fail" ? "expired" : "rejected";
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * **Who may decide**, from the node's `approvers` field: empty means any editor and above (null),
 * otherwise a list of addresses separated by commas, semicolons or spaces. Lower-cased, de-duplicated
 * and capped. Answers the list, or the reason it cannot be one — read at run time, after `{{ }}`
 * resolution, and at save time for a literal.
 */
export function parseApprovers(text: string | null | undefined): { approvers: string[] | null } | { error: string } {
  const parts = (text ?? "")
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return { approvers: null };

  const bad = parts.find((part) => !EMAIL.test(part));
  if (bad) return { error: `"${bad}" is not an email address. List the addresses of the members who may decide, separated by commas, or leave it empty for any editor.` };

  const unique = [...new Set(parts)];
  if (unique.length > MAX_APPROVERS) {
    return { error: `At most ${MAX_APPROVERS} people can be named. Leave it empty to let any editor decide.` };
  }
  return { approvers: unique };
}

/**
 * **May this member decide this approval?** Named approvers are exactly who may — whatever their
 * role, a viewer included, because the author chose them by name. With nobody named, any editor and
 * above. A link is not a member and is never asked this: holding it is the authority (D178).
 *
 * Visibility (D101) is not here — the caller has already read the approval through a query that
 * applies it, so a member who cannot see the workflow never reaches this question.
 */
export function mayDecide(member: { role: WorkspaceRole; email: string | null }, approvers: readonly string[] | null): boolean {
  if (approvers === null) return atLeast(member.role, "editor");
  return member.email !== null && approvers.includes(member.email.trim().toLowerCase());
}

/** "any editor", or "ada@example.com and 2 others" — who the request is waiting on, for a person. */
export function approversWords(approvers: readonly string[] | null): string {
  if (approvers === null || approvers.length === 0) return "any editor";
  if (approvers.length === 1) return approvers[0];
  return `${approvers[0]} and ${approvers.length - 1} other${approvers.length === 2 ? "" : "s"}`;
}

/** "Approved by Ada", "Rejected through the link", "Rejected when nobody decided in time". */
export function decisionWords(decision: {
  status: ApprovalStatus;
  via: DecisionVia | null;
  decidedBy?: { name: string | null; email: string | null } | null;
}): string {
  switch (decision.status) {
    case "pending":
      return "Waiting for a decision";
    case "void":
      return "Closed — the run stopped before anybody decided";
    case "expired":
      return "Expired — nobody decided in time";
  }
  const verb = decision.status === "approved" ? "Approved" : "Rejected";
  if (decision.via === "timeout") return `${verb} when nobody decided in time`;
  if (decision.via === "link") return `${verb} through the link`;
  const who = decision.decidedBy?.name || decision.decidedBy?.email;
  return who ? `${verb} by ${who}` : verb;
}
