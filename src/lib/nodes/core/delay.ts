import { z } from "zod";

import { defineNode, NodeError } from "../types";

/**
 * Waits, then passes its input through unchanged.
 *
 * Added in Phase 5 for two reasons beyond being a genuinely useful node — spacing
 * out calls to a rate-limited service is a real workflow need.
 *
 * First, every other core node finishes in about a millisecond, so a whole run
 * completes in ~100 ms and there is no honest way to verify that status and logs
 * arrive *incrementally* rather than all at once. Second, it logs before it waits
 * and again after, which is the only current exercise of mid-node log streaming —
 * the path every agent node will take from Phase 6 on.
 *
 * The cap is a bound, not a default: a workflow may not park an instance for longer
 * than this, and the engine's own 120 s deadline still applies above it.
 */
export const MAX_DELAY_MS = 10_000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () =>
      reject(new NodeError("The run stopped before this delay finished."));

    if (signal.aborted) {
      stop();
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      stop();
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const delayNode = defineNode({
  type: "core.delay",
  label: "Delay",
  description:
    "Waits for a fixed number of milliseconds, then passes its input through unchanged. Use it to space out calls to a rate-limited service.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  configSchema: z.object({
    ms: z.number().int().min(0).max(MAX_DELAY_MS).default(1000),
  }),
  async execute({ config, input, context }) {
    const ms = Math.min(config.ms, MAX_DELAY_MS);
    context.log(`Waiting ${ms} ms.`);
    await wait(ms, context.signal);
    context.log("Done waiting.");
    return { output: input ?? null };
  },
});
