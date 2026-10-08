import { z } from "zod";

import { defineNode, NodeError } from "../types";

/**
 * Starts a run from a button press or an API call. The payload supplied to the
 * trigger becomes the first node's input, so a workflow can be exercised with
 * real data before a webhook or a schedule exists (Phase 8).
 *
 * **Phase 31 — declared input fields.** A workflow somebody runs by hand usually wants the
 * same few values every time, and a JSON box is a poor way to ask for them. So the trigger may
 * declare its fields — a name, a type, whether it is required — and the canvas renders a form
 * from them instead of the raw box (`CONTRACT.md` → *Manual trigger input*).
 *
 * The declaration is **enforced here, at run time**, not only by the form: a run started from
 * the API with a required field missing fails at its first step with a message naming it,
 * before any node after it sends anything. The same rule the webhook trigger's
 * `requiredFields` follows, one step later because a manual run has no receiver in front of it.
 */
export const MANUAL_FIELD_TYPES = ["text", "number", "boolean", "json"] as const;
export type ManualFieldType = (typeof MANUAL_FIELD_TYPES)[number];
export const MAX_MANUAL_FIELDS = 20;

export const manualFieldSchema = z.object({
  name: z.string().trim().min(1).max(64),
  type: z.enum(MANUAL_FIELD_TYPES).default("text"),
  required: z.boolean().default(false),
});
export type ManualField = z.infer<typeof manualFieldSchema>;

/** A value counts as given when it is present and, for text, not blank. */
function given(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim() !== "";
}

function fits(type: ManualFieldType, value: unknown): boolean {
  switch (type) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "json":
      return true;
  }
}

const NOUN: Record<ManualFieldType, string> = {
  text: "text",
  number: "a number",
  boolean: "true or false",
  json: "JSON",
};

/**
 * What is wrong with `input` against the declared fields, in words, or null. Exported for
 * the canvas, which runs the same check before it sends anything.
 */
export function checkManualInput(fields: readonly ManualField[], input: unknown): string | null {
  if (fields.length === 0) return null;
  const values =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const missing = fields.filter((field) => field.required && !given(values[field.name]));
  if (missing.length > 0) {
    const names = missing.map((field) => `"${field.name}"`).join(", ");
    return `This workflow needs ${missing.length === 1 ? "the field" : "the fields"} ${names} to run.`;
  }

  const wrong = fields.find((field) => given(values[field.name]) && !fits(field.type, values[field.name]));
  if (wrong) return `"${wrong.name}" should be ${NOUN[wrong.type]}.`;

  return null;
}

export const manualTrigger = defineNode({
  type: "core.manual_trigger",
  label: "Manual trigger",
  description:
    "Starts the workflow when a person runs it. Any JSON supplied at trigger time becomes the output of this node.",
  kind: "trigger",
  category: "trigger",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "whatever JSON the run was started with. Reach its fields with {{trigger.<field>}}.",
  docs: {
    summary:
      "Starts the workflow when somebody presses Run, with whatever you hand it as the first node's input. Declare fields and the canvas asks for them with a form — a required field that is missing stops the run before anything else happens.",
    accepts: "the values typed into the run form, or JSON sent with the run",
    examples: [
      {
        title: "Ask for a topic and an audience",
        body: 'fields: [{ name: "topic", type: "text", required: true }, { name: "audience", type: "text" }] — then {{trigger.topic}}',
      },
    ],
  },
  // Loose, as it always was: a workflow saved with stray keys here must not stop parsing.
  configSchema: z
    .object({
      fields: z.array(manualFieldSchema).max(MAX_MANUAL_FIELDS).default([]),
    })
    .loose(),
  async execute({ config, input, context }) {
    const problem = checkManualInput(config.fields, input);
    if (problem) throw new NodeError(problem);
    context.log("Run started manually.");
    return { output: input ?? {} };
  },
});
