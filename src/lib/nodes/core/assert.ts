import { z } from "zod";

import { defineNode, NodeError } from "../types";
import { evaluate } from "./branch";

/**
 * Guard. Fails the run when its condition does not hold, with a message the user
 * reads on the failed step. Gives a workflow a way to stop early on bad data
 * instead of carrying it forward, and gives the engine's failure path something
 * deterministic to exercise.
 */
export const assertNode = defineNode({
  type: "core.assert",
  label: "Assert",
  description:
    "Fails the run when the condition is false, with the message you configure. Use it to stop a workflow early when incoming data is not what it must be.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  agentCallable: true,
  configSchema: z.object({
    left: z.unknown(),
    operator: z
      .enum([
        "equals",
        "not_equals",
        "contains",
        "greater_than",
        "less_than",
        "is_empty",
        "is_not_empty",
      ])
      .default("is_not_empty"),
    right: z.unknown().optional(),
    message: z.string().max(500).default("Assertion failed."),
  }),
  async execute({ config, input, context }) {
    if (!evaluate(config.operator, config.left, config.right)) {
      throw new NodeError(config.message);
    }
    context.log("Assertion passed.");
    return { output: input ?? null };
  },
});
