import { z } from "zod";

import { defineNode, NodeError } from "../types";

/** A stringify that refuses to produce a payload large enough to wedge a step row. */
const MAX_TEXT = 200_000;

/**
 * Parse a JSON string into data, or render data back into a string.
 *
 * The parse direction is the one that earns this node its place: an HTTP node that
 * received `text/plain`, a webhook body posted as a string, or a model asked for JSON
 * that answered with JSON *in* a string all leave the workflow holding text that every
 * downstream `{{ }}` reference then fails to read into.
 */
export const jsonNode = defineNode({
  type: "transform.json",
  label: "JSON",
  description:
    "Converts between JSON text and data. Use parse when a previous node handed you a string that contains JSON, and stringify when something downstream needs the data as text.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "parse: { value: the parsed data, type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' }. stringify: { text: the JSON text, length }.",
  docs: {
    summary:
      "Moves data across the line between text and structure. Parse turns a string of JSON into something the rest of the workflow can reference into; stringify does the reverse for a node that wants text.",
    accepts:
      "The previous node's output when `value` is not configured — a string for parse, anything for stringify.",
    examples: [
      { title: "An API that returned text/plain", body: "mode: parse · value: {{steps.fetch.output.body}}" },
      { title: "A JSON body for an HTTP request", body: "mode: stringify · pretty: false" },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    mode: z.enum(["parse", "stringify"]).default("parse"),
    /** Defaults to the incoming input. */
    value: z.unknown().optional(),
    /** `stringify` only: two-space indentation. */
    pretty: z.boolean().default(false),
  }),
  async execute({ config, input, context }) {
    const subject = config.value === undefined ? input : config.value;

    if (config.mode === "parse") {
      if (typeof subject !== "string") {
        // Already structured. Saying so beats throwing: a workflow that sometimes gets
        // `application/json` and sometimes `text/plain` from the same endpoint should
        // not fail on the well-behaved half.
        context.log("Input was already structured data, so there was nothing to parse.");
        return { output: { value: subject ?? null, type: typeName(subject) } };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(subject);
      } catch (error) {
        throw new NodeError(
          `That text is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      context.log(`Parsed ${subject.length} character(s) of JSON.`);
      return { output: { value: parsed, type: typeName(parsed) } };
    }

    let text: string;
    try {
      text = JSON.stringify(subject ?? null, null, config.pretty ? 2 : 0) ?? "null";
    } catch (error) {
      throw new NodeError(
        `That value cannot be turned into JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (text.length > MAX_TEXT) {
      throw new NodeError(
        `The JSON would be ${text.length} characters, over the ${MAX_TEXT} limit. Reduce the data before this node — Reshape list and Filter list are the usual way.`,
      );
    }

    context.log(`Rendered ${text.length} character(s) of JSON.`);
    return { output: { text, length: text.length } };
  },
});

function typeName(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}
