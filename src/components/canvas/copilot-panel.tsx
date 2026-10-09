"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { changeLook } from "@/lib/canvas/changes";
import type { DiffSummary, NodeChange } from "@/lib/canvas/client";
import type { ProposalOutcome, Turn } from "@/lib/canvas/copilot";
import type { ChangeKind, ChangeLine } from "@/lib/canvas/proposal";
import { shortcutFor } from "@/lib/canvas/shortcuts";
import { chordLabel, type Platform } from "@/lib/ui/keys";

import { Panel } from "./panel";
import type { Copilot } from "./use-copilot";

/**
 * **The copilot — `BUILD_PLAN.md` Phase 35, task 1.** A conversation about the workflow on the
 * canvas, whose answers are proposals shown on the canvas as a diff (Phase 18's diff mode) and
 * applied only by Accept.
 *
 * **It takes the inspector's column, not a column of its own** (D161). Phase 16 spent itself winning
 * canvas width back — two open panels leave 876 px of a 1440 px screen and a third 320 px column
 * would leave 556 — and while a proposal is on screen the inspector has nothing to show anyway:
 * diff mode makes the canvas unselectable. So the right-hand column is either the inspector or the
 * copilot, it rails and drawers exactly as the inspector does (`panel.tsx`), and selecting a node
 * brings the inspector back. The conversation is kept by the editor (`use-copilot.ts`), so leaving
 * the column and coming back loses nothing.
 *
 * Everything the copilot says is rendered as text. A proposal is described in words — every node it
 * adds with the values it sets, every value it changes before and after — because "Changed:
 * configuration" on a ribbon does not say what Accept would do (`lib/canvas/proposal.ts`).
 */

/** The composer's id, which the editor focuses when the copilot is opened from the toolbar or ⌘K. */
export const COPILOT_COMPOSER = "copilot-panel-composer";

/** Requests that fit almost any workflow — a starting point, not a script. */
const EXAMPLES = [
  "Rename the steps so they say what they do",
  "Log the result at the end",
  "Remove the last step",
];

/** A change line's glyph and word — the diff's own glyphs (`changes.ts`), so the panel and the canvas agree. */
const KIND: Record<ChangeKind, { glyph: string; word: string }> = {
  added: { glyph: changeLook("added").glyph, word: "Added" },
  removed: { glyph: changeLook("removed").glyph, word: "Removed" },
  changed: { glyph: changeLook("changed").glyph, word: "Changed" },
  connected: { glyph: "↔", word: "Connected" },
  disconnected: { glyph: "↔", word: "Disconnected" },
};

