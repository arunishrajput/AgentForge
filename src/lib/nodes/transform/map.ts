import { z } from "zod";

import { defineNode, NodeError } from "../types";

import { incomingArray, readPath } from "./shared";

const MAX_FIELDS = 32;

/**
 * Reshape every item of a list into a new object.
 *
 * `fields` maps an output key to a **path inside the item** — `{ who: "user.name" }`
 * turns `[{ user: { name: "Ada" } }]` into `[{ who: "Ada" }]`.
 *
 * Why paths and not `{{ }}` templates: the engine resolves templates once, before
 * `execute` runs, against the run's steps — it has no notion of "the current item", so
 * `{{item.user.name}}` would resolve to nothing here and the node would silently emit a
 * list of empty objects. A path is evaluated per item by this node, which is the only
 * place that knows what an item is.
 */
export const mapNode = defineNode({
  type: "transform.map",
  label: "Reshape list",
  description:
    "Rebuilds every item of a list into a new object with the fields you name. Each field's value is a path inside the item, such as 'name' or 'user.email'. Use it to flatten or rename data before sending it somewhere else.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ items: the rebuilt objects, count: how many }. Each item has exactly the keys named in fields.",
  docs: {
    summary:
      "Turns a list of one shape into a list of another. Name the keys you want out and, for each, the path to read it from inside the item. Anything a path does not find comes out as null rather than missing, so every item has the same keys.",
    accepts: "A list — the previous node's output, or its `items` property.",
    examples: [
      {
        title: "Flatten a nested API response",
        body: 'fields: { "name": "user.name", "email": "user.email", "id": "id" }',
      },
      {
        title: "Keep two columns for a spreadsheet",
        body: 'fields: { "title": "title", "url": "html_url" }',
      },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    items: z.array(z.unknown()).optional(),
    /** Output key → dotted path inside each item. */
    fields: z.record(z.string(), z.string()).default({}),
  }),
  async execute({ config, input, context }) {
    const entries = Object.entries(config.fields);
    if (entries.length === 0) {
      throw new NodeError(
        "Reshape list has no fields configured, so every item would come out empty. Add at least one field naming what to keep.",
      );
    }
    if (entries.length > MAX_FIELDS) {
      throw new NodeError(`Reshape list takes at most ${MAX_FIELDS} fields.`);
    }

    const items = incomingArray(config.items, input, "Reshape list");
    const mapped = items.map((item) => {
      const next: Record<string, unknown> = {};
      for (const [key, path] of entries) {
        // `?? null` so the key is always present. An absent key would make the list
        // ragged, and a spreadsheet or a JSON consumer downstream would see columns
        // appear and disappear row by row.
        next[key] = readPath(item, path) ?? null;
      }
      return next;
    });

    context.log(`Reshaped ${mapped.length} item(s) into ${entries.length} field(s).`);

    return { output: { items: mapped, count: mapped.length } };
  },
});
