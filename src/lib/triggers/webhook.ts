import { randomBytes } from "node:crypto";

import { getNode } from "@/lib/nodes";
import { webhookTrigger } from "@/lib/nodes/core/webhook-trigger";
import type { WorkflowGraph, WorkflowNode } from "@/lib/workflow/graph";

/**
 * The webhook trigger's token, URL and payload rules — CONTRACT.md → "Trigger shapes".
 *
 * Nothing here touches the database, so the payload rules are asserted directly
 * rather than through an HTTP round trip (the same reason D18 keeps the engine's
 * recorder an argument).
 */

/**
 * 24 bytes, base64url: 192 bits of CSPRNG output in 32 URL-safe characters.
 *
 * "Unguessable" (PRD.md → Triggers) means exactly this — not a sequential id and not
 * a hash of the workflow id, because a hash of a known input is a guess away from
 * being the input. This endpoint is unauthenticated by necessity: the token is the
 * whole of its access control.
 */
export function mintWebhookToken(): string {
  return randomBytes(24).toString("base64url");
}

/** What a token must look like before the database is asked about it. */
export const WEBHOOK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * A cap on what the receiver will read. A webhook body becomes the trigger's output,
 * is written to the run row and to a step row, and is interpolated into every
 * `{{trigger.x}}` downstream — so an unbounded body is an unbounded write to Neon
 * from an unauthenticated endpoint.
 */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export function webhookUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/webhook/${token}`;
}

export function webhookTriggerNode(graph: WorkflowGraph): WorkflowNode | undefined {
  return graph.nodes.find((node) => node.type === webhookTrigger.type);
}

/**
 * The trigger's `requiredFields`, parsed through the node's own schema so the
 * receiver and the canvas cannot disagree about what the config means. An
 * unparseable config yields no requirements rather than throwing: the graph is
 * already reported as `invalid_config` by validation, and the run will fail on the
 * node itself, which is a better error than a 400 from the receiver.
 */
export function webhookRequiredFields(node: WorkflowNode): string[] {
  const definition = getNode(webhookTrigger.type);
  const parsed = definition?.configSchema.safeParse(node.config ?? {});
  if (!parsed?.success) return [];
  return (parsed.data as { requiredFields: string[] }).requiredFields;
}

export type PayloadResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string; missing?: string[] };

/**
 * Validates a raw request body against the trigger's declared requirements.
 *
 * Runs before a run row is created, so a malformed call costs one indexed select and
 * nothing else — no run history, no model call. An absent body is `{}` rather than an
 * error: a webhook that only needs to say "something happened" is legitimate.
 */
export function readWebhookPayload(raw: string, requiredFields: string[]): PayloadResult {
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return {
      ok: false,
      message: `The request body is larger than the ${MAX_WEBHOOK_BODY_BYTES / 1024} KB limit.`,
    };
  }

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, body: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: "The request body must be valid JSON." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      message:
        "The request body must be a JSON object, so that its fields are reachable as {{trigger.field}}.",
    };
  }

  const body = parsed as Record<string, unknown>;
  const missing = requiredFields.filter(
    (field) => !Object.hasOwn(body, field) || body[field] === undefined,
  );

  if (missing.length > 0) {
    return {
      ok: false,
      message: `The request body is missing required field(s): ${missing.join(", ")}.`,
      missing,
    };
  }

  return { ok: true, body };
}
