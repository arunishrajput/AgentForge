import { z } from "zod";

import { defineNode, NodeError } from "../types";

import { compareValues, incomingArray, readPath } from "./shared";

const operations = ["count", "sum", "average", "min", "max", "join", "first", "last"] as const;

type Operation = (typeof operations)[number];

/**
 * Reduce a list to a single value.
 *
 * The arithmetic operations skip anything that is not a number rather than coercing
 * it. `Number(null)` is 0 and `Number("")` is 0 — summing a column with three blanks
 * would silently claim three zeroes, and averaging it would divide by a count that
 * includes them. `skipped` on the output says how many were ignored, so a wrong-looking
 * total is explicable from the run log instead of being a mystery.
 */
export const aggregateNode = defineNode({
  type: "transform.aggregate",
  label: "Summarise list",
  description:
    "Reduces a list to one value: count, sum, average, min, max, join, first or last. Set field to a property inside each item, such as 'amount', or leave it empty to use the items themselves.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ value: the result, operation, count: how many items came in, skipped: how many were ignored because they were not numbers }. Use output.value.",
  docs: {
    summary:
      "Turns a whole list into a single number or string — how many, how much, the biggest, or everything joined into one line of text. Non-numeric entries are skipped by the arithmetic operations rather than counted as zero, and the output says how many were skipped.",
    accepts: "A list — the previous node's output, or its `items` property.",
    examples: [
      { title: "Total revenue", body: "operation: sum · field: amount" },
      { title: "How many open issues", body: "operation: count" },
      { title: "One line for a Discord message", body: 'operation: join · field: title · separator: ", "' },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    items: z.array(z.unknown()).optional(),
    operation: z.enum(operations).default("count"),
    field: z.string().trim().default(""),
    /** `join` only. */
    separator: z.string().default(", "),
  }),
  async execute({ config, input, context }) {
    const items = incomingArray(config.items, input, "Summarise list");
    const values = items.map((item) => readPath(item, config.field));

    const { value, skipped } = reduce(config.operation, values, config.separator);

    context.log(
      `${config.operation} over ${items.length} item(s)` +
        (skipped > 0 ? `, skipping ${skipped} non-numeric value(s).` : "."),
    );

    return { output: { value, operation: config.operation, count: items.length, skipped } };
  },
});

function reduce(
  operation: Operation,
  values: readonly unknown[],
  separator: string,
): { value: unknown; skipped: number } {
  switch (operation) {
    case "count":
      return { value: values.length, skipped: 0 };
    case "first":
      return { value: values.length === 0 ? null : (values[0] ?? null), skipped: 0 };
    case "last":
      return { value: values.length === 0 ? null : (values[values.length - 1] ?? null), skipped: 0 };
    case "join":
      return {
        value: values
          .filter((entry) => entry !== null && entry !== undefined)
          .map((entry) => (typeof entry === "object" ? JSON.stringify(entry) : String(entry)))
          .join(separator),
        skipped: values.filter((entry) => entry === null || entry === undefined).length,
      };
    case "min":
    case "max": {
      const present = values.filter((entry) => entry !== null && entry !== undefined);
      if (present.length === 0) return { value: null, skipped: values.length };
      const sign = operation === "min" ? -1 : 1;
      let best = present[0];
      for (const entry of present.slice(1)) {
        if (compareValues(entry, best) * sign > 0) best = entry;
      }
      return { value: best ?? null, skipped: values.length - present.length };
    }
    case "sum":
    case "average": {
      const numbers = values.map(toNumber).filter((entry): entry is number => entry !== null);
      const skipped = values.length - numbers.length;
      const total = numbers.reduce((carry, entry) => carry + entry, 0);
      if (operation === "sum") return { value: total, skipped };
      if (numbers.length === 0) {
        throw new NodeError(
          "Summarise list cannot average a list with no numbers in it. Check the field name — nothing in the list parsed as a number.",
        );
      }
      return { value: total / numbers.length, skipped };
    }
  }
}

/** `null` for anything not meaningfully numeric — see the note on the node. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
