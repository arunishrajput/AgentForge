import { z } from "zod";

import { defineNode } from "../types";

import { compareValues, incomingArray, readPath } from "./shared";

/**
 * Order a list, optionally by a field inside each item.
 *
 * Numbers sort as numbers. `Array.prototype.sort`'s default compares stringified
 * values, which puts 10 before 9, and that is a bug report every single time.
 */
export const sortNode = defineNode({
  type: "transform.sort",
  label: "Sort list",
  description:
    "Orders a list. Set field to a property inside each item, such as 'score' or 'created_at', or leave it empty to sort the items themselves. Numbers sort numerically and text sorts alphabetically.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "{ items: the list in order, count: how many }.",
  docs: {
    summary:
      "Puts a list in order. Values that look like numbers are compared as numbers, so 10 comes after 9 rather than before it. Items missing the field sort to the end, which keeps a half-populated list readable.",
    accepts: "A list — the previous node's output, or its `items` property.",
    examples: [
      { title: "Highest score first", body: "field: score · direction: desc" },
      { title: "Oldest first", body: "field: created_at · direction: asc" },
      { title: "Plain strings, A–Z", body: "field: (empty) · direction: asc" },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    items: z.array(z.unknown()).optional(),
    field: z.string().trim().default(""),
    direction: z.enum(["asc", "desc"]).default("asc"),
  }),
  async execute({ config, input, context }) {
    const items = incomingArray(config.items, input, "Sort list");
    const sign = config.direction === "desc" ? -1 : 1;

    // `incomingArray` already copied, so this sorts a list nobody else holds.
    items.sort(
      (left, right) =>
        sign * compareValues(readPath(left, config.field), readPath(right, config.field)),
    );

    context.log(`Sorted ${items.length} item(s) ${config.direction}.`);

    return { output: { items, count: items.length } };
  },
});
