import { z } from "zod";

import { defineNode } from "../types";

import { identityKey, incomingArray, readPath } from "./shared";

/**
 * Drop repeats, keeping the first of each. Order is preserved, which matters when
 * this follows a sort.
 */
export const uniqueNode = defineNode({
  type: "transform.unique",
  label: "Remove duplicates",
  description:
    "Removes repeated items from a list, keeping the first of each. Set field to compare a property inside each item, such as 'email', or leave it empty to compare whole items.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ items: the list with repeats removed, count: how many remain, removed: how many were dropped, total: how many came in }.",
  docs: {
    summary:
      "Keeps the first occurrence of each distinct item and drops the rest. Whole objects are compared by their contents, not by identity, so two separately built objects with the same fields count as duplicates.",
    accepts: "A list — the previous node's output, or its `items` property.",
    examples: [
      { title: "One row per person", body: "field: email" },
      { title: "Distinct tags", body: "field: (empty)" },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    items: z.array(z.unknown()).optional(),
    field: z.string().trim().default(""),
  }),
  async execute({ config, input, context }) {
    const items = incomingArray(config.items, input, "Remove duplicates");
    const seen = new Set<string>();
    const kept: unknown[] = [];

    for (const item of items) {
      const key = identityKey(readPath(item, config.field));
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(item);
    }

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
