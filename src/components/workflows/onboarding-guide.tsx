"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/ui/illustration";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/canvas/client";
import type { OnboardingProgress, OnboardingStep, OnboardingStepId } from "@/lib/onboarding/steps";

/**
 * **The first-run guide — BUILD_PLAN.md Phase 25, task 1.**
 *
 * `BUILD_PLAN.md` asks for "a first-run onboarding flow that gets a new user to their
 * first successful run". This is that, and it is a *guide on the page they already landed
 * on* rather than a flow they are put through. Three reasons, in order:
 *
 *   • **A modal or a wizard has to be dismissed before the product can be looked at**,
 *     and the first thing a developer evaluating an automation tool wants to do is look at
 *     it. A checklist above the content is skippable by scrolling.
 *   • **It is driven by real state, so it cannot lie.** Every step is read from the
 *     database on the server (`lib/onboarding/onboarding.ts`). A wizard that tracks its own
 *     position says "add a key" to somebody who added one in another tab.
 *   • **It survives being left half done.** Somebody who pastes a key and closes the tab
 *     comes back to step 2 open, not to step 1 again.
 *
 * ## What it is careful about
 *
 * **Done is never signalled by colour alone** — `DESIGN.md` → *Never colour alone*. A
 * finished step carries a tick glyph and the words "Done" for a screen reader, and its
 * number is replaced rather than merely recoloured.
 *
 * **The steps are an `<ol>`**, because they are a sequence and a screen reader should say
 * "3 of 3". They are presented in order but not *gated* in order: a template that uses no
 * LLM node runs with no key at all, so disabling step 2 until step 1 is done would be a
 * lie about the product. The reasoning is in `lib/onboarding/steps.ts`.
 *
 * **Dismissing is one request and it is honest about being permanent.** The button says
 * "Skip setup" while there is work left and "Got it" when there is not, because those are
 * different acts, and both write the same `onboardedAt` — see `finishOnboarding`.
 */

/** Where each step sends somebody, and what the button says. */
const ACTIONS: Record<OnboardingStepId, { href: string; label: string; secondary?: { href: string; label: string } }> = {
  provider: { href: "/settings?tab=provider", label: "Add a key in Settings" },
  workflow: {
    // The prompt box is on this page, so the primary action is an in-page jump rather than
    // a navigation — it focuses the thing it names instead of reloading what is already here.
    href: "#generate-prompt",
    label: "Describe one",
    secondary: { href: "/templates", label: "Or open a template" },
  },
  run: { href: "/workflows", label: "Open a workflow and press Run" },
};

export function OnboardingGuide({ progress }: { progress: OnboardingProgress }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /**
   * Which step is expanded. It starts on the first unfinished one — the thing left to do —
   * and `null` once everything is done, because the completed card has its own single
   * message and an expanded step underneath it would compete with it.
   */
  const [open, setOpen] = useState<OnboardingStepId | null>(progress.next);

  const finish = async () => {
    setBusy(true);
    try {
      await api.finishOnboarding();
      // The guide is server-rendered from `onboardedAt`, so a refresh is what removes it.
      // Nothing is hidden optimistically: if the write failed, the card must still be here.
      router.refresh();
    } catch {
      toast({
        tone: "bad",
        title: "Could not put the guide away",
        detail: "It is still here. Try again, or reload the page.",
        duration: null,
      });
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="onboarding-heading"
      className="card card-raised animate-rise mb-6 overflow-hidden p-0"
    >
      <div className="border-line-soft flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-4">
        <Mascot mood={progress.complete ? "happy" : "thinking"} className="size-9" float={progress.complete} />
        <div className="min-w-0 flex-1">
          <h2 id="onboarding-heading" className="text-base font-bold">
            {progress.complete ? "You are set up" : "Get your first workflow running"}
          </h2>
          <p className="text-muted mt-0.5 text-sm text-pretty">
            {progress.complete
              ? "Every step is done — a key is stored, a workflow exists and one has run. Next: open it and press ✦ Copilot to change it by asking, tag it to find it again, or start it from a script with an access token in Settings."
              : "Three steps. The first is the only one AgentForge cannot work without."}
          </p>
        </div>
        {/* The count is text, not only a bar: a progress bar alone tells a screen reader
            nothing useful, and tells a sighted reader an approximation of a number that is
            small enough to state exactly. */}
        <p className="text-faint shrink-0 font-mono text-2xs tabular-nums" role="status">
          {progress.completed} of {progress.steps.length} done
        </p>
      </div>

      <ol className="divide-line-soft divide-y">
        {progress.steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            expanded={open === step.id}
            onToggle={() => setOpen(open === step.id ? null : step.id)}
          />
        ))}
      </ol>

      <div className="border-line-soft bg-elevated flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
        <p className="text-faint text-2xs text-pretty">
          {progress.complete
            ? "Putting it away is permanent — it does not come back."
            : "You can put this away and come back to it from the docs. It does not come back on its own."}
        </p>
        <Button
          size="sm"
          tone={progress.complete ? "primary" : "quiet"}
          loading={busy}
          onClick={() => void finish()}
        >
          {progress.complete ? "Got it" : "Skip setup"}
        </Button>
      </div>
    </section>
  );
}

