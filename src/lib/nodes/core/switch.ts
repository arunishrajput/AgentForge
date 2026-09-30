import { z } from "zod";

import { defineNode } from "../types";

import { evaluate, operators } from "./branch";

/**
 * Multi-way routing: the first matching case wins, and anything unmatched leaves
 * through `else`.
 *
 * **The outputs are fixed at four cases plus a fallback, and that is a constraint of
 * the registry rather than a shortage of imagination.** `outputs` is read off the
 * definition — by the palette, by the validator, and by the canvas drawing handles —
 * long before any node's config exists, so a switch with a variable number of outputs
 * would need the registry to describe a *per-node* shape, which is a much larger change
 * than this phase should make for a node that four cases covers.
 *
 * A fifth case is a second switch on the `else` output, which reads perfectly well on a
 * canvas. Chaining branches was the only way to express this at all before this node.
 */
export const SWITCH_CASES = 4;

const caseSchema = z.object({
  operator: z.enum(operators).default("equals"),
  value: z.unknown().optional(),
});

export const switchNode = defineNode({
  type: "core.switch",
  label: "Switch",
  description:
    "Routes the run down one of four outputs by testing a value against each case in order, or down the 'else' output when none match. Use it instead of chaining Branch nodes when a value has several possible destinations.",
  kind: "branch",
  category: "logic",
  outputs: [
    { key: "1", label: "Case 1" },
    { key: "2", label: "Case 2" },
    { key: "3", label: "Case 3" },
    { key: "4", label: "Case 4" },
    { key: "else", label: "Otherwise" },
  ],
  outputShape:
    "{ matched: the 1-based case number or null, branch: the output taken, value: what was tested }.",
  docs: {
    summary:
      "Sends the run one of five ways depending on a value. Cases are tested top to bottom and the first match wins, so put the most specific case first. Anything that matches nothing leaves through 'Otherwise'.",
    accepts: "Nothing — it tests the `value` you configure, which is usually a `{{ }}` reference.",
    examples: [
      {
        title: "Route by priority",
        body: 'value: {{input.priority}} · case 1 equals "urgent" · case 2 equals "high" · else → the normal path',
      },
      {
        title: "Route by size",
        body: "value: {{steps.count.output.value}} · case 1 greater_than 100 · case 2 greater_than 10",
      },
    ],
  },
  // Not agent-callable, for the same reason `core.branch` is not (D19): the whole
  // purpose of this node is the edge the run leaves through, and a tool call has no
  // edge to take. An agent that needs to route says so in its own output.
  agentCallable: false,
  configSchema: z.object({
    value: z.unknown(),
    cases: z.array(caseSchema).max(SWITCH_CASES).default([]),
  }),
  async execute({ config, input, context }) {
    const index = config.cases.findIndex((entry) =>
      evaluate(entry.operator, config.value, entry.value),
    );

    if (index === -1) {
      context.log(
        config.cases.length === 0
          ? "No cases are configured, so the run took the 'else' output."
          : `No case matched, so the run took the 'else' output.`,
      );
      return { output: { matched: null, branch: "else", value: config.value ?? null, input: input ?? null }, branch: "else" };
    }

    const branch = String(index + 1);
    context.log(`Case ${branch} matched, so the run took that output.`);
    return {
      output: { matched: index + 1, branch, value: config.value ?? null, input: input ?? null },
      branch,
    };
  },
});
