"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
 * Visual design is Phase 10. This is legibility and a working flow.
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
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<GenerationIssue[]>([]);
  // A workflow that was built but could not do everything asked. It is saved and
  // valid, so this is a note rather than an error — and the user goes to it when they
  // have read the note, instead of arriving at a canvas that quietly does less.
  const [gaps, setGaps] = useState<{ id: string; unsupported: string[] } | null>(null);

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
    <form onSubmit={submit} className="bg-surface mb-8 rounded-xl p-5">
      <label htmlFor="generate-prompt" className="block text-sm font-medium">
        Describe the workflow you want
      </label>
      <p className="text-muted mt-1 text-[13px]">
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
        className="bg-canvas mt-3 w-full resize-y rounded-lg px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 transition-shadow placeholder:text-muted/60 focus:ring-2 focus:ring-accent disabled:opacity-50"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted text-[12px]">Try:</span>
          {EXAMPLES.map((example, index) => (
            <button
              key={example}
              type="button"
              disabled={busy}
              onClick={() => setPrompt(example)}
              className="bg-canvas text-muted hover:text-ink rounded-md px-2 py-1 text-[12px] ring-1 ring-white/10 transition-colors disabled:opacity-50"
            >
              Example {index + 1}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={busy || prompt.trim().length === 0}
          className="bg-accent text-canvas rounded-lg px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Building…" : "Generate workflow"}
        </button>
      </div>

      {busy && (
        <p className="text-muted mt-3 text-[12px]" role="status">
          Asking the model for a workflow, then validating it before it is saved. This
          takes a few seconds.
        </p>
      )}

      {gaps && (
        <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2.5 ring-1 ring-amber-400/20">
          <p className="text-[13px] text-amber-100">
            Built and saved — but no node can do these parts yet:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {gaps.unsupported.map((item) => (
              <li key={item} className="text-[12px] text-amber-100/80">
                {item}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => router.push(`/workflows/${gaps.id}`)}
            className="mt-2.5 text-[12px] font-medium text-amber-100 underline underline-offset-4"
          >
            Open the workflow anyway
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2.5 ring-1 ring-red-400/20">
          <p className="text-[13px] text-red-200">{error}</p>
          {issues.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {issues.slice(0, 6).map((issue, index) => (
                <li key={index} className="text-[12px] text-red-200/75">
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
