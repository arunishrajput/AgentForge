import { z } from "zod";

import { ApiError } from "@/lib/api";
import type { WorkspaceScope } from "@/lib/workspace/scope";
import {
  deleteCredential,
  getCredential,
  LLM_CREDENTIAL_KIND,
  putCredential,
  readSecret,
  updateCredentialMetadata,
} from "@/lib/credentials";

import { DEFAULT_MODEL, geminiModel } from "./gemini";
import { modelHealthSnapshot, type ModelHealth } from "./health";
import { describeModelCheckFailure, ProviderError, type ModelInfo } from "./types";

/**
 * Provider settings — CONTRACT.md → "Credential storage shape". **Write-only.**
 *
 * `describeSettings` is the only shape that reaches the client and it carries no part of
 * the key. `configured` is the whole answer to "is a key stored": there is no masked
 * tail, because a masked tail is still key material and the rule is that none of it
 * leaves the server.
 */

export const providerSettingsSchema = z
  .object({
    /** Absent means "leave the stored key alone"; present means replace it. */
    apiKey: z.string().min(10).max(400).optional(),
    model: z.string().min(1).max(120).optional(),
  })
  .refine((body) => body.apiKey !== undefined || body.model !== undefined, {
    message: "Send an apiKey, a model, or both.",
  });

export type ProviderSettingsInput = z.infer<typeof providerSettingsSchema>;

export interface ProviderSettings {
  provider: "google";
  /** Whether this workspace has its own key stored. */
  configured: boolean;
  /** The model that will be used when a node does not name one. */
  model: string;
  defaultModel: string;
  /**
   * Whether a run would use the user's key or the server's development fallback.
   * Surfaced so a demo cannot silently run on the wrong one.
   */
  source: "user" | "environment" | "none";
  updatedAt: string | null;
  /**
   * What this instance has actually observed of each model, newest state first.
   *
   * Phase 13 added it because the Phase 12 incident was invisible: a model had stopped
   * answering tool calls and the only trace was one warning line buried in a step log.
   * Empty on a cold instance, which is honest — health here is observed, never
   * configured, and an instance that has made no calls knows nothing yet.
   */
  health: ModelHealth[];
}

export async function readSettings(scope: WorkspaceScope): Promise<ProviderSettings> {
  const credential = await getCredential({ scope, kind: LLM_CREDENTIAL_KIND });
  const configured = credential !== null;
  const model =
    typeof credential?.metadata.model === "string" && credential.metadata.model.length > 0
      ? credential.metadata.model
      : DEFAULT_MODEL;

  return {
    provider: "google",
    configured,
    model,
    defaultModel: DEFAULT_MODEL,
    source: configured
      ? "user"
      : process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? "environment"
        : "none",
    updatedAt: credential?.updatedAt ?? null,
    health: modelHealthSnapshot(),
  };
}

/**
 * Saves the key and/or the model.
 *
 * Both are **proved against the provider before they are stored**, and proved in
 * different ways, because the provider distinguishes them:
 *
 *   • a key is proved with one `models.list` call;
 *   • a model is proved with one real, tiny `generateContent` call.
 *
 * The second is not belt-and-braces. `models.list` on a working key returns
 * `gemini-2.5-flash`, and calling it answers **404 "no longer available to new
 * users"** (measured 2026-09-26). So the catalogue lists models a key cannot
 * actually run, and validating a choice against the list would happily store one.
 * Found by running this: an unvalidated model name was stored, and then every
 * subsequent run failed with a 404 from inside the engine.
 *
 * The cost of not doing this is paid at the worst moment — a workflow that fails
 * mid-run on demo day, with the real cause three layers down in a step error.
 */
export async function writeSettings(
  scope: WorkspaceScope,
  input: ProviderSettingsInput,
): Promise<ProviderSettings> {
  if (input.apiKey) {
    await verifyKey(input.apiKey);

    const existing = await getCredential({ scope, kind: LLM_CREDENTIAL_KIND });
    const model = input.model ?? existing?.metadata.model ?? DEFAULT_MODEL;
    if (input.model) await verifyModel(input.apiKey, input.model);

    await putCredential({
      scope,
      kind: LLM_CREDENTIAL_KIND,
      secret: input.apiKey,
      metadata: { model },
    });

    return readSettings(scope);
  }

  const secret = await readSecret({ scope, kind: LLM_CREDENTIAL_KIND });
  if (!secret) {
    throw new ApiError(
      "invalid_request",
      "Add an API key before choosing a model — the model list comes from the key.",
    );
  }

  await verifyModel(secret, input.model!);

  const updated = await updateCredentialMetadata({
    scope,
    kind: LLM_CREDENTIAL_KIND,
    metadata: { model: input.model },
  });

  if (!updated) {
    throw new ApiError("not_found", "No stored key to attach a model to.");
  }

  return readSettings(scope);
}

