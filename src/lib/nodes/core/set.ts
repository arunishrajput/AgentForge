import { z } from "zod";

import { defineNode } from "../types";

/**
 * Builds a JSON object from literals and `{{ }}` references. The workhorse for
 * shaping data between nodes — the engine resolves the templates before this runs,
 * so `execute` only has to hand back what it was given.
 */
export const setNode = defineNode({
  type: "core.set",
  label: "Set data",
  description:
    "Produces a JSON object from the fields you configure. Field values may reference earlier data with {{input.x}} or {{steps.<nodeId>.output.y}}. Use it to reshape or enrich data between nodes.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "the object you configured in `fields`, merged over the incoming input when `merge` is true. Reference a field directly, e.g. output.subject.",
  agentCallable: true,
  configSchema: z.object({
    fields: z.record(z.string(), z.unknown()).default({}),
    /** When true the incoming object is spread underneath the configured fields. */
    merge: z.boolean().default(false),
  }),
  async execute({ config, input }) {
    if (config.merge && input && typeof input === "object" && !Array.isArray(input)) {
      return { output: { ...(input as Record<string, unknown>), ...config.fields } };
    }
    return { output: config.fields };
  },
});
