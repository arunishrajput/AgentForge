import type { RunOrigin } from "@/lib/engine/retry";
import type { StepStatus, TriggerKind } from "@/lib/engine/types";

/**
 * **What a run is called, in one place — Phase 33.** The history list, a run's page and the
 * canvas's recent runs all describe the same runs, and three hand-written copies of "what started
 * this" would drift into three vocabularies. Pure and client-safe.
 */

/** What started a run, as a person would say it. */
export const TRIGGER_WORDS: Record<TriggerKind, string> = {
  manual: "Manual",
  webhook: "Webhook",
  schedule: "Schedule",
  agent: "Agent",
  // Phase 37: started because another workflow's run failed (`core.error_trigger`).
  error: "Failure",
};

/** A run's id, short enough to read and long enough to tell apart in one workspace. */
export function shortRunId(id: string): string {
  return id.slice(0, 8);
}

/** "Retry of 1a2b3c4d" — where a run came from, or null for an ordinary run. */
export function originWords(origin: RunOrigin | null | undefined): string | null {
  if (!origin) return null;
  return `${origin.kind === "retry" ? "Retry" : "Re-run"} of ${shortRunId(origin.runId)}`;
}

/**
 * How many of a run's steps a retry carried over, and how many it executed — the sentence a
 * retried run's page leads with, because "these were not run again" is the property a person is
 * checking when they open one.
 */
export function retryTally(steps: readonly { status: StepStatus }[]): { reused: number; ran: number } {
  let reused = 0;
  let ran = 0;
  for (const step of steps) {
    if (step.status === "reused") reused += 1;
    else if (step.status === "succeeded" || step.status === "failed" || step.status === "running") ran += 1;
  }
  return { reused, ran };
}

/**
 * "1 error handled" — Phase 37 (D175). A run that handled errors and succeeded did what its author
 * planned, and its status says so; this is the line beside it that says what it survived. Null for
 * the great majority of runs, which handled nothing.
 */
export function handledWords(handled: number | undefined): string | null {
  if (!handled || handled < 1) return null;
  return `${handled} error${handled === 1 ? "" : "s"} handled`;
}