function StepRow({
  step,
  index,
  expanded,
  onToggle,
}: {
  step: OnboardingStep;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const action = ACTIONS[step.id];
  const bodyId = `onboarding-step-${step.id}`;

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <Marker done={step.done} number={index + 1} />

        <div className="min-w-0 flex-1">
          {/* A button, not a heading with a click handler: it toggles a disclosure, so it
              owns `aria-expanded` and `aria-controls` and reaches by keyboard for free. */}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            /**
             * `min-h-6` is **WCAG 2.2 SC 2.5.8 Target Size (Minimum)**, measured in a
             * browser and not guessed: the row was 20 px tall. The spacing exception
             * technically rescued it — the steps are 55 px apart, so the 24 px circles
             * never intersect — and leaning on an exception for a control that can be
             * made compliant by one class is the wrong trade, on a phone most of all.
             */
            className="-mx-1 flex min-h-6 w-full items-center gap-2 rounded-lg px-1 text-left"
          >
            <span
              className={step.done ? "text-muted text-sm font-semibold line-through" : "text-sm font-semibold"}
            >
              {step.title}
            </span>
            <svg
              viewBox="0 0 8 8"
              aria-hidden="true"
              className={`text-faint size-2 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            >
              <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
            </svg>
          </button>

          {expanded && (
            <div id={bodyId} className="animate-fade mt-1.5">
              <p className="text-muted text-sm text-pretty">{step.detail}</p>
              {!step.done && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Link href={action.href} className="btn btn-primary btn-sm px-2.5 py-1 text-2xs">
                    {action.label}
                  </Link>
                  {action.secondary && (
                    <Link href={action.secondary.href} className="btn btn-ghost px-2.5 py-1 text-2xs">
                      {action.secondary.label}
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The step's marker. **Two differences, not one**: a finished step changes glyph *and*
 * fill, so the state survives being read in greyscale or by somebody who cannot
 * distinguish the green — `DESIGN.md` → *Never colour alone*. The word is for a screen
 * reader, which cannot see either.
 */
function Marker({ done, number }: { done: boolean; number: number }) {
  return (
    <span
      className={[
        "border-line mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 font-mono text-2xs font-bold tabular-nums",
        done ? "bg-ok-pop text-accent-ink" : "bg-surface text-muted",
      ].join(" ")}
    >
      {done ? (
        <>
          <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
            <path
              d="M2.5 6.5 L4.8 8.8 L9.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">Done: </span>
        </>
      ) : (
        <>
          {number}
          <span className="sr-only">. Not done: </span>
        </>
      )}
    </span>
  );
}
