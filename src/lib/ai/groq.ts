import { chainedModel, type FetchLike, type ProviderWire, type WireAnswer } from "./chain";
import { toToolParameters } from "./schema";
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
 * Groq over its OpenAI-compatible REST API, via `fetch` — no SDK, the same decision as
 * D32 and for the same reason. **Phase 23D, and the second provider behind
 * `LanguageModel`.**
 *
 * Every shape below was measured against the live API on 2026-10-01, not recalled from
 * what OpenAI's API looks like:
 *
 *   • **`message.content` is absent, not null, on a tool-calling turn.** A parser reading
 *     `content ?? ""` is correct and one reading `content === null` is not.
 *   • **`tool_calls[].function.arguments` is a JSON *string*** and must be parsed. It is
 *     also the one field a model can get wrong while the HTTP call succeeds, so a parse
 *     failure degrades to `{}` rather than throwing: the agent loop is built to tell a
 *     model it called a tool wrongly, and it cannot do that if the adapter crashes first.
 *   • **An assistant turn carries `reasoning`** on the `gpt-oss` models. Replaying the
 *     message verbatim keeps it — see the note on `toMessages`.
 *   • **One `role: "tool"` message per tool call**, where Gemini takes all of a batch in a
 *     single turn. This is the one structural difference between the two wire formats and
 *     the only place the shared `ChatTurn` shape needed real translation.
 *
 * ## Why Groq
 *
 * Free tier, no card, real tool-calling, and it is OpenAI-compatible — so the adapter is
 * also the adapter for any OpenAI-compatible gateway, which is most of them. Measured
 * against Gemini on the same probe, it is **2–7× faster**: see `providers.ts` for the three
 * passes.
 */

const BASE = "https://api.groq.com/openai/v1";

/**
 * Tried in order when the requested model cannot answer. **Set from measurement** by
 * `node scripts/probe-models.mjs --provider groq` — three passes on 2026-10-01:
 *
 * | model                          | text                 | tool-call            | verdict     |
 * |--------------------------------|----------------------|----------------------|-------------|
 * | `openai/gpt-oss-120b`          | 578 / 661 / 730 ms   | 679 / 795 / 1309 ms  | 3/3 healthy |
 * | `qwen/qwen3.8-27b`             | 186 / 219 / 1441 ms  | 335 / 314 / 605 ms   | 3/3 healthy |
 * | `openai/gpt-oss-20b`           | 495 / 488 / 734 ms   | 504 / 620 / 508 ms   | 3/3 healthy |
 * | `openai/gpt-oss-safeguard-20b` | 161 / 191 / 193 ms   | 273 / 270 / 199 ms   | 3/3 healthy |
 *
 * **All four passed both paths on all three passes**, which is a better result than Gemini
 * has ever produced here and is why the chain is ordered by capability rather than purely
 * by latency: when everything answers, the fastest model is no longer the most useful tie
 * breaker.
 *
 * So `gpt-oss-120b` heads it — the largest model, and the one declaring
 * `tools`, `json_mode`, `structured_outputs` and `reasoning`. `qwen3.8-27b` is second
 * **because it is the only candidate from a different family**, which is the property that
 * stops one vendor's outage emptying the chain. `gpt-oss-20b` is third as the small
 * sibling that fails independently of neither.
 *
 * **`gpt-oss-safeguard-20b` is deliberately excluded despite being the fastest of the
 * four.** It is a policy-classification model: it answered the probe because the probe is
 * two trivial calls, and it would be the wrong thing for an agent node to reason with. The
 * fastest model that passes a probe is not automatically the right default, and this is the
 * clearest example of that in either chain. It is still *listed* in the model picker,
 * because `listModels` reports what the key can call rather than what this file prefers.
 */
export const GROQ_FALLBACK_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
];

export const GROQ_DEFAULT_MODEL = GROQ_FALLBACK_MODELS[0];

interface GroqToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface GroqMessage {
  role?: string;
  content?: string | null;
  reasoning?: string;
  tool_calls?: GroqToolCall[];
}

function isMessage(value: unknown): value is GroqMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as GroqMessage;
  // An assistant turn is identified by having something a model produces. `role` alone is
  // not enough: a reconstructed turn from another provider's history would also carry one.
  return (
    candidate.role === "assistant" &&
    (typeof candidate.content === "string" ||
      candidate.content === null ||
      Array.isArray(candidate.tool_calls))
  );
}