export function CopilotPanel({
  id,
  open,
  collapsed,
  onClose,
  onExpand,
  onCollapse,
  onShowDetails,
  copilot,
  onAccept,
  comparingVersions,
  platform,
}: {
  id: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  /** Give the column back to the inspector. */
  onShowDetails: () => void;
  copilot: Copilot;
  /** Accept the open proposal — the editor puts it on the canvas as one step of undo. */
  onAccept: () => void;
  /** A version comparison is on the canvas — the copilot waits until it is closed. */
  comparingVersions: boolean;
  platform: Platform;
}) {
  const { state, busy, draft, setDraft } = copilot;
  const proposal = state.proposal;
  const composer = useRef<HTMLTextAreaElement>(null);

  /**
   * The newest turn is the one to read, so it is scrolled into view when it arrives. A ref
   * callback on the last item, stable so it runs once per new item and never on a keystroke in
   * the composer; a turn that changes kind — thinking to proposal — is a new item (its key says
   * so), so the answer is brought into view too.
   */
  const showNewest = useCallback((element: HTMLLIElement | null) => {
    element?.scrollIntoView({ block: "nearest" });
  }, []);

  const send = () => {
    if (busy || comparingVersions || draft.trim() === "") return;
    void copilot.ask(draft);
  };

  const undoKeys = chordLabel(shortcutFor("undo").chords[0], platform);

  return (
    <Panel
      id={id}
      side="right"
      title="Copilot"
      width="lg:w-80"
      open={open}
      collapsed={collapsed}
      onClose={onClose}
      onExpand={onExpand}
      onCollapse={onCollapse}
      header={
        <button type="button" onClick={onShowDetails} className="btn btn-ghost shrink-0 px-2 py-1 text-2xs">
          Details
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <ol
          // Polite: an answer arriving should be read once it is there, without cutting off
          // whatever the person is doing — usually reading the canvas.
          aria-live="polite"
          aria-label="Conversation with the copilot"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        >
          {state.turns.length === 0 && (
            <li className="space-y-3">
              <p className="text-sm leading-relaxed">
                Ask for a change in plain words — <q>also post the urgent ones to Slack</q>,{" "}
                <q>remove the logging step</q>.
              </p>
              <p className="text-muted text-2xs leading-relaxed">
                The copilot proposes it on the canvas as a diff. Nothing changes until you accept it, and
                an accepted change is one step of undo and not saved until you save.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <Button
                    key={example}
                    size="sm"
                    disabled={busy || comparingVersions}
                    onClick={() => {
                      setDraft(example);
                      composer.current?.focus();
                    }}
                    className="text-left whitespace-normal"
                  >
                    {example}
                  </Button>
                ))}
              </div>
            </li>
          )}
          {state.turns.map((turn, index) => (
            <li
              key={`${turn.id}:${turn.from === "copilot" ? turn.state : "you"}`}
              ref={index === state.turns.length - 1 ? showNewest : undefined}
            >
              <TurnView
                turn={turn}
                undoKeys={undoKeys}
                onAccept={onAccept}
                onReject={copilot.reject}
                acting={busy}
              />
            </li>
          ))}
        </ol>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="border-line shrink-0 space-y-2 border-t-2 p-3"
        >
          <label htmlFor={COPILOT_COMPOSER} className="eyebrow block">
            {proposal ? "Refine the proposal" : "Ask for a change"}
          </label>
          {comparingVersions && (
            <p className="text-muted text-2xs leading-relaxed">
              A version comparison is on the canvas. Go back to editing to ask for a change.
            </p>
          )}
          <Textarea
            id={COPILOT_COMPOSER}
            ref={composer}
            rows={2}
            maxLength={2000}
            value={draft}
            disabled={comparingVersions}
            placeholder={proposal ? "No — only the urgent ones" : "Also post the urgent ones to Slack"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends and Shift-Enter is a new line — a conversation's convention, where the
              // prompt box on the workflows page (a one-off command) uses ⌘-Enter.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            className="text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted text-3xs">Enter to send · Shift-Enter for a new line</span>
            <Button
              type="submit"
              tone="primary"
              size="sm"
              loading={busy}
              disabled={comparingVersions || draft.trim() === ""}
            >
              {proposal ? "Refine" : "Ask"}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function TurnView({
  turn,
  undoKeys,
  onAccept,
  onReject,
  acting,
}: {
  turn: Turn;
  undoKeys: string;
  onAccept: () => void;
  onReject: () => void;
  /** A refine is in flight: the open proposal cannot be accepted or rejected until it lands. */
  acting: boolean;
}) {
  if (turn.from === "you") {
    return (
      <div className="border-line bg-elevated ml-6 rounded-xl border-2 px-3 py-2">
        <span className="sr-only">You: </span>
        <p className="text-sm break-words whitespace-pre-wrap">{turn.text}</p>
      </div>
    );
  }

  switch (turn.state) {
    case "thinking":
      return <Thinking startedAt={turn.startedAt} />;
    case "failed":
      return (
        <Notice
          tone="bad"
          title={turn.message}
          action={
            turn.recovery && (
              <Link href={turn.recovery.href} className="btn btn-quiet px-2.5 py-1 text-2xs">
                {turn.recovery.label}
              </Link>
            )
          }
        >
          {turn.issues.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {turn.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p>Nothing was changed.</p>
          )}
        </Notice>
      );
    case "set-aside":
      return <p className="text-muted text-2xs leading-relaxed">{turn.reason}</p>;
    case "nothing":
      return (
        <div className="card space-y-2 p-3">
          <p className="text-ui font-bold">No change to propose.</p>
          <Unsupported items={turn.unsupported} />
          {turn.unsupported.length === 0 && (
            <p className="text-muted text-2xs">The workflow already does what was asked, as far as the copilot can tell.</p>
          )}
        </div>
      );
    case "proposal":
      return (
        <ProposalView
          summary={turn.summary}
          lines={turn.lines}
          unsupported={turn.unsupported}
          problems={turn.problems}
          outcome={turn.outcome}
          undoKeys={undoKeys}
          onAccept={onAccept}
          onReject={onReject}
          acting={acting}
        />
      );
  }
}

/** The wait, with an honest clock — the generation form's treatment, for the same reason. */
function Thinking({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="animate-fade space-y-2">
      <div className="sweep-bar h-1.5" aria-hidden="true" />
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-muted text-2xs" role="status">
          Drafting a change, then validating it against the registry.
        </p>
        <span className="text-muted shrink-0 font-mono text-2xs tabular-nums">
          {(Math.max(0, now - startedAt) / 1000).toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

function Unsupported({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Notice tone="warn" title="Not done — no node can do this">
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Notice>
  );
}

const OUTCOME: Record<Exclude<ProposalOutcome, "open">, string> = {
  accepted: "Accepted",
  rejected: "Rejected — the canvas is as it was.",
  refined: "Refined — see below.",
  "set-aside": "Set aside — nothing was applied.",
};

function ProposalView({
  summary,
  lines,
  unsupported,
  problems,
  outcome,
  undoKeys,
  onAccept,
  onReject,
  acting,
}: {
  summary: DiffSummary;
  lines: ChangeLine[];
  unsupported: string[];
  problems: number;
  outcome: ProposalOutcome;
  undoKeys: string;
  onAccept: () => void;
  onReject: () => void;
  acting: boolean;
}) {
  const open = outcome === "open";
  return (
    <section
      aria-label="Proposed change"
      className={cn("card space-y-2.5 p-3", !open && "bg-sunken shadow-flat")}
    >
      <header className="flex flex-wrap items-center gap-1.5">
        <span className="text-ui mr-auto font-bold">{open ? "Proposed change" : "Proposal"}</span>
        <Counts summary={summary} />
      </header>

      <ul className="space-y-2">
        {lines.map((line) => (
          <li key={line.key} className="text-2xs leading-relaxed">
            <ChangeLineView line={line} />
          </li>
        ))}
      </ul>

      <Unsupported items={unsupported} />

      {problems > 0 && (
        <p className="text-muted text-2xs leading-relaxed">
          Still {problems === 1 ? "has 1 problem" : `has ${problems} problems`} the canvas already had —
          the inspector lists {problems === 1 ? "it" : "them"} once you save.
        </p>
      )}

      {open ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button tone="primary" size="sm" onClick={onAccept} disabled={acting}>
            Accept
          </Button>
          <Button size="sm" onClick={onReject} disabled={acting}>
            Reject
          </Button>
          <span className="text-muted text-3xs">or refine it below</span>
        </div>
      ) : (
        <p className="text-muted text-2xs font-bold">
          {outcome === "accepted"
            ? `Accepted — on the canvas, not saved yet. ${undoKeys} undoes it.`
            : OUTCOME[outcome]}
        </p>
      )}
    </section>
  );
}

/** The proposal's counts, as the diff bar draws them: glyph, colour and word. */
function Counts({ summary }: { summary: DiffSummary }) {
  const counts: { change: NodeChange; count: number }[] = [
    { change: "added", count: summary.added },
    { change: "removed", count: summary.removed },
    { change: "changed", count: summary.changed },
  ];
  return (
    <>
      {counts
        .filter((entry) => entry.count > 0)
        .map(({ change, count }) => {
          const look = changeLook(change);
          return (
            <span key={change} className={cn("chip-pop shrink-0", look.fill)}>
              <span aria-hidden="true">{look.glyph}</span>
              {count} {look.label.toLowerCase()}
            </span>
          );
        })}
    </>
  );
}

function ChangeLineView({ line }: { line: ChangeLine }) {
  const kind = KIND[line.kind];
  return (
    <>
      <p className="flex gap-1.5">
        <span aria-hidden="true" className="w-3 shrink-0 text-center font-mono font-bold">
          {kind.glyph}
        </span>
        <span className="min-w-0 flex-1 break-words">
          {kind.word} <strong className="font-bold">{line.subject}</strong>
          {line.what && line.what !== line.subject && <span className="text-muted"> · {line.what}</span>}
          {line.summary && <span className="text-muted"> — {line.summary}</span>}
        </span>
      </p>
      {line.details.length > 0 && (
        <dl className="border-line mt-1 ml-4.5 space-y-0.5 border-l-2 pl-2">
          {line.details.map((detail) => (
            <div key={detail.key} className="flex min-w-0 gap-1.5">
              <dt className="text-muted shrink-0 font-mono">{detail.key}</dt>
              <dd className="min-w-0 flex-1 font-mono break-words">
                {detail.before !== undefined && (
                  <>
                    <del className="text-muted">{detail.before}</del>
                    {detail.after !== undefined && (
                      <span aria-hidden="true" className="text-muted">
                        {" "}
                        →{" "}
                      </span>
                    )}
                  </>
                )}
                {detail.after !== undefined && <ins className="no-underline">{detail.after}</ins>}
                {detail.after === undefined && <span className="text-muted"> (removed)</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
