import { z } from "zod";

import { evaluate, operators } from "../core/branch";
import { defineNode } from "../types";

import { incomingArray, readPath } from "./shared";

/**
 * Keep the items of a list that pass one test.
 *
 * The test is `core.branch`'s, imported rather than reimplemented — a filter whose
 * `contains` meant something different from a branch's `contains` would be a trap.
 * What it adds is `field`: the test runs against a path *inside* each item, so a list
 * of objects is filterable without a loop around a branch node.
 */
export const filterNode = defineNode({
  type: "transform.filter",
  label: "Filter list",
  description:
    "Keeps only the items of a list that pass a test, and drops the rest. Set field to a property inside each item (for example 'status' or 'user.email') or leave it empty to test each item itself. Reads the incoming list, or the items you configure.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ items: the items that passed, count: how many passed, removed: how many were dropped, total: how many came in }. Use output.items to pass the list on.",
  docs: {
    summary:
      "Narrows a list down to the items you care about. Every item is tested the same way a Branch node tests a single value, so the operators behave identically — what this adds is the ability to look at a property inside each item.",
    accepts:
      "A list — either the previous node's output when that is a list, or its `items` property when it is one of the other list nodes.",
    examples: [
      { title: "Only the open issues", body: "field: state · operator: equals · value: open" },
      { title: "Rows that actually have an email", body: "field: user.email · operator: is_not_empty" },
      { title: "Scores above the bar", body: "field: score · operator: greater_than · value: 80" },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    items: z.array(z.unknown()).optional(),
    /** A dotted path inside each item. Empty tests the item itself. */
    field: z.string().trim().default(""),
    operator: z.enum(operators).default("equals"),
    value: z.unknown().optional(),
  }),
  async execute({ config, input, context }) {
    const items = incomingArray(config.items, input, "Filter list");
    const kept = items.filter((item) =>
      evaluate(config.operator, readPath(item, config.field), config.value),
    );

    context.log(`Kept ${kept.length} of ${items.length} item(s).`);

    return {
      output: {
        items: kept,
        count: kept.length,
        removed: items.length - kept.length,
        total: items.length,
      },
    };
  },
});
