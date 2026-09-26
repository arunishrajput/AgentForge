import { z } from "zod";

import { HttpTargetError } from "@/lib/integrations/guard";
import { IntegrationError } from "@/lib/integrations/net";

import { NodeError } from "../types";

/**
 * The two pieces every integration node repeats, kept in one place so a fifth
 * integration is a node file and nothing else.
 */

/**
 * An integration failure becomes a `NodeError`, which is how the service's own words
 * — "Discord refused the message: Unknown Webhook", "Requested entity was not found"
 * — reach the failed step instead of a stack trace. Same rule as `ai/llm.ts` applies
 * to provider errors.
 */
export function asNodeError(error: unknown): Error {
  if (error instanceof IntegrationError || error instanceof HttpTargetError) {
    return new NodeError(error.message);
  }
  if (error instanceof NodeError) return error;
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * A string→string map that also accepts the map written as JSON.
 *
 * The coercion exists for the **agent**, not for the user. Gemini's schema subset
 * cannot express an open-ended object, so `toGeminiSchema` degrades one to
 * `{ type: "string", description: "A JSON object, given as a string." }` — the model
 * then sends `"{\"x\":\"y\"}"`, the node's own schema rejects it as not-an-object,
 * and the tool call is wasted on a round trip that corrects itself. Accepting both
 * makes the model's first attempt work.
 *
 * The preprocess **must not throw.** A throwing `preprocess` escapes `safeParse`
 * entirely (measured against zod 4.6.5) rather than producing an issue, which would
 * turn a malformed argument into an unhandled 500. Returning the value unchanged lets
 * the inner schema report it properly.
 *
 * Costs one thing worth knowing: the emitted JSON Schema loses its `default`, so
 * `defaultConfig()` does not seed the field on a freshly added node. Harmless — the
 * field is optional and the runtime default still applies.
 */
export function jsonRecord(description: string) {
  return z
    .preprocess((value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed.length === 0) return {};
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }, z.record(z.string(), z.string()))
    .describe(description)
    .default({});
}

/** A cell in a spreadsheet row, or a scalar the template resolver produced. */
export const cellValue = z.union([z.string(), z.number(), z.boolean()]);
