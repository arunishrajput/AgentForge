/**
 * **First-run onboarding — the decision, as a pure function. Phase 25.**
 *
 * The three facts and the step list live here, apart from the queries that answer them,
 * for the same reason `canSeeWorkflow` lives apart from `visibleWorkflows`: the rule is
 * worth asserting without a database, and a rule that can only be exercised through a
 * query gets exercised less.
 *
 * ## Why these three steps and not more
 *
 * The product's own sentence is *describe what you want and get a real, executable
 * workflow*. Three things stand between a new account and that sentence being true, and
 * **the first one is the only hard blocker**:
 *
 *   1. **A model provider key.** Generation is one or two model calls against the user's
 *      own key, and there is no server fallback on the deployed service by design
 *      (`PROGRESS.md` → *Provider key stored*). Without a key the primary call to action
 *      on the primary page returns a 400. This is the step that exists because the
 *      product genuinely cannot work without it.
 *   2. **A workflow.** Generated or cloned from a template — the guide offers both,
 *      because "describe your first workflow" asks somebody staring at an empty page to
 *      have an idea, and a template is the answer that needs none.
 *   3. **A successful run.** The claim is *executable*, and a workflow that has never run
 *      has not demonstrated it.
 *
 * Nothing else is in the list. Integrations, teams, sharing, the vault and versioning are
 * all real features and none of them is between a new user and their first run, so putting
 * them in a first-run checklist would pad it — and a checklist long enough to feel like
 * homework is one nobody finishes.
 *
 * ## Step 2 and 3 do not require step 1
 *
 * A template that uses no LLM node clones and runs with no key at all, so the steps are
 * presented in order without being *gated* in order. Disabling step 2 until step 1 is done
 * would be a lie about the product and would trap a user who wants to look around before
 * pasting a credential.
 */

/** The three facts, as read from the database. */
export interface OnboardingFacts {
  /** The workspace holds a key for at least one LLM provider. */
  hasProviderKey: boolean;
  /** The workspace holds at least one workflow the reader can see. */
  hasWorkflow: boolean;
  /** At least one visible run in this workspace reached `succeeded`. */
  hasSuccessfulRun: boolean;
}

export type OnboardingStepId = "provider" | "workflow" | "run";

export interface OnboardingStep {
  id: OnboardingStepId;
  /** The imperative form, used as the step's heading. */
  title: string;
  /** What it is for, in one sentence. Shown under the title while the step is open. */
  detail: string;
  done: boolean;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  /** How many of the three are done. */
  completed: number;
  /** All three are done. */
  complete: boolean;
  /**
   * The first step that is not done, or `null` when every one is. This is the step the
   * guide opens on, so a returning user lands on the thing left to do rather than on a
   * list they have to re-read.
   */
  next: OnboardingStepId | null;
}

export function onboardingProgress(facts: OnboardingFacts): OnboardingProgress {
  const steps: OnboardingStep[] = [
    {
      id: "provider",
      title: "Add a model provider key",
      detail:
        "Your own key, from Google AI Studio or Groq — both have a free tier. It is encrypted before it is stored and never sent back to the browser.",
      done: facts.hasProviderKey,
    },
    {
      id: "workflow",
      title: "Build your first workflow",
      detail:
        "Describe what you want in plain language and it is built, validated and saved — or open a template and start from one that already runs.",
      done: facts.hasWorkflow,
    },
    {
      id: "run",
      title: "Run it",
      detail:
        "Press Run on the canvas. Each node lights up as it executes and its output is there to inspect when it finishes. If a step fails, the run page can say why and retry from it.",
      done: facts.hasSuccessfulRun,
    },
  ];

  const completed = steps.filter((step) => step.done).length;

  return {
    steps,
    completed,
    complete: completed === steps.length,
    next: steps.find((step) => !step.done)?.id ?? null,
  };
}
