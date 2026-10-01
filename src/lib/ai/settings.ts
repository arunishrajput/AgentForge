import { z } from "zod";

import { ApiError } from "@/lib/api";
import {
  deleteCredential,
  getCredential,
  putCredential,
  readSecret,
  updateCredentialMetadata,
} from "@/lib/credentials";
import { readWorkspaceProvider, writeWorkspaceProvider } from "@/lib/workspace/store";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { modelHealthSnapshot, type ModelHealth } from "./health";
import {
  describeProviders,
  PROVIDERS,
  providerById,
  type LlmProvider,
  type ProviderDescription,
} from "./providers";
import { describeModelCheckFailure, ProviderError, type ModelInfo } from "./types";

/**
 * Provider settings — CONTRACT.md → "Credential storage shape". **Write-only.**
 *
 * `describeSettings` is the only shape that reaches the client and it carries no part of
 * the key. `configured` is the whole answer to "is a key stored": there is no masked
 * tail, because a masked tail is still key material and the rule is that none of it
 * leaves the server.
 *
 * ## Two providers — Phase 23D
 *
 * The shape gained one list and one scalar: `providers` (what exists, what each one has
 * stored) and `provider` (which one this workspace uses). Everything that was a single
 * provider's fact — `configured`, `model`, `updatedAt` — moved onto the per-provider entry,
 * because with two of them a bare `configured: true` cannot say *which*.
 *
 * `provider` and `model` are kept at the top level as well, naming the **active** provider
 * and the model a run would actually use. That is deliberate redundancy: it is the one
 * question the settings page, the canvas and `verify-providers.mjs` all ask, and deriving
 * it in three places from the list plus the fallback rules is three places to get the
 * precedence wrong.
 */

export const providerSettingsSchema = z
  .object({
    /**
     * Which provider to use. Validated against the registry rather than an enum literal, so
     * adding a provider needs no edit here.
     */
    provider: z.string().min(1).max(40).optional(),
    /** Absent means "leave the stored key alone"; present means replace it. */
    apiKey: z.string().min(10).max(400).optional(),
    model: z.string().min(1).max(120).optional(),
  })
  .refine(
    (body) => body.apiKey !== undefined || body.model !== undefined || body.provider !== undefined,
    { message: "Send a provider, an apiKey, a model, or some combination." },
  );

export type ProviderSettingsInput = z.infer<typeof providerSettingsSchema>;

/** One provider's state in this workspace. */
export interface ProviderState extends ProviderDescription {
  /** Whether this workspace has its own key stored for this provider. */
  configured: boolean;
  /** The model this provider will use when a node does not name one. */
  model: string;
  updatedAt: string | null;
}

export interface ProviderSettings {
  /** The **active** provider's id — what a run would use right now. */
  provider: string;
  /** Every provider the product supports, and what this workspace has for each. */
  providers: ProviderState[];
  /**
   * Whether the *active* provider has a stored key. Kept for the same reason `model` is:
   * it is the question every surface asks.
   */
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
   *
   * **Narrowed to the active provider in Phase 23D.** Showing a workspace on Groq the
   * health of three Gemini models it is not using would be noise presented as diagnosis.
   */
  health: ModelHealth[];
}

/**
 * Read the whole picture: every provider, and which one is live.
 *
 * **One query per provider, and that is the honest cost of this feature.** Two providers is
 * two indexed point lookups on `(workspaceId, kind, label)`, on a connection the request has
 * already opened — measured in the same band as the single lookup it replaces. It is written
 * as a loop rather than an `inArray` because the settings page wants each provider's
 * `updatedAt` and chosen model separately anyway, so the join would be unpacked immediately.
 * Worth revisiting at five providers; wrong to pre-optimise at two.
 */
export async function readSettings(scope: WorkspaceScope): Promise<ProviderSettings> {
  const storedChoice = await readWorkspaceProvider(scope);

  const states: ProviderState[] = [];
  for (const provider of PROVIDERS) {
    const credential = await getCredential({ scope, kind: provider.kind });
    const description = describeProviders().find((entry) => entry.id === provider.id)!;
    states.push({
      ...description,
      configured: credential !== null,
      model:
        typeof credential?.metadata.model === "string" && credential.metadata.model.length > 0
          ? credential.metadata.model
          : provider.defaultModel,
      updatedAt: credential?.updatedAt ?? null,
    });
  }

  const active = activeProvider(storedChoice, states);
  const activeState = states.find((state) => state.id === active.id)!;

  return {
    provider: active.id,
    providers: states,
    configured: activeState.configured,
    model: activeState.model,
    defaultModel: active.defaultModel,
    source: activeState.configured
      ? "user"
      : process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? "environment"
        : "none",
    updatedAt: activeState.updatedAt,
    health: modelHealthSnapshot(Date.now(), active.id),
  };
}

