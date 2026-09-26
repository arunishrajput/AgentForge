import { z } from "zod";

import { defineNode } from "../types";

/**
 * Starts a run when something POSTs to this workflow's webhook URL.
 *
 * The URL's token is **not** in this config. It belongs to the workflow row, minted
 * server-side (CONTRACT.md → "Trigger shapes"). Three reasons, all load-bearing:
 * graph validation already allows exactly one trigger per workflow, so a per-node
 * token would buy nothing; a secret in the graph would be minted either by the model
 * that writes the graph (D40 — the system supplies what a model cannot) or by the
 * browser; and a token on the row is one indexed lookup for the receiver with nothing
 * to keep in sync with the graph.
 *
 * `requiredFields` is what makes "validates its payload" (PRD.md → Triggers) a real
 * property rather than a claim: the receiver rejects a body missing any of them with
 * a 400 naming them, before a run row exists and before any model call is paid for.
 */
export const MAX_REQUIRED_FIELDS = 10;

export const webhookTrigger = defineNode({
  type: "core.webhook_trigger",
  label: "Webhook trigger",
  description:
    "Starts the workflow when an external service POSTs JSON to this workflow's unique webhook URL. " +
    "The posted JSON body becomes the output of this node. Use it when the request says the workflow " +
    "starts from an incoming call, a form submission, or another system's event.",
  kind: "trigger",
  category: "trigger",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "the JSON object that was POSTed. Reach its fields with {{trigger.<field>}}, e.g. {{trigger.message}}.",
  configSchema: z.object({
    /**
     * Top-level keys the body must contain. Not a JSON Schema: a shape language here
     * would be a second config dialect for the user and the model to get wrong, and
     * "this key is missing" is the only payload error worth a 400 at MVP.
     */
    requiredFields: z
      .array(z.string().trim().min(1).max(64))
      .max(MAX_REQUIRED_FIELDS)
      .default([]),
  }),
  async execute({ input, context }) {
    const keys =
      input && typeof input === "object" && !Array.isArray(input)
        ? Object.keys(input as Record<string, unknown>)
        : [];
    context.log(
      keys.length > 0
        ? `Webhook received with ${keys.length} field(s): ${keys.join(", ")}.`
        : "Webhook received with an empty body.",
    );
    return { output: input ?? {} };
  },
});