/**
 * `arguments` is a JSON string the model wrote, so it is the one field here that can be
 * malformed while the HTTP call succeeded.
 *
 * It degrades to `{}` rather than throwing. The agent loop's job is to hand a tool its
 * arguments and report back what the tool said — including "that was not valid" — and it
 * cannot do that if the adapter throws before the loop sees the call. A model that writes
 * broken JSON then gets a validation error from the node and a chance to correct itself,
 * which is the behaviour the loop was built for.
 */
function readArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Turns → OpenAI-style `messages`.
 *
 * **A model turn replays its `raw` message verbatim when there is one**, the same
 * discipline `gemini.ts` follows and for a weaker reason, which is worth stating precisely
 * rather than implying the two providers are alike here.
 *
 * Gemini *requires* it: a function call that loses its `thoughtSignature` makes the next
 * request a hard 400. **Groq does not** — measured on 2026-10-01, the same conversation
 * replayed with `reasoning` stripped answered 200 and continued correctly. So here the
 * replay is a fidelity choice, not a correctness one: it keeps the model's own reasoning
 * trace in the conversation it is reasoning about, costs nothing, and means the rule
 * ("carry a model turn back verbatim") is one rule across both providers instead of a
 * Gemini quirk somebody might later "clean up" on both.
 *
 * **Tool results fan out to one message each**, which is the real translation in this file.
 * Gemini takes a batch of `functionResponse` parts in a single turn; OpenAI's format
 * requires one `role: "tool"` message per `tool_call_id`. The shared `ChatTurn` holds the
 * batch, because that is the shape the model produced, and each provider unpacks it the
 * way its own API wants.
 */
export function toMessages(turns: ChatTurn[], system?: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  // Gemini takes a system instruction in its own top-level field; OpenAI takes it as the
  // first message.
  if (system) messages.push({ role: "system", content: system });

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.text });
      continue;
    }

    if (turn.role === "model") {
      if (isMessage(turn.raw)) {
        messages.push({ ...turn.raw } as Record<string, unknown>);
        continue;
      }
      // A turn that never came from Groq: a test fake, or Gemini's history after a
      // workspace switched provider mid-conversation.
      messages.push({
        role: "assistant",
        // `content` must be present even when empty, unlike on the way back.
        content: turn.text,
        ...(turn.toolCalls.length > 0
          ? {
              tool_calls: turn.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      });
      continue;
    }

    for (const result of turn.results) {
      messages.push({
        role: "tool",
        tool_call_id: result.id,
        // Wrapped in `output` to match what the Gemini path sends, so a tool sees the same
        // envelope whichever provider is driving. `content` must be a string here.
        content: JSON.stringify({ output: result.result ?? null }),
      });
    }
  }

  return messages;
}

/**
 * Tool specs → OpenAI `tools`.
 *
 * **The parameter schema is the same narrowed one Gemini gets** (`toToolParameters`), and
 * that is a deliberate choice with a cost. Groq accepts full JSON Schema, so it could be
 * handed `additionalProperties` and `anyOf` that Gemini's dialect rejects — the allow-list
 * is strictly weaker than what this provider can express.
 *
 * It is reused anyway, because **a workflow must behave the same whichever provider runs
 * it.** Two schema paths would mean an agent whose tool signature is richer on one
 * provider, which turns "switch provider" from a setting into a behaviour change, and
 * makes a bug reproducible on only one of them. One schema, one set of tests, and the
 * narrowing is a subset of valid JSON Schema so nothing is invalid — only vaguer than it
 * could be.
 */
export function toGroqTools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((tool) => {
    const parameters = toToolParameters(tool.parameters);
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        ...(parameters ? { parameters } : {}),
      },
    };
  });
}