/**
 * Which provider is live, by the same rules `resolveProvider` applies at run time.
 *
 * **The duplication is deliberate and bounded.** `resolveProvider` cannot be reused here: it
 * reads secrets through Phase 21's audited funnel, and filling in a settings page is not a
 * credential *use* — calling it would write a `used` audit event every time somebody opened
 * Settings, which would make the audit log useless for the thing it exists for. So this
 * decides from metadata (`configured`) and that one asks for plaintext, and
 * `providers.test.ts` pins them to the same answer.
 */
function activeProvider(storedChoice: string | null, states: ProviderState[]): LlmProvider {
  const chosen = providerById(storedChoice);
  if (chosen && states.find((state) => state.id === chosen.id)?.configured) return chosen;

  const firstConfigured = states.find((state) => state.configured);
  if (firstConfigured) return providerById(firstConfigured.id)!;

  // Nothing is configured. The stored choice still wins, so a workspace that picked Groq and
  // has not pasted a key yet sees Groq's card as the active one rather than being silently
  // bounced back to Google while it types.
  return chosen ?? PROVIDERS[0]!;
}

/** The provider a request is about: the named one, or the active one. */
async function targetProvider(
  scope: WorkspaceScope,
  input: ProviderSettingsInput,
): Promise<LlmProvider> {
  if (input.provider !== undefined) {
    const named = providerById(input.provider);
    if (!named) {
      throw new ApiError(
        "invalid_request",
        `Unknown provider "${input.provider}". Known: ${PROVIDERS.map((p) => p.id).join(", ")}.`,
      );
    }
    return named;
  }

  const settings = await readSettings(scope);
  return providerById(settings.provider)!;
}

/**
 * Saves the provider, the key and/or the model.
 *
 * A key and a model are **proved against the provider before they are stored**, and proved
 * in different ways, because the provider distinguishes them:
 *
 *   • a key is proved with one `models.list` call;
 *   • a model is proved with one real, tiny generation call.
 *
 * The second is not belt-and-braces. `models.list` on a working Gemini key returns
 * `gemini-2.5-flash`, and calling it answers **404 "no longer available to new
 * users"** (measured 2026-09-26). So the catalogue lists models a key cannot
 * actually run, and validating a choice against the list would happily store one.
 * Found by running this: an unvalidated model name was stored, and then every
 * subsequent run failed with a 404 from inside the engine.
 *
 * The cost of not doing this is paid at the worst moment — a workflow that fails
 * mid-run on demo day, with the real cause three layers down in a step error.
 *
 * **Switching provider is its own case, and it writes nothing but the choice.** A workspace
 * that already has both keys stored switches with one column write and no provider call: there
 * is nothing to prove, because both keys were proved when they were stored. A `provider` sent
 * together with an `apiKey` means "store this key for that provider and use it", which is the
 * single request the settings form makes when somebody pastes a key into a card that is not
 * the active one.
 */
export async function writeSettings(
  scope: WorkspaceScope,
  input: ProviderSettingsInput,
): Promise<ProviderSettings> {
  const provider = await targetProvider(scope, input);

  if (input.apiKey) {
    await verifyKey(provider, input.apiKey);

    const existing = await getCredential({ scope, kind: provider.kind });
    const model = input.model ?? existing?.metadata.model ?? provider.defaultModel;
    if (input.model) await verifyModel(provider, input.apiKey, input.model);

    await putCredential({
      scope,
      kind: provider.kind,
      secret: input.apiKey,
      metadata: { model },
    });

    // A key pasted into a provider's card is a choice of that provider. Written after the
    // key is stored, so a workspace is never pointed at a provider whose key failed to save.
    if (input.provider !== undefined) await writeWorkspaceProvider(scope, provider.id);

    return readSettings(scope);
  }

  if (input.model !== undefined) {
    const secret = await readSecret({ scope, kind: provider.kind });
    if (!secret) {
      throw new ApiError(
        "invalid_request",
        `Add a ${provider.label} API key before choosing a model — the model list comes from the key.`,
      );
    }

    await verifyModel(provider, secret, input.model);

    const updated = await updateCredentialMetadata({
      scope,
      kind: provider.kind,
      metadata: { model: input.model },
    });

    if (!updated) {
      throw new ApiError("not_found", "No stored key to attach a model to.");
    }

    if (input.provider !== undefined) await writeWorkspaceProvider(scope, provider.id);
    return readSettings(scope);
  }

  // `provider` alone: switch. Nothing to verify.
  await writeWorkspaceProvider(scope, provider.id);
  return readSettings(scope);
}

