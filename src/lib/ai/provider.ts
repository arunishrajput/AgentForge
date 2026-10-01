import type { Recovery } from "@/lib/api-error";
import { getCredential, readSecret, type CredentialMetadata } from "@/lib/credentials";
import type { CredentialUse } from "@/lib/credentials/audit";
import { readWorkspaceProvider } from "@/lib/workspace/store";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { DEFAULT_MODEL, geminiModel } from "./gemini";
import { PROVIDERS, providerById, type LlmProvider } from "./providers";
import type { LanguageModel } from "./types";

/**
 * Resolving a caller's model — the one place a stored key is turned into a usable
 * `LanguageModel`.
 *
 * Order is deliberate: **the user's own key first**, the server's environment key only
 * as a development and demo fallback (CONTRACT.md marks
 * `GOOGLE_GENERATIVE_AI_API_KEY` exactly that way). The product path is a key the user
 * pasted into the app; the env var must never quietly become the thing everyone uses,
 * because then nobody's key is ever exercised and the feature is untested.
 *
 * ## Choosing between providers — Phase 23D
 *
 * With two providers there are two questions, and keeping them apart is what makes this
 * predictable: **which provider**, then **whose key**.
 *
 * Which provider, in order:
 *
 *   1. `workspace.llmProvider`, **if that provider actually has a key in this workspace.**
 *      The guard matters: a workspace that chose Groq and then deleted its Groq key must
 *      fall through to a provider that works rather than fail, and the stored choice is a
 *      preference, not a promise that a credential exists.
 *   2. Otherwise **the first provider in registry order holding a key** — Google, because
 *      `PROVIDERS[0]` is Google. This is the clause that satisfies `BUILD_PLAN.md`'s
 *      requirement that *the second provider must not quietly become the default*: a
 *      workspace that has never chosen behaves exactly as it did before Groq existed, and
 *      only moves when somebody picks.
 *   3. Otherwise the environment fallback, which is Google's and development-only.
 *   4. Otherwise {@link NoProviderKeyError}.
 *
 * **Both reads are needed and they are two queries, deliberately not one.** A join would
 * save a round trip on a database whose compute budget this project does count, and it was
 * still not worth it: `readSecret` is the single audited funnel every plaintext passes
 * through (Phase 21), and the alternative was a bespoke query that reads a secret without
 * going through it. The audit log not missing a credential read is worth more than one
 * statement. Both are indexed point lookups on a connection the run has already opened.
 */

export class NoProviderKeyError extends Error {
  constructor() {
    super(
      "No model provider key configured. Add one in Settings — it is encrypted before it is stored.",
    );
    this.name = "NoProviderKeyError";
  }
}

/**
 * **The way out of the error above — Phase 25.**
 *
 * This is the one failure a brand-new account hits on the product's primary call to action,
 * and the message naming "Settings" was a dead end: the user still had to go and find it.
 * The constant lives here, beside the error it recovers from, so the two cannot drift —
 * three routes and one node raise that error and every one of them should offer the same
 * door. `Recovery`'s contract is in `lib/api-error.ts`.
 *
 * `?tab=provider` is honoured by the settings page's own tab table, so the link lands on the
 * form rather than on the page that contains it.
 */
export const PROVIDER_KEY_RECOVERY: Recovery = {
  href: "/settings?tab=provider",
  label: "Add a provider key",
};

export interface ResolvedProvider {
  model: LanguageModel;
  /** Where the key came from. Surfaced in logs so a demo cannot silently use the wrong one. */
  source: "user" | "environment";
  /** The model the user chose, or the adapter default. */
  selectedModel: string;
  /** Which provider answered. Phase 23D — with two of them, "which" is part of the answer. */
  provider: LlmProvider;
}

/**
 * `use` is Phase 21's audit attribution. Optional, and its absence is meaningful rather
 * than lazy: the two routes that resolve a provider key to fill a picker or to generate a
 * graph really do have no run and no node, and recording one would be an invention.
 */
export async function resolveProvider(
  scope: WorkspaceScope,
  use?: CredentialUse,
): Promise<ResolvedProvider> {
  const chosen = providerById(await readWorkspaceProvider(scope));

  // The stored choice first, then registry order. `chosen` appearing twice is harmless —
  // the loop stops at the first key it finds — and it keeps the precedence in one list
  // rather than in two branches that could disagree.
  const order = chosen ? [chosen, ...PROVIDERS.filter((p) => p.id !== chosen.id)] : PROVIDERS;

  for (const provider of order) {
    const stored = await readSecret({
      scope,
      kind: provider.kind,
      ...(use ? { use } : {}),
    });
    if (!stored) continue;

    const credential = await getCredential({ scope, kind: provider.kind });
    const selectedModel = pickModel(credential?.metadata, provider.defaultModel);
    return {
      model: provider.create({ apiKey: stored, defaultModel: selectedModel }),
      source: "user",
      selectedModel,
      provider,
    };
  }

  // Development and demo only, and Google's alone: there is deliberately no
  // `GROQ_API_KEY` fallback on the server. A second environment key would be a second way
  // for a run to succeed without anybody's stored credential ever being exercised, which
  // is the failure this whole ordering exists to prevent — and it would make "which
  // provider" depend on which env var happened to be set.
  const fallback = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (fallback) {
    return {
      model: geminiModel({ apiKey: fallback }),
      source: "environment",
      selectedModel: DEFAULT_MODEL,
      provider: PROVIDERS[0]!,
    };
  }

  throw new NoProviderKeyError();
}

function pickModel(metadata: CredentialMetadata | undefined, fallback: string): string {
  const model = metadata?.model;
  return typeof model === "string" && model.length > 0 ? model : fallback;
}