/**
 * Replace the stored key — **Phase 21's rotation path for `llm.google`.**
 *
 * The difference from `writeSettings` with an `apiKey` is one refusal, and it is the point:
 * **rotation requires that something was there to rotate.** Saving a key into a workspace
 * that has none is a first connection, and calling it a rotation would make the vault claim
 * a key had been replaced when it had never existed — the one number in the vault somebody
 * might act on.
 *
 * The chosen model is carried across deliberately. A rotation replaces a secret and must not
 * quietly reset a setting beside it, or an operator rotating a key on a Friday discovers on
 * Monday that every agent node is on a different model.
 */
export async function rotateProviderKey(
  scope: WorkspaceScope,
  apiKey: string,
): Promise<ProviderSettings> {
  const existing = await getCredential({ scope, kind: LLM_CREDENTIAL_KIND });
  if (!existing) {
    throw new ApiError(
      "not_found",
      "There is no provider key in this workspace to rotate. Add one first.",
    );
  }

  await verifyKey(apiKey);
  const model = existing.metadata.model ?? DEFAULT_MODEL;
  await verifyModel(apiKey, model);

  await putCredential({
    scope,
    kind: LLM_CREDENTIAL_KIND,
    secret: apiKey,
    metadata: { model },
    event: "rotated",
  });

  return readSettings(scope);
}

export async function clearSettings(scope: WorkspaceScope): Promise<ProviderSettings> {
  await deleteCredential({ scope, kind: LLM_CREDENTIAL_KIND });
  return readSettings(scope);
}

/**
 * The models a key can actually use, live from the provider. Never a hardcoded list:
 * `gemini-2.5-flash` answered 404 "no longer available to new users" on 2026-09-26, so a
 * baked-in catalogue would offer models that cannot run.
 */
export async function listModelsFor(
  scope: WorkspaceScope,
): Promise<{ models: ModelInfo[]; source: "user" | "environment" }> {
  const { resolveProvider } = await import("./provider");
  const { model, source } = await resolveProvider(scope);
  try {
    return { models: await model.listModels(), source };
  } catch (error) {
    throw asApiError(error);
  }
}

async function verifyKey(apiKey: string): Promise<ModelInfo[]> {
  try {
    return await geminiModel({ apiKey }).listModels();
  } catch (error) {
    throw asApiError(error);
  }
}

/**
 * One real call, on that model and no other. `fallbacks: []` matters: with the normal
 * chain a broken choice would be answered by a working model and then stored as if it
 * worked. `ignoreHealth` matters for the same reason from the other direction — the
 * circuit breaker would otherwise reorder the chain away from the very model under
 * test, and a deliberate probe of a known-bad model would then count against it twice.
 */
async function verifyModel(apiKey: string, model: string): Promise<void> {
  try {
    await geminiModel({ apiKey, fallbacks: [], ignoreHealth: true }).generate({
      model,
      turns: [{ role: "user", text: "Reply with OK." }],
      temperature: 0,
      maxOutputTokens: 1000,
    });
  } catch (error) {
    throw modelCheckError(model, error);
  }
}

/** The verdict from `describeModelCheckFailure`, in HTTP terms. */
function modelCheckError(model: string, error: unknown): ApiError {
  const verdict = describeModelCheckFailure(model, error);
  if (verdict.kind === "temporary") return new ApiError("conflict", verdict.message);
  if (verdict.kind === "rejected") return new ApiError("invalid_request", verdict.message);
  return asApiError(error);
}

/**
 * The provider's own words reach the user — "API key not valid", "prepayment credits are
 * depleted" — because those are the messages that tell them what to do. The key itself
 * is never echoed.
 */
function asApiError(error: unknown): ApiError {
  if (error instanceof ProviderError) {
    return new ApiError(
      error.retryable ? "conflict" : "invalid_request",
      `The provider rejected this key: ${error.message}`,
    );
  }
  return new ApiError("internal", "Could not reach the provider.");
}
