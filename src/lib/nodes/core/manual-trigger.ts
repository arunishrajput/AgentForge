import { z } from "zod";

import { defineNode } from "../types";

/**
 * Starts a run from a button press or an API call. The payload supplied to the
 * trigger becomes the first node's input, so a workflow can be exercised with
 * real data before a webhook or a schedule exists (Phase 8).
 */
export const manualTrigger = defineNode({
  type: "core.manual_trigger",
  label: "Manual trigger",
  description:
    "Starts the workflow when a person runs it. Any JSON supplied at trigger time becomes the output of this node.",
  kind: "trigger",
  category: "trigger",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "whatever JSON the run was started with. Reach its fields with {{trigger.<field>}}.",
  configSchema: z.object({}).loose(),
  async execute({ input, context }) {
    context.log("Run started manually.");
    return { output: input ?? {} };
  },
});
