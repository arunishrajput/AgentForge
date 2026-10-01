import { z } from "zod";

import { DEFAULT_MODEL, FALLBACK_MODELS, geminiModel } from "./gemini";
import { GROQ_DEFAULT_MODEL, GROQ_FALLBACK_MODELS, groqModel } from "./groq";
import type { LanguageModel } from "./types";

/**
 * **The LLM provider registry — Phase 23D.**
 *
 * The same move `lib/integrations/tokens.ts` made in Phase 23B, applied to model providers:
 * one row per provider, and everything that can be derived from it is. A provider owes an
 * entry here and an adapter file, and nothing else:
 *
 *   • `ROTATION_RULES`     generated in `credentials/rotation.ts`, so a provider key is
 *                          rotatable the moment the provider exists
 *   • `CREDENTIAL_KINDS`   generated the same way, so the vault lists it
 *   • the settings UI      rendered from `describeProviders()`
 *   • the model picker     `listModels()` on the resolved adapter
 *   • health               keyed by `id`, so one provider's outage cannot reorder the
 *                          other's chain (`health.ts`)
 *
 * ## What "a stored fact rather than a literal" actually meant
 *
 * `BUILD_PLAN.md` anticipated migrating existing `llm.google` rows, on the reading that
 * `LLM_CREDENTIAL_KIND` was a literal standing where a provider should be. Writing it
 * showed that was half right, and the half that was wrong saved a data migration:
 *
 * **the kind string was already provider-qualified.** It is `llm.google` — not `llm.key`
 * or `llm.provider` — so Google's rows are already named after the provider they belong
 * to, and Groq's are `llm.groq`. No existing row changes meaning, so **no row needs
 * rewriting**, and every workspace with a working Gemini key keeps it with no migration to
 * get wrong. `kind` is the per-provider key; it was never the thing that had to become a
 * fact.
 *
 * **What genuinely was a literal is which provider a workspace uses.** With one provider
 * that question had no place to live, because the answer could only be "the one". That is
 * now `workspace.llmProvider` (migration `0010`), and `resolveProvider` reads it.
 *
 * ## The second provider must not quietly become the default
 *
 * `BUILD_PLAN.md` asks for this explicitly, and the ordering of this array is what enforces
 * it: `PROVIDERS[0]` is Google, and a workspace that has never chosen gets the first entry
 * it holds a credential for. So adding Groq changed no existing workspace's behaviour, and
 * a workspace only moves when somebody picks. `providers.test.ts` asserts the order rather
 * than trusting it to survive an alphabetical tidy-up.
 */

export interface LlmProvider {
  /** Stable id. In `workspace.llmProvider`, in health records, in log lines. */
  id: string;
  /** The credential kind in the database. **Stable — existing rows carry it.** */
  kind: string;
  /** The provider's name as a heading and in an error message. */
  label: string;
  /** Where a user gets a key. Shown as a link on the settings card. */
  keyUrl: string;
  /** What that page is called, for the link text. */
  keyUrlLabel: string;
  /** The adapter default, and the head of the chain. */
  defaultModel: string;
  /**
   * The fallback chain, **measured by `scripts/probe-models.mjs` and never recalled.** Each
   * adapter file holds its own list with the measurements that produced it.
   */
  models: string[];
  /** Shape-checked before the provider is asked, so a typo costs no round trip. */
  schema: z.ZodType<string>;
  /** Shown in the empty key input. Never a real credential. */
  placeholder: string;
  /** Two or three sentences on the settings card: what it is and what to know. */
  blurb: string;
  /**
   * Build an adapter from a key. The one place a provider's factory is named.
   *
   * `fallbacks` and `ignoreHealth` exist for one caller — `verifyModel` in `settings.ts`,
   * which must prove **one specific model** before it is stored. Without `fallbacks: []` a
   * broken choice would be answered by the next model in the chain and then saved as though
   * it worked; without `ignoreHealth` the breaker would reorder the chain away from the very
   * model under test and count the deliberate probe against it. Both adapters accept them
   * under their own options type and `providers.test.ts` asserts both honour them.
   */
  create: (options: {
    apiKey: string;
    defaultModel?: string;
    fallbacks?: string[];
    ignoreHealth?: boolean;
  }) => LanguageModel;
}