function readUsage(payload: unknown): Usage | null {
  const usage = (payload as { usage?: Record<string, unknown> }).usage;
  if (!usage) return null;
  const input = Number(usage.prompt_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? 0);
  const total = Number(usage.total_tokens ?? input + output);
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

let syntheticCallId = 0;

export function parseChoice(payload: unknown): {
  text: string;
  toolCalls: ToolCall[];
  raw: unknown;
  finishReason: string | null;
} {
  const choice = (payload as { choices?: Array<Record<string, unknown>> }).choices?.[0];
  const message = choice?.message as GroqMessage | undefined;

  const toolCalls: ToolCall[] = [];
  for (const call of message?.tool_calls ?? []) {
    if (!call.function?.name) continue;
    toolCalls.push({
      // Groq supplies an id; the synthesised one is for a gateway that does not.
      id: call.id ?? `call_${(syntheticCallId += 1)}`,
      name: call.function.name,
      args: readArgs(call.function.arguments),
    });
  }

  return {
    // Absent on a tool-calling turn, which is why this is `?? ""` and not a null check.
    text: (message?.content ?? "").trim(),
    toolCalls,
    // The whole message, so the next turn can replay it as the model wrote it.
    raw: message && message.role === "assistant" ? message : null,
    finishReason: (choice?.finish_reason as string | undefined) ?? null,
  };
}

function errorMessage(payload: unknown, status: number): string {
  const error = (payload as { error?: { message?: string } }).error;
  if (error?.message) return error.message;
  return `Groq returned HTTP ${status}.`;
}

export interface GroqOptions {
  apiKey: string;
  /** The model a request uses when it does not name one. */
  defaultModel?: string;
  /** Tried in order after the requested model fails retryably. */
  fallbacks?: string[];
  /** Injected in tests. Nothing else should pass this. */
  fetchImpl?: FetchLike;
  backoffMs?: number[];
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
  /** See `GeminiOptions.ignoreHealth` — same seam, same caller. */
  ignoreHealth?: boolean;
}

function groqWire(apiKey: string): ProviderWire {
  return {
    provider: "groq",
    label: "Groq",

    prepare(request: GenerateRequest): Record<string, unknown> {
      const tools = request.tools ?? [];
      return {
        messages: toMessages(request.turns, request.system),
        ...(tools.length > 0 ? { tools: toGroqTools(tools) } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined
          ? {}
          : { max_completion_tokens: request.maxOutputTokens }),
        /**
         * JSON mode. **Honoured only with no tools, which is a self-imposed limit rather
         * than Groq's.** Gemini forbids the combination outright; Groq allows it. Matching
         * the stricter provider keeps one documented rule in `CONTRACT.md` for both, and
         * the only caller that asks for `json` — the workflow generator — uses no tools
         * anyway, so the permissive path would be untested code serving nobody.
         */
        ...(request.json && tools.length === 0
          ? { response_format: { type: "json_object" } }
          : {}),
      };
    },

    // OpenAI-compatible: the model goes in the body, so each attempt re-stamps it onto the
    // prepared payload rather than changing a URL.
    target: (model, prepared) => ({
      url: `${BASE}/chat/completions`,
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: { ...(prepared as Record<string, unknown>), model },
    }),

    parse(payload): WireAnswer {
      const parsed = parseChoice(payload);
      return { ...parsed, usage: readUsage(payload) };
    },

    errorMessage,

    async listModels(call) {
      const response = await call(`${BASE}/models`, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
      });
      const payload = await response.json();

      if (response.status !== 200) {
        throw new ProviderError(errorMessage(payload, response.status), {
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const models = (payload as { data?: Array<Record<string, unknown>> }).data ?? [];

      /**
       * **Groq declares capability, so this filter asks instead of guessing** — and it is
       * the one place this provider is strictly better to integrate than Gemini, which
       * offers no tool-calling flag and forces `gemini.ts` into a name test.
       *
       * Each entry carries `input_modalities`, `output_modalities` and
       * `supported_features`. A model usable by an LLM or agent node is text in, text out,
       * with `tools` among its features. Measured against the live catalogue on
       * 2026-10-01: that excludes Whisper (outputs `transcription`), Orpheus (outputs
       * `speech`) and Prompt Guard (text to text, but declares no features at all), and
       * keeps exactly the four the probe then found healthy.
       *
       * **A declaration is still a claim**, which is why Phase 13's rule stands and the
       * probe makes real calls on both paths before a model enters a chain. The filter
       * decides what may be *offered*; measurement decides what is *trusted*.
       */
      return models
        .filter((model) => {
          const inputs = (model.input_modalities as string[] | undefined) ?? [];
          const outputs = (model.output_modalities as string[] | undefined) ?? [];
          const features = (model.supported_features as string[] | undefined) ?? [];
          return (
            model.active !== false &&
            inputs.includes("text") &&
            outputs.includes("text") &&
            features.includes("tools")
          );
        })
        .map((model) => ({
          id: String(model.id ?? ""),
          label: String(model.name ?? model.id ?? ""),
          inputTokenLimit: numberOrNull(model.context_window),
          outputTokenLimit: numberOrNull(model.max_completion_tokens),
        }));
    },
  };
}

export function groqModel(options: GroqOptions): LanguageModel {
  const { apiKey } = options;
  if (!apiKey) throw new ProviderError("No Groq API key.", { status: 401, retryable: false });

  return chainedModel(groqWire(apiKey), {
    defaultModel: options.defaultModel ?? GROQ_DEFAULT_MODEL,
    fallbacks: options.fallbacks ?? GROQ_FALLBACK_MODELS,
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
