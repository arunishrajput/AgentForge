import { z } from "zod";

import type { RunTest } from "@/lib/engine/partial";
import type { TriggerKind } from "@/lib/engine/types";
import { scrubText } from "@/lib/generate/scrub";

/**
 * **When a run fails, who hears about it — Phase 37, `CONTRACT.md` → *Failure alerts*.**
 *
 * Two things can happen when a run finishes `failed`, and this module holds the rules for both and
 * the shape of what is handed on. It is pure — no database, no registry — so the rules that decide
 * who is told are asserted in a millisecond (`failure.test.ts`); the writes are in `engine/run.ts`
 * (`announceFailure`) and `inbox/store.ts`.
 *
 *  - **An inbox entry** for every member who may see the workflow (D177)
 *  - **A run of every error workflow** in the workspace — every active workflow whose trigger is
 *    `core.error_trigger` — handed this payload as its trigger's output (D176)
 *
 * **Only a failure nobody was watching** does either. A person who pressed Run was told on the
 * canvas, in a toast naming the step; a test is somebody at the canvas by definition. A run started
 * by a webhook or a schedule — or by an error trigger — happened with nobody looking, and that is
 * the failure the phase is about: "someone hears about it when it was not [planned for]".
 */

/** The trigger type that turns a workflow into an error workflow. Named here so nothing imports a node for a string. */
export const ERROR_TRIGGER_TYPE = "core.error_trigger";

/**
 * How many error workflows one failure may start. A workspace with more is a mistake somebody
 * should see — each would post the same alert — and the bound is what keeps one failure from
 * becoming a burst of runs; the ones past it are named in the log.
 */
export const MAX_ERROR_WORKFLOWS = 5;

/** The longest error message handed on, and the longest a name or label may be. */
export const FAILURE_ERROR_MAX = 2_000;
const NAME_MAX = 200;

/** Runs started with nobody watching. */
const UNATTENDED: ReadonlySet<TriggerKind> = new Set(["webhook", "schedule", "error"]);

/**
 * What a failed run sets off. **An error workflow never sets off another** (`trigger: "error"`): an
 * error workflow that fails — its Slack connection revoked, say — is told to the inbox and stops
 * there, so a failure cannot alert about its own alert, and no chain of error workflows can form.
 */
export function alertsFor(run: { trigger: TriggerKind; test: RunTest | null }): {
  inbox: boolean;
  errorWorkflows: boolean;
} {
  const unattended = run.test === null && UNATTENDED.has(run.trigger);
  return { inbox: unattended, errorWorkflows: unattended && run.trigger !== "error" };
}

/**
 * **What an error trigger hands on** — the failed workflow, the run, the step it failed at and the
 * error. Every string in it was written by a person or a service, not by this product, and it is
 * headed for `{{trigger.error}}` in somebody's Slack message — so each is **scrubbed of anything
 * shaped like a stored credential before it is cut** (D168's order), and bounded.
 */
export const failurePayloadSchema = z.object({
  workflow: z.object({ id: z.string(), name: z.string() }),
  run: z.object({
    id: z.string(),
    trigger: z.string(),
    startedAt: z.string(),
    /** The run's page, for a link in the alert. */
    url: z.string(),
  }),
  /** The step the run stopped at — null when it stopped between steps (out of time, at a limit, interrupted). */
  failedStep: z.object({ id: z.string(), label: z.string(), type: z.string() }).nullable(),
  /** The failed step's own words, or the run's when no step failed. */
  error: z.string(),
  /** Present, and true, only on the stand-in a run started by hand receives. */
  sample: z.literal(true).optional(),
});

export type FailurePayload = z.infer<typeof failurePayloadSchema>;

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

const clean = (text: string, max: number) => cut(scrubText(text), max);

export function failurePayload(options: {
  baseUrl: string;
  workflow: { id: string; name: string };
  run: { id: string; trigger: string; startedAt: Date | string; error: string | null };
  /** The step it stopped at, if one failed — its label as the canvas shows it. */
  step: { nodeId: string; nodeType: string; label: string; error: string | null } | null;
}): FailurePayload {
  const { workflow, run, step } = options;
  const startedAt = typeof run.startedAt === "string" ? run.startedAt : run.startedAt.toISOString();
  return {
    workflow: { id: workflow.id, name: clean(workflow.name, NAME_MAX) },
    run: {
      id: run.id,
      trigger: run.trigger,
      startedAt,
      url: `${options.baseUrl.replace(/\/$/, "")}/runs/${run.id}`,
    },
    failedStep: step && { id: step.nodeId, label: clean(step.label, NAME_MAX), type: step.nodeType },
    error: clean(step?.error ?? run.error ?? "The run failed and recorded no reason.", FAILURE_ERROR_MAX),
  };
}

/**
 * The trigger's input, read as a failure — or null when it is not one, which is what a run started
 * by hand from the canvas hands it.
 */
export function readFailure(input: unknown): FailurePayload | null {
  const parsed = failurePayloadSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * **What an error workflow is handed when somebody presses Run on it** — a failure that did not
 * happen, said so in `sample`, so the alert it builds can be tried before a real one is needed.
 * Every field is present and plausible, so `{{trigger.failedStep.label}}` resolves to something.
 */
export function sampleFailure(baseUrl: string): FailurePayload {
  return {
    workflow: { id: "sample", name: "An example workflow" },
    run: {
      id: "sample",
      trigger: "webhook",
      startedAt: new Date().toISOString(),
      url: `${baseUrl.replace(/\/$/, "")}/runs`,
    },
    failedStep: { id: "post", label: "Post to Slack", type: "integration.slack" },
    error: "This is a sample failure, so this workflow can be tried. A real one arrives when another workflow fails.",
    sample: true,
  };
}
