/**
 * The provider-agnostic model interface — CONTRACT.md → "Agent tool-call schema".
 *
 * Gemini is the only implementation wired at MVP (ARCHITECTURE.md → "Agent and
 * tool-calling architecture"). The interface exists so a second provider is a new
 * file rather than a rewrite, and so the agent loop can be tested against a fake
 * model with no network.
 *
 * One rule shapes everything here: **a model turn is carried back to the provider
 * verbatim.** Gemini 3 signs every `functionCall` part with a `thoughtSignature`
 * and rejects, with HTTP 400, a conversation whose function calls have lost it:
 *
 *   "Function call is missing a thought_signature in functionCall parts. This is
 *    required for tools to work correctly"
 *
 * Measured against the live API on 2026-09-26, not assumed. So a `model` turn keeps
 * the provider's own content object in `raw`, and the provider sends *that* back
 * rather than rebuilding it from `text` and `toolCalls`. An adapter that normalised
 * the turn into a tidy internal shape would work for one tool call and fail on the
 * second — which is every agent node that does more than one thing.
 */

/** A tool the model may call. `name` is the wire name, not the registry type. */
export interface ToolSpec {
  name: string;
  /** Read verbatim by the model. Comes from the node definition's `description`. */
  description: string;
  /** JSON Schema for the arguments. Each provider narrows it to its own dialect. */
  parameters: unknown;
}

export interface ToolCall {
  /** The provider's id when it supplies one, else a synthesised one. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** JSON-serialisable. A failed tool returns `{ error: "..." }` — see loop.ts. */
  result: unknown;
}

/**
 * `raw` on a model turn is the provider's own content payload, opaque to everything
 * except the provider that produced it. It is what makes the history lossless.
 */
export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "model"; text: string; toolCalls: ToolCall[]; raw: unknown }
  | { role: "tool"; results: ToolResult[] };

export interface GenerateRequest {
  model: string;
  system?: string;
  turns: ChatTurn[];
  tools?: ToolSpec[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask for a JSON body back. Not combinable with `tools` on Gemini. */
  json?: boolean;
  /**
   * Budget for **one attempt**, overriding the adapter's default. Raise it for a
   * genuinely large prompt; the default is tuned for an agent step and is what keeps a
   * wedged model from costing a run 90 s (Phase 13).
   *
   * It is not a cap on the whole call: the adapter keeps room for a fallback after a
   * full-length attempt. Use `signal` for a hard ceiling on total elapsed time.
   */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** One HTTP attempt. Kept so a retry or a fallback is visible, never silent. */
export interface Attempt {
  model: string;
  status: number;
  ms: number;
  error?: string;
}

export interface GenerateResult {
  /** The model that actually answered. Differs from the request after a fallback. */
  model: string;
  text: string;
  toolCalls: ToolCall[];
  /** Feed straight into the next turn's `raw`. */
  raw: unknown;
  usage: Usage | null;
  finishReason: string | null;
  attempts: Attempt[];
}

export interface ModelInfo {
  id: string;
  label: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
}

export interface LanguageModel {
  readonly provider: string;
  /** The model id used when a node does not name one. */
  readonly defaultModel: string;
  generate: (request: GenerateRequest) => Promise<GenerateResult>;
  /** Live from the provider. Never a hardcoded list — model names get retired. */
  listModels: () => Promise<ModelInfo[]>;
}

/**
 * A provider failure with the one fact the caller needs: whether trying again could
 * possibly help. `retryable` is set from the HTTP status, not guessed from the
 * message.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly attempts: Attempt[];

  constructor(
    message: string,
    options: { status: number; retryable: boolean; attempts?: Attempt[] },
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status;
    this.retryable = options.retryable;
    this.attempts = options.attempts ?? [];
  }
}

/** 429 and 5xx are worth another attempt; 400/401/403/404 never are. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Why a model probe failed, in the only two categories a user can act on.
 *
 * Choosing a model runs one real call before the choice is stored, and what the user is
 * told when that call fails has to distinguish:
 *
 *   • `rejected`  — this key cannot run that model. Change the setting.
 *   • `temporary` — the provider was busy. Change nothing, try again.
 *
 * Phase 13 found the old code reporting the second as the first. Measured against the
 * live API on 2026-09-26: `gemini-3-flash-preview` allows 20 free-tier requests per
 * minute, and exceeding it produced `This key cannot use "gemini-3-flash-preview"` —
 * advice to change a setting that was correct.
 *
 * It lives here rather than in `settings.ts` because it is provider knowledge, and
 * because `settings.ts` cannot be imported outside the bundler: it reaches the database
 * and, through it, next-auth.
 */
export type ModelCheckVerdict =
  | { kind: "temporary"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "unknown" };

export function describeModelCheckFailure(model: string, error: unknown): ModelCheckVerdict {
  if (!(error instanceof ProviderError)) return { kind: "unknown" };

  if (error.retryable) {
    return {
      kind: "temporary",
      message:
        `"${model}" is temporarily unavailable, so it could not be checked right now — ` +
        // The provider's own words carry the retry delay, which is the actionable part.
        `your key was not changed. ${error.message}`,
    };
  }

  return { kind: "rejected", message: `This key cannot use "${model}": ${error.message}` };
}
