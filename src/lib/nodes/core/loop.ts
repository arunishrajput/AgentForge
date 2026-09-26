import { z } from "zod";

import { defineNode } from "../types";

/**
 * Bounded loop. Emits one item per pass through the `loop` output, then leaves
 * through `done`. The body edges back into this node, which is the only legal way
 * a cycle may exist in a graph (see validateGraph).
 *
 * The cap is a safety property, not a convenience: HARD_MAX_ITERATIONS is not
 * configurable upward, so no workflow — including one an agent generates — can ask
 * for an unbounded loop. The engine enforces a second, independent per-node
 * execution cap, so a malformed graph cannot spin even if this node misbehaves.
 *
 * It holds no state of its own: `context.iteration` is how many times it has
 * already completed in this run, which the engine tracks anyway for the cap.
 */
export const HARD_MAX_ITERATIONS = 25;

export const loopNode = defineNode({
  type: "core.loop",
  label: "Loop",
  description:
    "Repeats the nodes connected to its 'loop' output once per item, then continues from its 'done' output. Iterates the incoming array, or the configured items, up to maxIterations. The number of iterations is always bounded.",
  kind: "loop",
  category: "logic",
  outputs: [
    { key: "loop", label: "Each item" },
    { key: "done", label: "Done" },
  ],
  outputShape:
    "on the loop output, { index, item, total } for the current item; on the done output, { done: true, iterations, items }.",
  configSchema: z.object({
    items: z.array(z.unknown()).optional(),
    maxIterations: z.number().int().min(1).max(HARD_MAX_ITERATIONS).default(5),
  }),
  async execute({ config, input, context }) {
    const items = config.items ?? (Array.isArray(input) ? input : null);
    const cap = Math.min(config.maxIterations, HARD_MAX_ITERATIONS);
    const total = items ? Math.min(items.length, cap) : cap;

    if (context.iteration >= total) {
      context.log(`Loop finished after ${context.iteration} iteration(s).`);
      return {
        output: { done: true, iterations: context.iteration, items },
        branch: "done",
      };
    }

    const index = context.iteration;
    context.log(`Loop iteration ${index + 1} of ${total}.`);
    return {
      output: { index, item: items ? items[index] : index, total },
      branch: "loop",
    };
  },
});
