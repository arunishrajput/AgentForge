import {
  getCredential,
  LLM_CREDENTIAL_KIND,
  readSecret,
  type CredentialMetadata,
} from "@/lib/credentials";

import { DEFAULT_MODEL, geminiModel } from "./gemini";
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
 */

export class NoProviderKeyError extends Error {
  constructor() {
    super(
      "No Gemini API key configured. Add one in Settings — it is encrypted before it is stored.",
    );
    this.name = "NoProviderKeyError";
  }
}

export interface ResolvedProvider {
  model: LanguageModel;
  /** Where the key came from. Surfaced in logs so a demo cannot silently use the wrong one. */
  source: "user" | "environment";
  /** The model the user chose, or the adapter default. */
  selectedModel: string;
}

export async function resolveProvider(ownerId: string): Promise<ResolvedProvider> {
  const stored = await readSecret({ ownerId, kind: LLM_CREDENTIAL_KIND });

  if (stored) {
    const credential = await getCredential({ ownerId, kind: LLM_CREDENTIAL_KIND });
    const selectedModel = pickModel(credential?.metadata);
    return {
      model: geminiModel({ apiKey: stored, defaultModel: selectedModel }),
      source: "user",
      selectedModel,
    };
  }

  const fallback = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (fallback) {
    return {
      model: geminiModel({ apiKey: fallback }),
      source: "environment",
      selectedModel: DEFAULT_MODEL,
    };
  }

  throw new NoProviderKeyError();
}

function pickModel(metadata: CredentialMetadata | undefined): string {
  const model = metadata?.model;
  return typeof model === "string" && model.length > 0 ? model : DEFAULT_MODEL;
}
