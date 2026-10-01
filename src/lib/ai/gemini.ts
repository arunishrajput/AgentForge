import { chainedModel, type FetchLike, type ProviderWire, type WireAnswer } from "./chain";
import { toGeminiSchema, toToolParameters } from "./schema";
import {
  isRetryableStatus,
  ProviderError,
  type ChatTurn,
  type GenerateRequest,
  type LanguageModel,
  type ToolCall,
  type ToolSpec,
  type Usage,
} from "./types";

/**
 * Gemini over its REST API, via `fetch` — no SDK (D32).
 *
 * Every behaviour in here was measured against the live API on 2026-09-26 rather
 * than recalled:
 *
 *   • `gemini-2.5-flash` answers 404 "no longer available to new users". Model names
 *     get retired mid-project, so `listModels()` is live and there is no hardcoded
 *     catalogue the UI can offer from.
 *   • `gemini-3.8-flash` answered 503 "currently experiencing high demand" on a first
 *     call and 200 seconds later. Hence retry with backoff, then a fallback chain.
 *   • A model turn must be sent back exactly as received — see `types.ts` on
 *     `thoughtSignature`. `toContents` therefore replays `turn.raw` and never rebuilds
 *     a model turn from its parsed fields.
 *   • Gemini emits several `functionCall` parts in one turn, so a caller must expect a
 *     batch, not a single call.
 *
 * **Phase 23D moved the retry, fallback, budget and breaker machinery to `chain.ts`**,
 * where a second provider could share it, and left this file holding only Gemini's wire
 * format: the endpoint, the auth header, `contents`, `functionDeclarations`, and how to
 * read a candidate. `gemini.test.ts` was not edited for that move, which is the evidence
 * it preserved behaviour rather than merely looking like it did.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Tried in order when the requested model cannot answer.
 *
 * **Set from measurement, never from memory** — `scripts/probe-models.mjs` makes real
 * calls on both the text and the tool-calling path and ranks what answers. Re-run it
 * whenever a model misbehaves; the numbers below are three passes on 2026-09-26:
 *
 * | model                   | text                | tool-call            | verdict      |
 * |-------------------------|---------------------|----------------------|--------------|
 * | `gemini-3-flash-preview`| 1.6 / 1.8 / 1.9 s   | 1.1 / 1.4 / 1.1 s    | 3/3 healthy  |
 * | `gemini-3.6-flash`      | 2.3 / 6.2 s / 503   | 1.7 / 1.9 / 2.0 s    | 2/3          |
 * | `gemini-3.5-flash-lite` | 4.2 s / **timeout** | 0.9 s / **timeout**  | 1/3          |
 *
 * `gemini-3.5-flash-lite` was the Chapter 1 default and is the model that hung for
 * 91.9 s in Phase 12. It is kept as the last rung because it does still answer — it
 * is simply no longer trusted to answer first. `gemini-3.1-flash-lite` was dropped:
 * its tool-calling path timed out on two of three passes, which is the worst possible
 * property for an agent node's fallback.
 *
 * A fallback is a reliability property — a 503 on one model must not end a run — so the
 * chain stays short, is always logged, and is reordered live by the circuit breaker in
 * `health.ts` so a model known to be failing is tried last rather than first.
 *
 * **Phase 23D made the chain a per-provider fact** and `providers.ts` is where both
 * chains now live side by side. This export is kept because it is Gemini's own list and
 * this is Gemini's file; the registry reads it rather than restating it.
 */
export const FALLBACK_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];

export const DEFAULT_MODEL = FALLBACK_MODELS[0];

interface GeminiPart {
  text?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: unknown };
  thoughtSignature?: string;
}

interface GeminiContent {
  role?: string;
  parts: GeminiPart[];
}

function isContent(value: unknown): value is GeminiContent {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { parts?: unknown }).parts)
  );
}

