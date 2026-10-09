import { z } from "zod";

import { defineNode } from "../types";

const MESSAGE_LIMIT = 2000;

/**
 * **A message that resolved to data is logged as data — Phase 34.** A config value that is *only*
 * a `{{ }}` reference keeps the type of what it reaches (`template.ts`), so "log the result" —
 * `"{{steps.sort.output.items}}"` — arrives as a list, and the Log node refused it, failing the
 * run at its last step. Logging the list is what was asked for, so a non-string value becomes its
 * JSON, cut to the limit rather than failing on it. `null` passes through and is refused: a
 * reference that reached nothing is a mistake to see, not an empty line. Text a person typed keeps
 * its limit, and the JSON Schema — the canvas form, the generator's catalogue — still says string.
 */
function asText(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "string") return value;
  const text = JSON.stringify(value) ?? String(value);
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text;
}

/**
 * Writes a line to the run log and passes its input straight through. Exists so a
 * workflow can be made observable without changing its shape — the line lands on
 * the step record and streams to the UI from Phase 5.
 */
export const logNode = defineNode({
  type: "core.log",
  label: "Log message",
  description:
    "Writes a message to the run log and passes its input through unchanged. Use it to record what happened at a point in the workflow.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "its input, unchanged.",
  agentCallable: true,
  configSchema: z.object({
    message: z.preprocess(asText, z.string().max(MESSAGE_LIMIT).default("")),
    level: z.enum(["info", "warn", "error"]).default("info"),
  }),
  async execute({ config, input, context }) {
    context.log(config.message, config.level);
    return { output: input ?? null };
  },
});
