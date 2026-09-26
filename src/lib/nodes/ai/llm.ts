import { z } from "zod";

import { NoProviderKeyError, resolveProvider } from "@/lib/ai/provider";
import { ProviderError } from "@/lib/ai/types";

import { defineNode, NodeError } from "../types";

/**
 * One model call with a templated prompt.
 *
 * The prompt is resolved by the engine before `execute` runs, so `{{input.message}}`
 * and `{{steps.trigger.output.body}}` work here exactly as they do in every other node
 * — and, per D17, they remain lookups. There is no expression language in a prompt any
 * more than in any other config field.
 *
 * Not agent-callable: giving the agent a tool that calls a model would let it spend the
 * user's quota in a loop the iteration cap does not bound, since each call would be one
 * tool call deep.
 */
export const llmNode = defineNode({
  type: "ai.llm",
  label: "LLM",
  description:
    "Sends a prompt to the configured language model and outputs its answer as text. Use it to summarise, rewrite, classify or extract from data produced earlier in the workflow.",
  kind: "action",
  category: "agent",
  outputs: [{ key: null, label: "Out" }],
  agentCallable: false,
  configSchema: z.object({
    prompt: z.string().min(1).max(20_000),
    /** Steers behaviour for the whole call. Optional; the model has a sane default. */
    system: z.string().max(4000).optional(),
    /** Empty means the model chosen in Settings. */
    model: z.string().max(120).optional(),
    temperature: z.number().min(0).max(2).optional(),
    /** Ask for JSON and parse it into `output.json`. */
    json: z.boolean().default(false),
  }),
  async execute({ config, input, context }) {
    const { model, source, selectedModel } = await resolveKey(context.ownerId);
    const modelId = config.model && config.model.length > 0 ? config.model : selectedModel;

    context.log(`Asking ${modelId} (key from ${source}).`);

    let result;
    try {
      result = await model.generate({
        model: modelId,
        system: config.system,
        turns: [{ role: "user", text: config.prompt }],
        temperature: config.temperature,
        json: config.json,
        signal: context.signal,
      });
    } catch (error) {
      throw asNodeError(error);
    }

    if (result.model !== modelId) {
      context.log(`${modelId} was unavailable; ${result.model} answered instead.`, "warn");
    }

    const preview = result.text.length > 400 ? `${result.text.slice(0, 397)}…` : result.text;
    context.log(preview || "The model returned no text.");

    let parsed: unknown = null;
    if (config.json) {
      try {
        parsed = JSON.parse(stripCodeFence(result.text));
      } catch {
        // Not a failure: the text is still there and usable. A silent null would be
        // worse than a visible warning.
        context.log("Asked for JSON but the answer did not parse as JSON.", "warn");
      }
    }

    return {
      output: {
        text: result.text,
        json: parsed,
        model: result.model,
        usage: result.usage,
        input: input ?? null,
      },
    };
  },
});

/**
 * A model sometimes wraps JSON in a markdown fence even when asked not to. Stripping it
 * is not leniency about the contract, it is leniency about punctuation.
 */
export function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return fenced ? fenced[1] : text.trim();
}

export async function resolveKey(ownerId: string) {
  try {
    return await resolveProvider(ownerId);
  } catch (error) {
    if (error instanceof NoProviderKeyError) throw new NodeError(error.message);
    throw error;
  }
}

/**
 * A provider failure becomes a `NodeError` so the user reads the provider's own words
 * on the failed step — "API key not valid", "high demand" — rather than a stack trace.
 */
export function asNodeError(error: unknown): Error {
  if (error instanceof ProviderError) {
    const tried = error.attempts.map((attempt) => attempt.model).join(", ");
    return new NodeError(
      tried ? `${error.message} (tried: ${tried})` : error.message,
    );
  }
  if (error instanceof NodeError) return error;
  return error instanceof Error ? error : new Error(String(error));
}
