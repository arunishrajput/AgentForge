"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { COMMENT_MAX } from "@/lib/approvals/rules";
import { formatUtc } from "@/lib/format/date";

/**
 * **Deciding an approval through its link — Phase 38** (`DESIGN.md` → *Approvals*, D178).
 *
 * Reads the token from the URL's fragment once, then **takes it out of the address bar** — out of the
 * history entry too, since `replaceState` rewrites the current one — so a screen shared or a
 * screenshot taken after the page loads shows a plain `/approve`. The token stays in this component's
 * memory for the one POST that decides. Reloading the page therefore loses it; the message says to
 * open the link again, which is what anybody would do.
 *
 * Six states, all designed: reading, no token, not a link at all, no longer open, open, and decided —
 * and a request that fails says so without guessing. The open state says the one thing a stranger
 * needs to know before pressing anything: **whoever has this link can decide, once.**
 */
type State =
  | { kind: "reading" }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "closed" }
  | { kind: "open"; workflowName: string; message: string; expiresAt: string }
  | { kind: "decided"; status: "approved" | "rejected" }
  | { kind: "failed"; message: string };

async function post<T>(path: string, body: unknown): Promise<{ status: number; data?: T; message?: string }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // The page's own address carries no token, but nothing here needs to say where it came from.
    referrerPolicy: "no-referrer",
  });
  const json = (await response.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  return { status: response.status, data: json?.data, message: json?.error?.message };
}

export function DecideApproval() {
  const token = useRef<string | null>(null);
  const commentId = useId();
  const [state, setState] = useState<State>({ kind: "reading" });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Once, even under Strict Mode's second effect: the ref survives it, the fragment does not.
    if (token.current === null) {
      token.current = window.location.hash.slice(1);
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    }
    const held = token.current;
    if (!held) {
      setState({ kind: "missing" });
      return;
    }
    let live = true;
    const read = async () => {
      let next: State;
      try {
        const answer = await post<{ state: "open" | "closed"; workflowName?: string; message?: string; expiresAt?: string }>(
          "/api/approve/describe",
          { token: held },
        );
        const data = answer.data;
        if (answer.status === 400 || answer.status === 404) next = { kind: "invalid" };
        else if (answer.status !== 200 || !data) {
          next = { kind: "failed", message: answer.message ?? "The request could not be read. Try again in a moment." };
        } else if (data.state === "open") {
          next = { kind: "open", workflowName: data.workflowName ?? "A workflow", message: data.message ?? "", expiresAt: data.expiresAt ?? "" };
        } else next = { kind: "closed" };
      } catch {
        next = { kind: "failed", message: "Could not reach AgentForge. Check your connection and try again." };
      }
      if (live) setState(next);
    };
    void read();
    return () => {
      live = false;
    };
  }, []);

  const decide = async (decision: "approve" | "reject") => {
    if (!token.current) return;
    setBusy(decision);
    setError(null);
    try {
      const answer = await post<{ status: "approved" | "rejected" }>("/api/approve/decide", {
        token: token.current,
        decision,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      if (answer.status === 200 && answer.data) setState({ kind: "decided", status: answer.data.status });
      else if (answer.status === 409) setState({ kind: "closed" });
      else if (answer.status === 404) setState({ kind: "invalid" });
      else setError(answer.message ?? "The decision could not be sent. Try again.");
    } catch {
      setError("Could not reach AgentForge. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  if (state.kind === "reading") {
    return (
      <Card raised className="p-6" aria-busy="true">
        <p className="text-muted text-sm">Reading the request…</p>
      </Card>
    );
  }

  if (state.kind === "open") {
    return (
      <Card raised className="animate-rise p-6">
        <Badge tone="outline" icon="◷">
          Approval needed
        </Badge>
        <h1 className="mt-3 text-xl font-bold tracking-tight text-pretty">{state.workflowName} asks for a decision</h1>
        {state.message && (
          <p className="border-line bg-sunken text-ink mt-4 rounded-lg border-2 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {state.message}
          </p>
        )}
        <p className="text-muted mt-3 text-2xs text-pretty">
          {state.expiresAt && <>Open until {formatUtc(state.expiresAt)}. </>}
          Whoever has this link can decide, once — no sign-in needed. The workflow carries on with your answer.
        </p>

        <label htmlFor={commentId} className="text-ui mt-5 block font-semibold">
          Comment <span className="text-muted text-2xs font-normal">(optional — the workflow can read it)</span>
        </label>
        <textarea
          id={commentId}
          rows={3}
          maxLength={COMMENT_MAX}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="field mt-1.5"
        />

        {error && (
          <Notice tone="bad" title={error} className="mt-4" />
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button size="lg" tone="primary" loading={busy === "approve"} disabled={busy === "reject"} onClick={() => decide("approve")}>
            <span aria-hidden="true">✓</span>
            Approve
          </Button>
          <Button size="lg" loading={busy === "reject"} disabled={busy === "approve"} onClick={() => decide("reject")}>
            <span aria-hidden="true">✕</span>
            Reject
          </Button>
        </div>
      </Card>
    );
  }

  const ended: Record<Exclude<State["kind"], "reading" | "open">, { title: string; body: string; badge?: string }> = {
    decided: {
      title: state.kind === "decided" && state.status === "rejected" ? "Rejected" : "Approved",
      body:
        state.kind === "decided" && state.status === "rejected"
          ? "Thank you — the workflow carries on down its Rejected path. You can close this page."
          : "Thank you — the workflow carries on down its Approved path. You can close this page.",
      badge: state.kind === "decided" && state.status === "rejected" ? "✕" : "✓",
    },
    closed: {
      title: "This request is no longer open",
      body: "It was decided, its time ran out, or the run that asked it stopped. There is nothing more to do here.",
    },
    invalid: {
      title: "This approval link is not valid",
      body: "Check that you opened the whole link from the message you were sent. A link only works for the request it was made for.",
    },
    missing: {
      title: "Open the link you were sent",
      body: "This page decides an approval, and needs the link from the message that asked you. If you reloaded it, open that link again.",
    },
    failed: { title: "Something went wrong", body: state.kind === "failed" ? state.message : "" },
  };
  const shown = ended[state.kind];

  return (
    <Card raised className="animate-rise p-6">
      {shown.badge && (
        <Badge tone="outline" icon={shown.badge}>
          Decided
        </Badge>
      )}
      <h1 className={shown.badge ? "mt-3 text-xl font-bold tracking-tight" : "text-xl font-bold tracking-tight"}>{shown.title}</h1>
      <p className="text-muted mt-2 text-sm text-pretty" role={state.kind === "failed" ? "alert" : undefined}>
        {shown.body}
      </p>
      <Link href="/" className="btn btn-quiet mt-5">
        Go to AgentForge
      </Link>
    </Card>
  );
}