/**
 * Replace the stored key — **Phase 21's rotation path for a provider key.**
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
 *
 * **It takes the provider rather than assuming one** (Phase 23D), so `rotation.ts` has one
 * branch for every provider and a third one needs no edit there.
 */
export async function rotateProviderKey(
  scope: WorkspaceScope,
  provider: LlmProvider,
  apiKey: string,
): Promise<ProviderSettings> {
  const existing = await getCredential({ scope, kind: provider.kind });
  if (!existing) {
    throw new ApiError(
      "not_found",
      `There is no ${provider.label} key in this workspace to rotate. Add one first.`,
    );
  }

  await verifyKey(provider, apiKey);
  const model = existing.metadata.model ?? provider.defaultModel;
  await verifyModel(provider, apiKey, model);

  await putCredential({
    scope,
    kind: provider.kind,
    secret: apiKey,
    metadata: { model },
    event: "rotated",
  });

  return readSettings(scope);
}

/**
 * Delete a provider's key.
 *
 * **The workspace's choice is left alone on purpose.** A workspace that chose Groq, deleted
 * its key and then pastes a new one should still be on Groq; clearing the column would move
 * it silently to Google in between. `resolveProvider` already falls through to a provider
 * that actually has a key, so the dangling preference is harmless and recoverable, where a
 * forgotten choice is neither.
 */
export async function clearSettings(
  scope: WorkspaceScope,
  providerId?: string,
): Promise<ProviderSettings> {
  const provider = await targetProvider(scope, providerId ? { provider: providerId } : {});
  await deleteCredential({ scope, kind: provider.kind });
  return readSettings(scope);
}

/**
 * The models a key can actually use, live from the provider. Never a hardcoded list:
 * `gemini-2.5-flash` answered 404 "no longer available to new users" on 2026-09-26, so a
 * baked-in catalogue would offer models that cannot run.
 */
export async function listModelsFor(
  scope: WorkspaceScope,
  providerId?: string,
): Promise<{ models: ModelInfo[]; source: "user" | "environment"; provider: string }> {
  // A named provider lists from *its* stored key, which is what the settings form needs when
  // somebody expands a card that is not the active one.
  if (providerId !== undefined) {
    const provider = providerById(providerId);
    if (!provider) {
      throw new ApiError("invalid_request", `Unknown provider "${providerId}".`);
    }
    const secret = await readSecret({ scope, kind: provider.kind });
    if (!secret) {
      throw new ApiError("invalid_request", `No ${provider.label} key is stored in this workspace.`);
    }
    try {
      const models = await provider.create({ apiKey: secret }).listModels();
      return { models, source: "user", provider: provider.id };
    } catch (error) {
      throw asApiError(error);
    }
  }

  const { resolveProvider } = await import("./provider");
  const { model, source, provider } = await resolveProvider(scope);
  try {
    return { models: await model.listModels(), source, provider: provider.id };
  } catch (error) {
    throw asApiError(error);
  }
}

async function verifyKey(provider: LlmProvider, apiKey: string): Promise<ModelInfo[]> {
  try {
    return await provider.create({ apiKey }).listModels();
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
 *
 * **The two options are passed through the registry's `create`**, which is why `LlmProvider`
 * has a `create` taking only a key and a default model: a probe needs the adapter's own
 * factory, not a generic one. Each adapter accepts the same two seams under its own options
 * type, and `providers.test.ts` asserts both honour them.
 */
async function verifyModel(
  provider: LlmProvider,
  apiKey: string,
  model: string,
): Promise<void> {
  try {
    await provider.create({ apiKey, fallbacks: [], ignoreHealth: true }).generate({
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