/**
 * **Order matters: the first entry is the default for a workspace that has not chosen.**
 * See the header. Do not sort this array.
 */
export const PROVIDERS: LlmProvider[] = [
  {
    id: "google",
    kind: "llm.google",
    label: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyUrlLabel: "Google AI Studio",
    defaultModel: DEFAULT_MODEL,
    models: FALLBACK_MODELS,
    // Google's keys are ~39 characters and begin `AIza`, but the bound is deliberately
    // loose: a shape assertion that tracks a vendor's current key format breaks on the day
    // they change it, and the real check is the `models.list` call that follows.
    schema: z.string().trim().min(10).max(400),
    placeholder: "Paste your API key",
    blurb:
      "The free tier needs no card. Your key is checked against the provider before it is stored, so a wrong one fails here rather than halfway through a run.",
    create: ({ apiKey, defaultModel, fallbacks, ignoreHealth }) =>
      geminiModel({
        apiKey,
        ...(defaultModel ? { defaultModel } : {}),
        ...(fallbacks ? { fallbacks } : {}),
        ...(ignoreHealth === undefined ? {} : { ignoreHealth }),
      }),
  },
  {
    id: "groq",
    kind: "llm.groq",
    label: "Groq",
    keyUrl: "https://console.groq.com/keys",
    keyUrlLabel: "the Groq console",
    defaultModel: GROQ_DEFAULT_MODEL,
    models: GROQ_FALLBACK_MODELS,
    schema: z.string().trim().min(10).max(400),
    placeholder: "gsk_…",
    blurb:
      "Open models on a free tier that needs no card, and measurably the faster of the two — 2–7× quicker than Gemini on the same probe. Groq publishes which of its models can call tools, so the picker only offers ones that can.",
    create: ({ apiKey, defaultModel, fallbacks, ignoreHealth }) =>
      groqModel({
        apiKey,
        ...(defaultModel ? { defaultModel } : {}),
        ...(fallbacks ? { fallbacks } : {}),
        ...(ignoreHealth === undefined ? {} : { ignoreHealth }),
      }),
  },
];

/** The default when a workspace has made no choice. Google, deliberately — see the header. */
export const DEFAULT_PROVIDER_ID = PROVIDERS[0]!.id;

/**
 * Every LLM credential kind the product stores. `CREDENTIAL_KINDS` in
 * `credentials/rotation.ts` spreads this, so a provider added here is rotatable and appears
 * in the vault without another edit — Phase 23C proved that claim for integrations by adding
 * a kind and writing no rotation code, and this is the same mechanism.
 */
export const LLM_CREDENTIAL_KINDS = PROVIDERS.map((provider) => provider.kind);

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));
const BY_KIND = new Map(PROVIDERS.map((provider) => [provider.kind, provider]));

/**
 * **A `Map`, not an object literal.** Both of these are looked up with strings that arrive
 * from a request body or a database column, and Phase 23B found the cost of getting that
 * wrong: `ROTATION_RULES["toString"]` returned a function, which is truthy, and a 404 became
 * a 500. `getNode` has used a `Map` since Phase 3 for exactly this reason.
 */
export function providerById(id: string | null | undefined): LlmProvider | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function providerByKind(kind: string): LlmProvider | null {
  return BY_KIND.get(kind) ?? null;
}

/** The one in the registry, or the default. Never throws — a stale id degrades. */
export function providerOrDefault(id: string | null | undefined): LlmProvider {
  return providerById(id) ?? PROVIDERS[0]!;
}

/**
 * The non-secret description of each provider, for the settings UI.
 *
 * No `create`, no `schema` — a Zod schema does not survive JSON and a factory is not data.
 * The client gets what it needs to render a card and nothing more.
 */
export interface ProviderDescription {
  id: string;
  kind: string;
  label: string;
  keyUrl: string;
  keyUrlLabel: string;
  defaultModel: string;
  placeholder: string;
  blurb: string;
}

export function describeProviders(): ProviderDescription[] {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    kind: provider.kind,
    label: provider.label,
    keyUrl: provider.keyUrl,
    keyUrlLabel: provider.keyUrlLabel,
    defaultModel: provider.defaultModel,
    placeholder: provider.placeholder,
    blurb: provider.blurb,
  }));
}
