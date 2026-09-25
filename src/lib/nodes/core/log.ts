import { z } from "zod";

import { defineNode } from "../types";

/**
 * Writes a line to the run log and passes its input straight through. Exists so a
 * workflow can be made observable without changing its shape — the line lands on
 * the step record and streams to the UI from Phase 5.
 */
export const logNode = defineNode({
  type: "core.log",
  label: "Log message",
  description:
    "Writes a message to the run log and passes its input through unchanged. Use it to record what happened at a point in the workflow.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  agentCallable: true,
  configSchema: z.object({
    message: z.string().max(2000).default(""),
    level: z.enum(["info", "warn", "error"]).default("info"),
  }),
  async execute({ config, input, context }) {
    context.log(config.message, config.level);
    return { output: input ?? null };
  },
});
