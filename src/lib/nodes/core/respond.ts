import {
  allowedStatus,
  bodySize,
  MAX_RESPONSE_BODY_BYTES,
  respondConfigSchema,
  RESPOND_TYPE,
  type RespondAnswer,
} from "@/lib/triggers/respond";

import { defineNode, NodeError } from "../types";

/**
 * **Answers the webhook or the form that started the run — Phase 40** (D190).
 *
 * The receiver waits for the run, then reads the first Respond step that succeeded and sends *that*
 * instead of the run summary: its status, its allowlisted headers, and a JSON body the engine has
 * already built by lookup (D17) — `{{ }}` references and nothing else; no expression and no code runs.
 * `triggers/respond.ts` holds the allowlist and is checked twice: here, so the author hears at save
 * time, and by the receiver, so a stored step row cannot widen it.
 *
 * **It answers a caller only when one is waiting.** In a run started any other way — by hand, by a
 * schedule, by another workflow's call — the step runs, records what it would have said, and carries
 * on; the answer has nowhere to go. That is what lets a webhook workflow be tried from the editor
 * without a request, and be called by another workflow without breaking.
 *
 * A run that never reaches a Respond — a branch that did not choose it, or a run that went to sleep
 * waiting for a person first — answers with the ordinary run summary, as it always did.
 */
export const respondNode = defineNode({
  type: RESPOND_TYPE,
  label: "Respond",
  description:
    "Sets the reply the caller of this workflow gets back: a status code, a JSON body and headers. " +
    "Use it when the caller needs data back, not just an acknowledgement.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "{ status, headers, body } — the reply that was set.",
  agentCallable: false,
  configSchema: respondConfigSchema,
  docs: {
    summary:
      "Decides what the caller of this workflow is told: a status code, a JSON body made from your data, and a few allowed headers. Without one the caller gets a summary of the run, as before. Only the first Respond to run counts, and it only matters when a request from outside started the run.",
    accepts: "nothing in particular — reference any earlier step with {{steps.<id>.output.x}}",
    examples: [
      { title: "A look-up result", body: 'status 200 · body { "price": "{{steps.fetch.output.price}}" }' },
      { title: "Refuse a caller", body: 'status 422 · body { "error": "That order does not exist" }' },
      { title: "Tell a client to retry", body: "status 503 · headers retry-after: 30" },
    ],
  },
  async execute({ config, context }) {
    if (!allowedStatus(config.status)) {
      throw new NodeError(`A workflow may answer with 200–299 or 400–599, not ${config.status}.`);
    }
    const size = bodySize(config.body);
    if (size > MAX_RESPONSE_BODY_BYTES) {
      throw new NodeError(
        `The response body is ${Math.round(size / 1024)} KB; a workflow may send at most ${MAX_RESPONSE_BODY_BYTES / 1024} KB.`,
      );
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(config.headers)) headers[name.trim().toLowerCase()] = value;

    const answer: RespondAnswer = { status: config.status, headers, body: config.body };
    context.log(
      `Response ready: ${config.status} with ${Object.keys(config.body).length} field(s). It is sent only if a webhook or form started this run.`,
    );
    return { output: answer };
  },
});
