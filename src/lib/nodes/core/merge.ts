import { z } from "zod";

import { MERGE_MODES, MERGE_TYPE, type MergeInput } from "@/lib/engine/join";

import { defineNode } from "../types";

/**
 * **Joins branches, and runs once — Phase 39** (D187, `CONTRACT.md` → *Merge*).
 *
 * The node itself is almost nothing, and that is on purpose. **Holding the branches and deciding
 * when the join is complete belongs to the work list** (`engine/join.ts`), shared with the retry's
 * replay — a node's `execute` cannot see the queue, and the question "can anything still reach me?"
 * is about the queue. What arrives here is already one input: how many branches there were, what each
 * carried, and which node it came from.
 *
 *   all     waits for every branch that can still arrive, then runs once. A diamond made by a Branch
 *           node sends the run down one side only, so "every branch" means every branch the run is
 *           still taking — the merge does not wait for a side that was never chosen
 *   first   runs on the first arrival and ignores the rest, which is how a race is written: ask two
 *           services, use whichever answers first
 *
 * **Not agent-callable.** A node whose whole purpose is how edges meet has nothing for a tool call to
 * do (D19, D36).
 */
export const mergeNode = defineNode({
  type: MERGE_TYPE,
  label: "Merge",
  description:
    "Joins branches that run side by side and runs once. In all mode it waits until every branch still on its way has reached it; " +
    "in first mode it runs on the first branch and ignores the rest. Outputs how many were joined and what each carried.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ count: how many branches were joined, inputs: [one value per branch in the order they reached it], from: [the id of the node each came from] }. Read one branch as {{input.inputs[0].field}}.",
  agentCallable: false,
  configSchema: z.object({
    mode: z.enum(MERGE_MODES).default("all"),
  }),
  docs: {
    summary:
      "Where branches that ran side by side meet again. In All mode it waits until every branch still on its way has reached it and then runs once, " +
      "with what each carried; in First mode it runs on the first branch and ignores the rest. Without a Merge, a step that two branches lead to runs twice.",
    accepts: "the branches leading into it — it reads them itself and hands on one combined value",
    examples: [
      { title: "Read the first branch's field", body: "{{input.inputs[0].title}}" },
      { title: "How many were joined", body: "{{input.count}}" },
      { title: "Which node a branch came from", body: "{{input.from[1]}}" },
      { title: "A branch's output by node id, from anywhere after the merge", body: "{{steps.fetch_weather.output.temp}}" },
    ],
  },
  async execute({ config, input, context }) {
    const joined = readJoin(input);
    context.log(
      config.mode === "first"
        ? `First of the branches to arrive: ${joined.from[0] || "a branch"}. Any later arrival is ignored.`
        : `Joined ${joined.count} ${joined.count === 1 ? "branch" : "branches"}${joined.from.length > 0 ? `: ${joined.from.join(", ")}` : ""}.`,
    );
    return { output: joined };
  },
});

/**
 * What the engine handed over, or — for a node tested on its own, which is fed a single value and
 * no branches — that value as the one branch it stands for.
 */
function readJoin(input: unknown): MergeInput {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const candidate = input as Partial<MergeInput>;
    if (
      typeof candidate.count === "number" &&
      Array.isArray(candidate.inputs) &&
      Array.isArray(candidate.from)
    ) {
      return { count: candidate.count, inputs: candidate.inputs, from: candidate.from };
    }
  }
  return { count: 1, inputs: [input ?? null], from: [] };
}