/**
 * Turns → Gemini `contents`.
 *
 * A model turn replays its `raw` content verbatim when there is one. Rebuilding it
 * from `text` + `toolCalls` loses the `thoughtSignature` Gemini signs function calls
 * with, and the next request fails with 400 — so the reconstruction path exists only
 * for a turn that never came from Gemini (a test fake, or a different provider's
 * history) and is marked as such.
 *
 * **That last clause stopped being hypothetical in Phase 23D.** A workspace that switches
 * provider mid-conversation hands this function Groq's turns, whose `raw` is an OpenAI
 * message rather than a Gemini content — `isContent` returns false for it and the
 * reconstruction path is what runs. It loses nothing, because a Groq turn never had a
 * `thoughtSignature` to lose.
 */
export function toContents(turns: ChatTurn[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      contents.push({ role: "user", parts: [{ text: turn.text }] });
      continue;
    }

    if (turn.role === "model") {
      if (isContent(turn.raw)) {
        contents.push({ role: "model", parts: turn.raw.parts });
        continue;
      }
      const parts: GeminiPart[] = [];
      if (turn.text) parts.push({ text: turn.text });
      for (const call of turn.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // Tool results go back as a user turn holding one `functionResponse` per call —
    // all of them in a single turn, matching the batch the model asked for.
    contents.push({
      role: "user",
      parts: turn.results.map((result) => ({
        functionResponse: {
          ...(result.id ? { id: result.id } : {}),
          name: result.name,
          // Wrapped: Gemini requires `response` to be an object, and a tool may
          // legitimately return a string, a number or null.
          response: { output: result.result ?? null },
        },
      })),
    });
  }

  return contents;
}

export function toFunctionDeclarations(tools: ToolSpec[]): unknown[] {
  return tools.map((tool) => {
    const parameters =
      tool.parameters === null || tool.parameters === undefined
        ? undefined
        : toToolParameters(tool.parameters) ??
          (typeof tool.parameters === "object"
            ? toGeminiSchema(tool.parameters)
            : undefined);

    return {
      name: tool.name,
      description: tool.description,
      ...(parameters && parameters.type === "object" ? { parameters } : {}),
    };
  });
}

function readUsage(payload: unknown): Usage | null {
  const meta = (payload as { usageMetadata?: Record<string, unknown> }).usageMetadata;
  if (!meta) return null;
  const input = Number(meta.promptTokenCount ?? 0);
  const output = Number(meta.candidatesTokenCount ?? 0);
  const total = Number(meta.totalTokenCount ?? input + output);
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

let syntheticCallId = 0;

export function parseCandidate(payload: unknown): {
  text: string;
  toolCalls: ToolCall[];
  raw: unknown;
  finishReason: string | null;
} {
  const candidate = (payload as { candidates?: Array<Record<string, unknown>> })
    .candidates?.[0];
  const content = candidate?.content;
  const parts = isContent(content) ? content.parts : [];

  const text = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  const toolCalls: ToolCall[] = [];
  for (const part of parts) {
    if (!part.functionCall) continue;
    toolCalls.push({
      id: part.functionCall.id ?? `call_${(syntheticCallId += 1)}`,
      name: part.functionCall.name,
      args: part.functionCall.args ?? {},
    });
  }

  return {
    text,
    toolCalls,
    // The whole content object, so the next turn can replay it byte for byte.
    raw: isContent(content) ? content : null,
    finishReason: (candidate?.finishReason as string | undefined) ?? null,
  };
}

function errorMessage(payload: unknown, status: number): string {
  const error = (payload as { error?: { message?: string; status?: string } }).error;
  if (error?.message) return error.message;
  return `Gemini returned HTTP ${status}.`;
}

export type { FetchLike };

export interface GeminiOptions {
  apiKey: string;
  /** The model a request uses when it does not name one. */
  defaultModel?: string;
  /** Tried in order after the requested model fails retryably. */
  fallbacks?: string[];
  /** Injected in tests. Nothing else should pass this. */
  fetchImpl?: FetchLike;
  /** Backoff between attempts. Overridden in tests so they do not actually wait. */
  backoffMs?: number[];
  /** Per-attempt cap. Defaults to 12 s — see `chain.ts`. */
  attemptTimeoutMs?: number;
  /** Cap on the whole chain. Defaults to 30 s. */
  totalBudgetMs?: number;
  /**
   * Skip the circuit breaker's reordering and its bookkeeping. Used by
   * `verifyModel` in `settings.ts`, which must prove one specific model and would
   * otherwise both be reordered away from it and pollute health with a result the
   * user asked for deliberately.
   */
  ignoreHealth?: boolean;
}

/** Gemini's wire format, and nothing else. The chain in `chain.ts` does the rest. */
function geminiWire(apiKey: string): ProviderWire {
  return {
    provider: "google",
    label: "Gemini",

    prepare(request: GenerateRequest): Record<string, unknown> {
      const tools = request.tools ?? [];
      return {
        contents: toContents(request.turns),
        ...(request.system
          ? { systemInstruction: { parts: [{ text: request.system }] } }
          : {}),
        ...(tools.length > 0
          ? { tools: [{ functionDeclarations: toFunctionDeclarations(tools) }] }
          : {}),
        generationConfig: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: request.maxOutputTokens }),
          // JSON mode and function calling are mutually exclusive on Gemini, so the
          // caller's `json` is honoured only when it asked for no tools.
          ...(request.json && tools.length === 0
            ? { responseMimeType: "application/json" }
            : {}),
        },
      };
    },

    // The model is in the path, so the body is the same for every attempt.
    target: (model, prepared) => ({
      url: `${BASE}/models/${model}:generateContent`,
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: prepared,
    }),

    parse(payload): WireAnswer {
      const parsed = parseCandidate(payload);
      return { ...parsed, usage: readUsage(payload) };
    },

    errorMessage,

    async listModels(call) {
      const response = await call(`${BASE}/models?pageSize=200`, {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
      });
      const payload = await response.json();

      if (response.status !== 200) {
        throw new ProviderError(errorMessage(payload, response.status), {
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const models = (payload as { models?: Array<Record<string, unknown>> }).models ?? [];

      return models
        .filter((model) => {
          const methods = (model.supportedGenerationMethods as string[] | undefined) ?? [];
          const id = String(model.name ?? "").replace(/^models\//, "");
          // Text generation only. The catalogue also carries image, TTS, music and
          // embedding models, none of which can serve an LLM or agent node.
          return (
            methods.includes("generateContent") &&
            id.startsWith("gemini-") &&
            !/-(tts|image|transcribe|embedding)\b/.test(id) &&
            !id.includes("computer-use") &&
            !id.includes("robotics")
          );
        })
        .map((model) => ({
          id: String(model.name ?? "").replace(/^models\//, ""),
          label: String(model.displayName ?? model.name ?? ""),
          inputTokenLimit: numberOrNull(model.inputTokenLimit),
          outputTokenLimit: numberOrNull(model.outputTokenLimit),
        }));
    },
  };
}

export function geminiModel(options: GeminiOptions): LanguageModel {
  const { apiKey } = options;
  if (!apiKey) throw new ProviderError("No Gemini API key.", { status: 401, retryable: false });

  return chainedModel(geminiWire(apiKey), {
    defaultModel: options.defaultModel ?? DEFAULT_MODEL,
    fallbacks: options.fallbacks ?? FALLBACK_MODELS,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.backoffMs ? { backoffMs: options.backoffMs } : {}),
    ...(options.attemptTimeoutMs === undefined
      ? {}
      : { attemptTimeoutMs: options.attemptTimeoutMs }),
    ...(options.totalBudgetMs === undefined ? {} : { totalBudgetMs: options.totalBudgetMs }),
    ...(options.ignoreHealth === undefined ? {} : { ignoreHealth: options.ignoreHealth }),
  });
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
