import { z } from "zod";

import { ERROR_TRIGGER_TYPE, readFailure, sampleFailure } from "@/lib/triggers/failure";

import { defineNode } from "../types";

/**
 * **Starts a run when another workflow in this workspace fails — Phase 37** (D176).
 *
 * Wired to Slack, Discord or Gmail it *is* the failure alert, through a channel the workspace has
 * already connected — the zero-cost answer to "a mail provider" (`BUILD_PLAN.md` → *The zero-cost
 * problem*). The run that fires it is started by `engine/run.ts` → `announceFailure` when a run
 * nobody was watching — a webhook's, a schedule's — finishes `failed`; the payload is built and
 * scrubbed there (`triggers/failure.ts`), and this node only hands it on.
 *
 * **Bounded so it cannot cascade**: a run it starts has the trigger kind `error`, and a failure of
 * one of those is told to the inbox and nowhere else. It never fires for its own workflow, for a
 * test, or for a run somebody started by hand and watched fail.
 *
 * No config. Narrowing it to some workflows is a Branch on `{{trigger.workflow.name}}` after it —
 * composition the canvas already has, rather than a picker of workflow ids that would go stale as
 * workflows are renamed and deleted.
 *
 * **Run by hand, it hands on a sample failure** — said so in `sample: true` and in its log — so the
 * alert after it can be tried before a real failure is needed to see it.
 */
export const errorTrigger = defineNode({
  type: ERROR_TRIGGER_TYPE,
  label: "Error trigger",
  // Short on purpose: every trigger's definition is sent with every generation request (D156's
  // budget), so this is the model's half; `docs` below is the person's.
  description:
    "Starts the workflow when another workflow here fails while running by itself, with nobody watching. " +
    "Use it to alert on failures: follow it with a Slack, Discord or Gmail node.",
  kind: "trigger",
  category: "trigger",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ workflow: { id, name }, run: { id, trigger, startedAt, url }, failedStep: { id, label, type } or null, error }, " +
    "e.g. {{trigger.workflow.name}}, {{trigger.error}}, {{trigger.run.url}}.",
  docs: {
    summary:
      "Runs this workflow whenever another workflow in this workspace fails with nobody watching — not one somebody pressed Run on. Put a Slack, Discord or Gmail step after it and you have a failure alert. Press Run here to try it with a sample failure.",
    accepts: "nothing to configure — it fires for every workflow in the workspace you can see",
    examples: [
      {
        title: "Post failures to Discord",
        body: '"{{trigger.workflow.name}} failed at {{trigger.failedStep.label}}: {{trigger.error}} — {{trigger.run.url}}"',
      },
      {
        title: "Only one workflow",
        body: "Follow it with a Branch: {{trigger.workflow.name}} equals Invoice sync",
      },
    ],
  },
  configSchema: z.object({}).loose(),
  async execute({ input, context }) {
    const failure = readFailure(input);
    if (failure) {
      const where = failure.failedStep ? ` at "${failure.failedStep.label}"` : "";
      context.log(`"${failure.workflow.name}" failed${where}: ${failure.error}`);
      return { output: failure };
    }
    context.log(
      "Started by hand, so this is a sample failure for trying the steps after it. A real one arrives when another workflow fails.",
    );
    return { output: sampleFailure(process.env.APP_BASE_URL ?? "") };
  },
});
