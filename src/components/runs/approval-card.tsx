"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { approversWords, COMMENT_MAX, decisionWords } from "@/lib/approvals/rules";
import { api, ApiRequestError, type MemberApprovalView } from "@/lib/canvas/client";
import { formatUtc } from "@/lib/triggers/cron";

/**
 * **A request for a decision, under the step that asked it — Phase 38** (`DESIGN.md` → *Approvals*).
 * The run panel on the canvas and a run's own page render it beneath an approval step that is still
 * waiting. It reads the request once when it is shown — never polled — and says what is asked, who it
 * waits on and until when; to a member who may decide, it offers Approve and Reject with an optional
 * comment. A member who may not is told so in words, never shown buttons that would refuse them.
 *
 * The quiet register: it lives inside a log, so a field and two buttons and no fills of its own beyond
 * the primary action's.
 */
export function ApprovalCard({
  approvalId,
  asked,
  onDecided,
}: {
  approvalId: string;
  /** What the step handed Ask — shown at once, before the request is read. */
  asked: { message?: string; expiresAt?: string };
  /** The decision landed: the run is being woken. The canvas follows it from here. */
  onDecided?: (view: MemberApprovalView) => void;
}) {
  const commentId = useId();
  const [view, setView] = useState<MemberApprovalView | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.approval(approvalId).then(
      (found) => live && setView(found),
      // Unreadable is not worth an error here: the step still says what it asked.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [approvalId]);

  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError(null);
    try {
      const next = await api.decideApproval(approvalId, decision, comment);
      setView(next);
      onDecided?.(next);
    } catch (failure) {
      setError(failure instanceof ApiRequestError ? failure.message : "The decision could not be sent. Try again.");
      // A 409 means it changed under us — read what it is now.
      api.approval(approvalId).then(setView, () => {});
    } finally {
      setBusy(null);
    }
  };

  const message = view?.message ?? asked.message ?? "";
  const expiresAt = view?.expiresAt ?? asked.expiresAt ?? null;
  const otherwise = view?.onTimeout === "fail" ? "the run fails" : view?.onTimeout === "approve" ? "it approves" : "it rejects";

  return (
    <section aria-label="Approval request" className="border-line-soft space-y-2 border-t px-2.5 py-2.5">
      <p className="eyebrow">{view && !view.open ? "Decision" : "Waiting for a decision"}</p>
      {message && <p className="text-ink text-xs leading-relaxed break-words whitespace-pre-wrap">{message}</p>}

      {(!view || view.open) && (
        <p className="text-muted text-2xs leading-relaxed">
          {view ? `Waiting on ${approversWords(view.approvers)}` : "Waiting"}
          {expiresAt && <> · decide by {formatUtc(expiresAt)}</>}
          {view && <> · if nobody does, {otherwise}</>}
        </p>
      )}

      {view && !view.open && (
        <p className="text-ink text-xs font-semibold">
          {decisionWords(view)}
          {view.comment && <span className="text-muted font-normal"> — “{view.comment}”</span>}
        </p>
      )}

      {view?.open && view.canDecide && (
        <div className="space-y-2">
          <label htmlFor={commentId} className="text-ui block font-medium">
            Comment <span className="text-muted text-2xs font-normal">(optional)</span>
          </label>
          <textarea
            id={commentId}
            rows={2}
            maxLength={COMMENT_MAX}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="field text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" tone="primary" loading={busy === "approve"} disabled={busy !== null && busy !== "approve"} onClick={() => decide("approve")}>
              <span aria-hidden="true">✓</span>
              Approve
            </Button>
            <Button size="sm" loading={busy === "reject"} disabled={busy !== null && busy !== "reject"} onClick={() => decide("reject")}>
              <span aria-hidden="true">✕</span>
              Reject
            </Button>
          </div>
        </div>
      )}

      {view?.open && !view.canDecide && (
        <p className="text-muted text-2xs">
          {view.approvers === null
            ? "An editor, an admin or an owner decides this one — not a viewer."
            : "Only the people it names can decide this one."}
        </p>
      )}

      {error && (
        <p role="alert" className={cn("text-bad text-2xs font-semibold")}>
          {error}
        </p>
      )}
    </section>
  );
}
