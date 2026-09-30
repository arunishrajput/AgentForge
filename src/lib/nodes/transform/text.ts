import { z } from "zod";

import { defineNode, NodeError } from "../types";

const operations = [
  "trim",
  "lowercase",
  "uppercase",
  "title_case",
  "replace",
  "split",
  "slice",
  "prepend",
  "append",
] as const;

const MAX_LENGTH = 200_000;
/** A split that produced this many pieces is a mistake, and 10k rows would wedge a step row. */
const MAX_PIECES = 5_000;

/**
 * The string operations a workflow keeps needing and would otherwise reach for a code
 * node to get — which is exactly the reach this product does not offer
 * (`CLAUDE.md`: no arbitrary code execution, in any form). A fixed, enumerated operator
 * set is the answer: it covers the real cases and there is nothing in it to evaluate.
 *
 * `replace` is deliberately a **literal** replacement, not a regular expression. A
 * user-supplied pattern is a denial-of-service waiting to happen — catastrophic
 * backtracking on a crafted input can hang the step for its whole deadline — and the
 * workflows that want a regex overwhelmingly want a plain substring.
 */
export const textNode = defineNode({
  type: "transform.text",
  label: "Edit text",
  description:
    "Changes a piece of text: trim, change case, replace a substring, split it into a list, cut a section out, or add something to the front or back. Replacement is literal text, not a pattern.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ text: the result, length } for every operation except split, which gives { items: the pieces, count }.",
  docs: {
    summary:
      "One node for the small text jobs that sit between two other nodes — tidying a value before it is compared, cutting a subject line down to size, or splitting a comma-separated field into a real list.",
    accepts: "The previous node's output as text, when `text` is not configured.",
    examples: [
      { title: "Tidy a value before comparing it", body: "operation: trim, then lowercase" },
      { title: 'Split "a, b, c" into a list', body: 'operation: split · separator: ", "' },
      { title: "Cut a subject line to 80 characters", body: "operation: slice · start: 0 · end: 80" },
      { title: "Label a Discord message", body: 'operation: prepend · value: "Daily report: "' },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    /** Defaults to the incoming input, coerced to text. */
    text: z.string().optional(),
    operation: z.enum(operations).default("trim"),
    /** `replace`: what to look for. `split`: the separator. */
    search: z.string().default(""),
    /** `replace`: what to put there. `prepend`/`append`: what to add. */
    value: z.string().default(""),
    /** `slice`, in characters. Negative counts from the end. */
    start: z.number().int().default(0),
    end: z.number().int().optional(),
  }),
  async execute({ config, input, context }) {
    const text = config.text ?? coerce(input);
    if (text.length > MAX_LENGTH) {
      throw new NodeError(
        `That text is ${text.length} characters, over the ${MAX_LENGTH} limit for this node.`,
      );
    }

    if (config.operation === "split") {
      if (config.search === "") {
        throw new NodeError(
          "Edit text cannot split on an empty separator — that would produce one item per character. Set the separator to the text that divides the pieces, such as a comma.",
        );
      }
      const items = text.split(config.search);
      if (items.length > MAX_PIECES) {
        throw new NodeError(
          `Splitting that text produced ${items.length} pieces, over the ${MAX_PIECES} limit.`,
        );
      }
      context.log(`Split into ${items.length} piece(s).`);
      return { output: { items, count: items.length } };
    }

    const result = apply(config.operation, text, config);
    context.log(`${config.operation} produced ${result.length} character(s).`);
    return { output: { text: result, length: result.length } };
  },
});

function apply(
  operation: Exclude<(typeof operations)[number], "split">,
  text: string,
  config: { search: string; value: string; start: number; end?: number },
): string {
  switch (operation) {
    case "trim":
      return text.trim();
    case "lowercase":
      return text.toLowerCase();
    case "uppercase":
      return text.toUpperCase();
    case "title_case":
      // Word-initial letters only. Intentionally naive: this is for a heading, not for
      // a style guide, and a clever version would get "iPhone" and "McDonald" wrong in
      // a way a naive one is not blamed for.
      return text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
    case "replace":
      // `replaceAll` with a string argument is literal — no pattern is ever compiled.
      return config.search === "" ? text : text.replaceAll(config.search, config.value);
    case "slice":
      return config.end === undefined
        ? text.slice(config.start)
        : text.slice(config.start, config.end);
    case "prepend":
      return config.value + text;
    case "append":
      return text + config.value;
  }
}

/** What a non-string input becomes. An object becomes its JSON, never "[object Object]". */
function coerce(input: unknown): string {
  if (typeof input === "string") return input;
  if (input === null || input === undefined) return "";
  if (typeof input === "object") {
    try {
      return JSON.stringify(input) ?? "";
    } catch {
      return "";
    }
  }
  return String(input);
}
