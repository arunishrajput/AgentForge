import { toGeminiSchema, toToolParameters } from "./schema";
import {
  isRetryableStatus,
  ProviderError,
  type Attempt,
  type ChatTurn,
  type GenerateRequest,
  type GenerateResult,
  type LanguageModel,
  type ModelInfo,
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
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Tried in order when the requested model cannot answer. Ordered by measured latency
 * on the free tier: flash-lite answered in ~1.2 s, flash in ~2.5–8.9 s. A fallback is
 * a demo-reliability property — a 503 on one model must not end a run — so the chain
 * stays short and the fallback is always logged, never silent.
 */
export const FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
];

export const DEFAULT_MODEL = FALLBACK_MODELS[0];

/** Bounded so a wedged provider cannot hold a run open to the engine's deadline. */
const MAX_ATTEMPTS_PER_MODEL = 2;
const BACKOFF_MS = [600, 1800];
const REQUEST_TIMEOUT_MS = 45_000;

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

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

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
}

export function geminiModel(options: GeminiOptions): LanguageModel {
  const { apiKey } = options;
  if (!apiKey) throw new ProviderError("No Gemini API key.", { status: 401, retryable: false });

  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const fallbacks = options.fallbacks ?? FALLBACK_MODELS;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const call: FetchLike =
    options.fetchImpl ??
    (async (url, init) => {
      const response = await fetch(url, init);
      return { status: response.status, json: () => response.json() };
    });

  /**
   * The order models are tried in: the requested one first, then the chain with the
   * requested one removed so it is never attempted twice in a row.
   */
  function chain(requested: string): string[] {
    return [requested, ...fallbacks.filter((model) => model !== requested)];
  }

  async function post(
    model: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ status: number; payload: unknown; ms: number }> {
    const started = Date.now();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const response = await call(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: combined,
    });

    return { status: response.status, payload: await response.json(), ms: Date.now() - started };
  }

  async function generate(request: GenerateRequest): Promise<GenerateResult> {
    const tools = request.tools ?? [];
    const body: Record<string, unknown> = {
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

    const attempts: Attempt[] = [];
    let lastError: ProviderError | null = null;

    for (const model of chain(request.model || defaultModel)) {
      for (let tries = 0; tries < MAX_ATTEMPTS_PER_MODEL; tries += 1) {
        if (request.signal?.aborted) {
          throw new ProviderError("The run stopped before the model answered.", {
            status: 0,
            retryable: false,
            attempts,
          });
        }

        let status = 0;
        let payload: unknown = null;
        let ms = 0;
        try {
          const result = await post(model, body, request.signal);
          status = result.status;
          payload = result.payload;
          ms = result.ms;
        } catch (error) {
          // A transport failure or a timeout. Retryable: it says nothing about the
          // request being wrong.
          const message = error instanceof Error ? error.message : String(error);
          attempts.push({ model, status: 0, ms: 0, error: message });
          lastError = new ProviderError(`Could not reach Gemini: ${message}`, {
            status: 0,
            retryable: true,
            attempts,
          });
          if (tries + 1 < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(backoff[tries] ?? 1800);
          }
          continue;
        }

        if (status === 200) {
          attempts.push({ model, status, ms });
          const parsed = parseCandidate(payload);
          return {
            model,
            text: parsed.text,
            toolCalls: parsed.toolCalls,
            raw: parsed.raw,
            usage: readUsage(payload),
            finishReason: parsed.finishReason,
            attempts,
          };
        }

        const message = errorMessage(payload, status);
        attempts.push({ model, status, ms, error: message });
        const retryable = isRetryableStatus(status);
        lastError = new ProviderError(message, { status, retryable, attempts });

        // 400/401/403/404 are facts about the request or the key. Another model will
        // not fix a bad key, so only a retryable status moves along the chain.
        if (!retryable) throw lastError;

        if (tries + 1 < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(backoff[tries] ?? 1800);
        }
      }
    }

    throw (
      lastError ??
      new ProviderError("Gemini could not be reached.", {
        status: 0,
        retryable: true,
        attempts,
      })
    );
  }

  async function listModels(): Promise<ModelInfo[]> {
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
  }

  return { provider: "google", defaultModel, generate, listModels };
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
