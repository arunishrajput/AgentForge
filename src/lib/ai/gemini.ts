import {
  countsAgainstModel,
  orderChain,
  recordFailure,
  recordSuccess,
} from "./health";
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
 */
export const FALLBACK_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];

export const DEFAULT_MODEL = FALLBACK_MODELS[0];

/**
 * The time budget — Phase 13's headline fix.
 *
 * Chapter 1 used a 45 s per-request timeout with two attempts per model and no overall
 * deadline, so a single wedged model cost 90 s before a fallback was tried. That is
 * exactly the 91.9 s step Phase 12 measured.
 *
 * Now: every attempt is capped, the whole `generate` call is capped, and **a timed-out
 * attempt is never retried on the same model.** A model that accepted the request and
 * went quiet has told you what it is going to do; asking it twice just buys the same
 * silence again. Retrying in place is reserved for failures that come back *fast* —
 * a 503 usually returns in under a second, and a retry there often succeeds.
 *
 * 12 s is deliberately tighter than the slowest healthy model measured (10.2 s on the
 * text path). That is a trade made with the numbers in hand: a model needing more than
 * 12 s for one agent step is losing to the fallback anyway, and the budget is what keeps
 * degradation under 15 s. A caller that knows it is doing something large can raise it
 * per request with `GenerateRequest.timeoutMs`.
 */
const ATTEMPT_TIMEOUT_MS = 12_000;

/**
 * The ceiling on one `generate`, across every model and retry. Sits well inside the
 * engine's 120 s run deadline so a node that also calls an integration still has room.
 */
const TOTAL_BUDGET_MS = 30_000;

/**
 * An attempt with less than this left of the total budget is not worth starting: it
 * would time out by construction and report a model failure that never happened.
 */
const MIN_ATTEMPT_MS = 1_500;

const MAX_ATTEMPTS_PER_MODEL = 2;
const BACKOFF_MS = [600, 1800];

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
  /** Per-attempt cap. Defaults to 12 s — see the budget note above. */
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

export function geminiModel(options: GeminiOptions): LanguageModel {
  const { apiKey } = options;
  if (!apiKey) throw new ProviderError("No Gemini API key.", { status: 401, retryable: false });

  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const fallbacks = options.fallbacks ?? FALLBACK_MODELS;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const attemptTimeout = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const totalBudget = options.totalBudgetMs ?? TOTAL_BUDGET_MS;
  const useHealth = options.ignoreHealth !== true;
  const call: FetchLike =
    options.fetchImpl ??
    (async (url, init) => {
      const response = await fetch(url, init);
      return { status: response.status, json: () => response.json() };
    });

  /**
   * The order models are tried in: the requested one first, then the chain with the
   * requested one removed so it is never attempted twice in a row — and then the whole
   * thing reordered by the circuit breaker, which moves a model that is currently
   * failing to the back.
   *
   * The requested model keeps its place at the front *whenever its breaker is closed*.
   * Only a model already known to be failing loses that position, and the caller still
   * learns which model answered from `GenerateResult.model` and the attempt list.
   */
  function chain(requested: string): string[] {
    const ordered = [requested, ...fallbacks.filter((model) => model !== requested)];
    return useHealth ? orderChain(ordered) : ordered;
  }

  async function post(
    model: string,
    body: unknown,
    signal: AbortSignal | undefined,
    budgetMs: number,
  ): Promise<{ status: number; payload: unknown; ms: number }> {
    const started = Date.now();
    const timeout = AbortSignal.timeout(budgetMs);
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

    // One clock for the whole chain. Without it, "two attempts per model, three models"
    // multiplies into a number nobody budgeted for — which is how Phase 12 got 91.9 s.
    //
    // `request.timeoutMs` sets the **per-attempt** budget, not the total. The total then
    // stretches to hold at least two full-length attempts, because a caller raising the
    // per-attempt budget for a large prompt still needs room for a fallback afterwards —
    // capping both at the same number would spend the entire budget on one model and
    // reintroduce the single point of failure this whole mechanism exists to remove.
    const perAttempt = request.timeoutMs ?? attemptTimeout;
    const ceiling = Math.max(totalBudget, perAttempt * 2);
    const deadline = Date.now() + ceiling;
    const remaining = () => deadline - Date.now();

    for (const model of chain(request.model || defaultModel)) {
      for (let tries = 0; tries < MAX_ATTEMPTS_PER_MODEL; tries += 1) {
        if (request.signal?.aborted) {
          throw new ProviderError("The run stopped before the model answered.", {
            status: 0,
            retryable: false,
            attempts,
          });
        }

        // Out of budget. Stop rather than start an attempt that cannot finish — a
        // 300 ms sliver of a 12 s call is a guaranteed timeout dressed as an attempt.
        // The floor is capped by `perAttempt` so a deliberately short budget (tests,
        // and a caller passing `timeoutMs`) still gets its one honest attempt.
        const floor = Math.min(MIN_ATTEMPT_MS, perAttempt);
        const budget = Math.min(perAttempt, remaining());
        if (budget < floor) {
          lastError ??= new ProviderError(
            `No model answered within ${Math.round(ceiling / 1000)} s.`,
            { status: 0, retryable: true, attempts },
          );
          throw lastError;
        }

        let status = 0;
        let payload: unknown = null;
        let ms = 0;
        try {
          const result = await post(model, body, request.signal, budget);
          status = result.status;
          payload = result.payload;
          ms = result.ms;
        } catch (error) {
          // A transport failure or a timeout. Retryable: it says nothing about the
          // request being wrong.
          const message = error instanceof Error ? error.message : String(error);
          const timedOut = /timeout|aborted|timed out/i.test(message);
          const detail = timedOut ? `no answer within ${budget} ms` : message;
          attempts.push({ model, status: 0, ms: budget, error: detail });
          if (useHealth) recordFailure(model, { status: 0, error: detail, latencyMs: budget });
          lastError = new ProviderError(`Could not reach Gemini: ${detail}`, {
            status: 0,
            retryable: true,
            attempts,
          });

          // **The Phase 13 fix.** A model that swallowed the whole budget and said
          // nothing gets no second chance here — the chain moves on. Retrying in place
          // is what turned one wedged model into 90 s.
          if (timedOut) break;

          if (tries + 1 < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(Math.min(backoff[tries] ?? 1800, Math.max(0, remaining())));
          }
          continue;
        }

        if (status === 200) {
          attempts.push({ model, status, ms });
          if (useHealth) recordSuccess(model, ms);
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
        // 404 is not retryable, but it *is* a fact about the model — three names in the
        // Chapter 1 chain went "no longer available to new users" mid-project. The
        // breaker wants to know; the chain still moves on, because another model can
        // absolutely fix a 404.
        if (useHealth && countsAgainstModel(status)) {
          recordFailure(model, { status, error: message, latencyMs: ms });
        }
        lastError = new ProviderError(message, { status, retryable, attempts });

        // 400/401/403 are facts about the request or the key. Another model will not
        // fix a bad key, so those end the call outright.
        if (!retryable && status !== 404) throw lastError;
        if (status === 404) break;

        if (tries + 1 < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(Math.min(backoff[tries] ?? 1800, Math.max(0, remaining())));
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
