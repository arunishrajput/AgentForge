"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  ApiRequestError,
  api,
  type GenerationErrorDetails,
  type GenerationIssue,
} from "@/lib/canvas/client";

/**
 * The prompt box — BUILD_PLAN.md Phase 7, task 1, and `DEMO.md` Beat 2.
 *
 * It sits above the workflow list because generating is the primary way to start a
 * workflow here; "New workflow" stays, as the empty canvas is still the way to build
 * one by hand.
 *
 * On success it navigates straight to the canvas, so the generated graph appears
 * where every other workflow appears — there is no separate preview surface to keep
 * in sync, and the thing the user lands on is genuinely the saved workflow rather
 * than a rendering of the model's answer.
 *
 * **The wait is where Phase 10's motion budget goes**, along with the node entry
 * stagger on the canvas — together they are `DEMO.md` Beat 3. Two to three seconds
 * of nothing reads as a hang on stage, so the wait gets an indeterminate sweep and a
 * live elapsed count. Deliberately *not* a staged "asking the model → validating →
 * saving" sequence: the request is a single round trip and this component cannot see
 * which of those the server is doing, so timed stage labels would be decoration
 * pretending to be progress. An honest clock is better than a fake one.
 */

/** Chosen so a demo has a second, visibly different request to hand. */
const EXAMPLES = [
  "When I run this, summarise the support message I give it, decide whether it is urgent, and log urgent ones as a warning.",
  "Take a list of order ids, wait a second between each, and log every one.",
];

export function GenerateWorkflowForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<GenerationIssue[]>([]);
  // A workflow that was built but could not do everything asked. It is saved and
  // valid, so this is a note rather than an error — and the user goes to it when they
  // have read the note, instead of arriving at a canvas that quietly does less.
  const [gaps, setGaps] = useState<{ id: string; unsupported: string[] } | null>(null);

  // The clock only exists while a request is in flight, so nothing ticks on an idle
  // page. Cleared by the effect's own teardown when `busy` goes false.
  const startedAt = useRef(0);
  useEffect(() => {
    if (!busy) return;
    startedAt.current = Date.now();
    // Synchronising with a timer, which is the case effects are for. Worth revisiting
    // when Phase 15 rebuilds this form.
    // oxlint-disable-next-line react/set-state-in-effect
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 100);
    return () => clearInterval(timer);
  }, [busy]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const request = prompt.trim();
    if (request.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    setIssues([]);
    setGaps(null);

    try {
      const result = await api.generateWorkflow({ prompt: request });

      if (result.generation.unsupported.length > 0) {
        setGaps({ id: result.workflow.id, unsupported: result.generation.unsupported });
        setBusy(false);
        return;
      }

      router.push(`/workflows/${result.workflow.id}`);
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        const details = caught.details as GenerationErrorDetails | undefined;
        setIssues(details?.issues ?? []);
      } else {
        setError("Could not generate the workflow.");
      }
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card animate-rise mb-8 p-5">
      <label htmlFor="generate-prompt" className="block text-sm font-medium">
        Describe the workflow you want
      </label>
      <p className="text-muted mt-1 text-ui">
        Plain language. AgentForge builds a real workflow you can run and edit.
      </p>

      <textarea
        id="generate-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          // Enter alone would fight a multi-line description, so submit is
          // ⌘/Ctrl+Enter — the convention for a textarea that is really a command.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            void submit(event);
          }
        }}
        rows={3}
        maxLength={4000}
        disabled={busy}
        placeholder="When I run this, summarise the message, decide whether it is urgent, and log urgent ones as a warning."
        className="field mt-3 resize-y px-3 py-2.5 text-sm"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted text-xs">Try:</span>
          {EXAMPLES.map((example, index) => (
            <button
              key={example}
              type="button"
              disabled={busy}
              onClick={() => setPrompt(example)}
              className="btn btn-quiet text-muted hover:text-ink px-2 py-1 text-xs"
            >
              Example {index + 1}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={busy || prompt.trim().length === 0}
          className="btn btn-primary px-4 py-2"
        >
          {busy ? "Building…" : "Generate workflow"}
        </button>
      </div>

      {busy && (
        <div className="animate-fade mt-4">
          <div className="sweep-bar h-1" aria-hidden="true" />
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-muted text-xs" role="status">
              Asking the model for a workflow, then validating every node and edge
              against the registry before it is saved.
            </p>
            <span className="text-faint shrink-0 font-mono text-2xs tabular-nums">
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      )}

      {gaps && (
        <div className="bg-warn/10 ring-warn/25 animate-rise mt-4 rounded-lg px-3 py-2.5 ring-1">
          <p className="text-warn text-ui">
            Built and saved — but no node can do these parts yet:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {gaps.unsupported.map((item) => (
              <li key={item} className="text-xs text-warn/80">
                {item}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => router.push(`/workflows/${gaps.id}`)}
            className="text-warn mt-2.5 text-xs font-medium underline underline-offset-4"
          >
            Open the workflow anyway
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-bad/10 ring-bad/25 animate-rise mt-4 rounded-lg px-3 py-2.5 ring-1"
        >
          <p className="text-bad text-ui">{error}</p>
          {issues.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {issues.slice(0, 6).map((issue, index) => (
                <li key={index} className="text-xs text-bad/75">
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
