"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  ApiRequestError,
  api,
  type GenerationErrorDetails,
  type GenerationIssue,
} from "@/lib/canvas/client";

/**
 * The prompt box — BUILD_PLAN.md Phase 7, task 1.
 *
 * It sits above the workflow list because generating is the primary way to start a
 * workflow here; "New workflow" stays, since an empty canvas is still how you build
 * one by hand.
 *
 * On success it navigates straight to the canvas, so the generated graph appears
 * where every other workflow appears — there is no separate preview surface to keep
 * in sync, and what the user lands on is genuinely the saved workflow rather than a
 * rendering of the model's answer.
 *
 * **The wait is where the motion budget goes.** Two to three seconds of nothing
 * reads as a hang, so the wait gets an indeterminate sweep and a live elapsed count.
 * Deliberately *not* a staged "asking the model → validating → saving" sequence: the
 * request is a single round trip and this component cannot see which of those the
 * server is doing, so timed stage labels would be decoration pretending to be
 * progress. An honest clock beats a fake one.
 */

/** Two, so there is always a second, visibly different request to hand. */
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

  // The clock exists only while a request is in flight, so nothing ticks on an idle
  // page. The reset lives in `submit`, not here: setting state from an effect makes
  // the effect a second source of truth for a value the event already knows.
  const startedAt = useRef(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 100);
    return () => clearInterval(timer);
  }, [busy]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const request = prompt.trim();
    if (request.length === 0 || busy) return;

    startedAt.current = Date.now();
    setElapsedMs(0);
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
    <form onSubmit={submit} className="card animate-rise mb-6 p-5">
      <label htmlFor="generate-prompt" className="text-base font-bold">
        Describe the workflow you want
      </label>
      <p className="text-muted mt-1 text-sm">
        Plain language. AgentForge builds a real workflow you can run and edit — and tells
        you the parts it could not build.
      </p>

      <Textarea
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
        className="mt-3.5 text-sm"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Try</span>
          {EXAMPLES.map((example, index) => (
            <Button
              key={example}
              size="sm"
              disabled={busy}
              onClick={() => setPrompt(example)}
              className="text-muted hover:text-ink"
            >
              Example {index + 1}
            </Button>
          ))}
        </div>

        <Button
          type="submit"
          tone="primary"
          loading={busy}
          disabled={prompt.trim().length === 0}
          className="px-4"
        >
          {busy ? "Building…" : "Generate workflow"}
        </Button>
      </div>

      {busy && (
        <div className="animate-fade mt-4">
          <div className="sweep-bar h-1.5" aria-hidden="true" />
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-muted text-2xs" role="status">
              Asking the model for a workflow, then validating every node and edge against
              the registry before it is saved.
            </p>
            <span className="text-faint shrink-0 font-mono text-2xs tabular-nums">
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      )}

      {gaps && (
        <Notice
          tone="warn"
          className="mt-4"
          title="Built and saved — but no node can do these parts yet"
          action={
            <Button size="sm" onClick={() => router.push(`/workflows/${gaps.id}`)}>
              Open it anyway
            </Button>
          }
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {gaps.unsupported.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      )}

      {error && (
        <Notice tone="bad" className="mt-4" title={error}>
          {issues.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.slice(0, 6).map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </form>
  );
}
