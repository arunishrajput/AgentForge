import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { FetchLike } from "./chain";
import {
  GROQ_DEFAULT_MODEL,
  GROQ_FALLBACK_MODELS,
  groqModel,
  parseChoice,
  toGroqTools,
  toMessages,
} from "./groq";
import { modelHealthSnapshot, resetModelHealth } from "./health";
import { agentToolSet } from "./tools";
import { ProviderError, type ChatTurn } from "./types";

/**
 * **Every shape asserted here was taken from a live Groq response on 2026-10-01**, by the
 * same standard `gemini.test.ts` holds: the wire format is measured, never recalled from
 * what OpenAI's API is assumed to look like.
 *
 * Three of those measurements are the reason specific tests below exist:
 *
 *   • `message.content` is **absent**, not null, on a tool-calling turn;
 *   • `function.arguments` is a **JSON string**, and a model can write a broken one;
 *   • an assistant turn carries **`reasoning`**, and replaying the message verbatim keeps it.
 *
 * The retry, budget, fallback and breaker behaviour is **not** retested here. It lives in
 * `chain.ts` and is pinned by `gemini.test.ts`, which was not edited when that code moved;
 * duplicating it would be two copies of the same assertions drifting apart. What *is* tested
 * here is that this adapter is wired into that machinery correctly, which is a different and
 * much smaller claim.
 */

interface Recorded {
  url: string;
  body: Record<string, unknown> | null;
}

function fakeFetch(
  responses: Array<{ status: number; payload: unknown }>,
): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return { status: response.status, json: async () => response.payload };
  };
  return { fetchImpl, calls };
}

/** A completion, in the exact shape the live API returned. */
function answer(content: string) {
  return {
    status: 200,
    payload: {
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 131, completion_tokens: 45, total_tokens: 176 },
    },
  };
}

/**
 * A tool-calling turn, verbatim from the live API — note there is **no `content` key at
 * all**, and `arguments` is a string.
 */
const TOOL_CALL_PAYLOAD = {
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        reasoning: 'We need to call the function record_note with note "hello".',
        tool_calls: [
          {
            id: "fc_1a434390-6cf4-454d-a901-7009ac0bcd93",
            type: "function",
            function: { name: "record_note", arguments: '{"note":"hello"}' },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: { prompt_tokens: 131, completion_tokens: 45, total_tokens: 176 },
};

const model = (overrides: Parameters<typeof groqModel>[0]) =>
  groqModel({ backoffMs: [0, 0], ...overrides });

beforeEach(() => resetModelHealth());

/* ------------------------------------------------------------------ *
 * The wire format
 * ------------------------------------------------------------------ */

test("the model goes in the body, not the path — the endpoint is one URL", async () => {
  const { fetchImpl, calls } = fakeFetch([answer("OK")]);
  await model({ apiKey: "k", fetchImpl }).generate({
    model: "openai/gpt-oss-120b",
    turns: [{ role: "user", text: "hi" }],
  });

  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  // The structural difference from Gemini, which names the model in the path.
  assert.equal(calls[0].body!.model, "openai/gpt-oss-120b");
});

test("the system prompt is the first message, not a top-level field", () => {
  const messages = toMessages([{ role: "user", text: "hi" }], "You are terse.");
  assert.deepEqual(messages, [
    { role: "system", content: "You are terse." },
    { role: "user", content: "hi" },
  ]);
});

test("no system prompt means no system message, rather than an empty one", () => {
  assert.deepEqual(toMessages([{ role: "user", text: "hi" }]), [{ role: "user", content: "hi" }]);
});

test("a model turn is replayed verbatim, keeping the reasoning the model wrote", () => {
  const raw = TOOL_CALL_PAYLOAD.choices[0].message;
  const turns: ChatTurn[] = [
    { role: "user", text: "note hello" },
    { role: "model", text: "", toolCalls: [{ id: "fc_1", name: "record_note", args: {} }], raw },
  ];

  const [, assistant] = toMessages(turns);
  // Byte-for-byte the message the provider sent, `reasoning` included. Groq tolerates
  // losing it — measured — but the rule is one rule across both providers.
  assert.deepEqual(assistant, raw);
});

test("a turn from another provider is rebuilt rather than dropped", () => {
  // A workspace that switched provider mid-conversation hands Groq a Gemini history, whose
  // `raw` is a Gemini content object. It must still be sendable.
  const turns: ChatTurn[] = [
    {
      role: "model",
      text: "thinking",
      toolCalls: [{ id: "call_7", name: "http_request", args: { url: "https://x.test" } }],
      raw: { role: "model", parts: [{ text: "thinking" }] },
    },
  ];

  assert.deepEqual(toMessages(turns), [
    {
      role: "assistant",
      content: "thinking",
      tool_calls: [
        {
          id: "call_7",
          type: "function",
          function: { name: "http_request", arguments: '{"url":"https://x.test"}' },
        },
      ],
    },
  ]);
});

test("tool results fan out to one message each, where Gemini batches them", () => {
  // The one real translation in the adapter: OpenAI requires a message per `tool_call_id`.
  const turns: ChatTurn[] = [
    {
      role: "tool",
      results: [
        { id: "a", name: "first", result: { ok: true } },
        { id: "b", name: "second", result: null },
      ],
    },
  ];

  assert.deepEqual(toMessages(turns), [
    { role: "tool", tool_call_id: "a", content: '{"output":{"ok":true}}' },
    // A tool may legitimately return null; the envelope matches what the Gemini path sends
    // so a node sees the same shape whichever provider is driving.
    { role: "tool", tool_call_id: "b", content: '{"output":null}' },
  ]);
});

test("tools are declared in OpenAI's nested function shape", () => {
  const declared = toGroqTools([
    { name: "record_note", description: "Record it.", parameters: { type: "object", properties: { note: { type: "string" } } } },
  ]);

  assert.deepEqual(declared, [
    {
      type: "function",
      function: {
        name: "record_note",
        description: "Record it.",
        parameters: { type: "object", properties: { note: { type: "string" } } },
      },
    },
  ]);
});

test("a tool with no configurable fields declares no parameters key", () => {
  // Same rule as Gemini's, and the same reason: claiming an empty object schema is a lie
  // about a tool that takes no arguments at all.
  const [declared] = toGroqTools([{ name: "tick", description: "No arguments.", parameters: {} }]);
  assert.equal("parameters" in (declared.function as object), false);
});

test("every registry tool survives the conversion with a usable declaration", () => {
  // The same assertion the Gemini path carries: an agent's whole tool set must convert.
  const tools = toGroqTools(agentToolSet().specs);
  assert.ok(tools.length > 0);
  for (const tool of tools) {
    const fn = tool.function as { name: string; description: string; parameters?: { type?: string } };
    assert.ok(fn.name.length > 0);
    assert.ok(fn.description.length > 0);
    if (fn.parameters) assert.equal(fn.parameters.type, "object");
  }
});

/* ------------------------------------------------------------------ *
 * Reading a response
 * ------------------------------------------------------------------ */

test("a tool call is parsed although the message carries no content key at all", () => {
  const parsed = parseChoice(TOOL_CALL_PAYLOAD);

  // `content` is ABSENT, not null. A parser testing `=== null` reads `undefined` and throws.
  assert.equal("content" in TOOL_CALL_PAYLOAD.choices[0].message, false);
  assert.equal(parsed.text, "");
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, "record_note");
  // The JSON string became an object.
  assert.deepEqual(parsed.toolCalls[0].args, { note: "hello" });
  assert.equal(parsed.toolCalls[0].id, "fc_1a434390-6cf4-454d-a901-7009ac0bcd93");
  assert.equal(parsed.finishReason, "tool_calls");
});

test("malformed tool arguments degrade to an empty object rather than throwing", () => {
  // A model writing broken JSON is a 200 with a bad payload. The loop is built to tell a
  // model its call was wrong, and it never gets the chance if the adapter throws first.
  const parsed = parseChoice({
    choices: [
      {
        message: {
          role: "assistant",
          tool_calls: [{ id: "x", type: "function", function: { name: "f", arguments: "{not json" } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  });

  assert.equal(parsed.toolCalls.length, 1);
  assert.deepEqual(parsed.toolCalls[0].args, {});
});

test("a non-object argument payload is refused as an argument map", () => {
  for (const args of ['"a string"', "[1,2]", "null", "7"]) {
    const parsed = parseChoice({
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [{ id: "x", type: "function", function: { name: "f", arguments: args } }],
          },
        },
      ],
    });
    assert.deepEqual(parsed.toolCalls[0].args, {}, `${args} should not become an argument map`);
  }
});

test("a tool call with no function name is skipped rather than half-built", () => {
  const parsed = parseChoice({
    choices: [
      {
        message: {
          role: "assistant",
          content: "hi",
          tool_calls: [{ id: "x", type: "function", function: { arguments: "{}" } }],
        },
      },
    ],
  });
  assert.deepEqual(parsed.toolCalls, []);
  assert.equal(parsed.text, "hi");
});

test("usage is read from OpenAI's field names", async () => {
  const { fetchImpl } = fakeFetch([answer("OK")]);
  const result = await model({ apiKey: "k", fetchImpl }).generate({
    model: "openai/gpt-oss-120b",
    turns: [{ role: "user", text: "hi" }],
  });

  assert.deepEqual(result.usage, { inputTokens: 131, outputTokens: 45, totalTokens: 176 });
});

test("the whole assistant message is carried out as raw, for the next turn to replay", async () => {
  const { fetchImpl } = fakeFetch([{ status: 200, payload: TOOL_CALL_PAYLOAD }]);
  const result = await model({ apiKey: "k", fetchImpl }).generate({
    model: "openai/gpt-oss-120b",
    turns: [{ role: "user", text: "note hello" }],
  });

  assert.deepEqual(result.raw, TOOL_CALL_PAYLOAD.choices[0].message);
});

/* ------------------------------------------------------------------ *
 * Request options
 * ------------------------------------------------------------------ */

test("maxOutputTokens becomes max_completion_tokens", async () => {
  const { fetchImpl, calls } = fakeFetch([answer("OK")]);
  await model({ apiKey: "k", fetchImpl }).generate({
    model: "openai/gpt-oss-120b",
    turns: [{ role: "user", text: "hi" }],
    temperature: 0,
    maxOutputTokens: 1000,
  });

  assert.equal(calls[0].body!.max_completion_tokens, 1000);
  assert.equal(calls[0].body!.temperature, 0);
  assert.equal("maxOutputTokens" in calls[0].body!, false);
});

test("json mode is asked for with response_format, and dropped when tools are present", async () => {
  const { fetchImpl, calls } = fakeFetch([answer("{}"), answer("{}")]);
  const groq = model({ apiKey: "k", fetchImpl });

  await groq.generate({ model: "m", turns: [{ role: "user", text: "hi" }], json: true });
  assert.deepEqual(calls[0].body!.response_format, { type: "json_object" });

  // Groq would actually allow both. Matching Gemini's stricter rule keeps one documented
  // contract for every provider — see the note in `groq.ts`.
  await groq.generate({
    model: "m",
    turns: [{ role: "user", text: "hi" }],
    json: true,
    tools: [{ name: "f", description: "d", parameters: { type: "object", properties: {} } }],
  });
  assert.equal("response_format" in calls[1].body!, false);
});

test("the key travels as a bearer token, never in the URL", async () => {
  const calls: Array<Record<string, string>> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization ?? "" });
    return { status: 200, json: async () => answer("OK").payload };
  };

  await model({ apiKey: "gsk_secret", fetchImpl }).generate({
    model: "m",
    turns: [{ role: "user", text: "hi" }],
  });

  assert.equal(calls[0].auth, "Bearer gsk_secret");
  // A key in a query string lands in access logs and in a browser's history.
  assert.equal(calls[0].url.includes("gsk_secret"), false);
});

/* ------------------------------------------------------------------ *
 * The catalogue
 * ------------------------------------------------------------------ */

/** The live catalogue's own shape, trimmed to the entries that matter. */
const CATALOGUE = {
  data: [
    {
      id: "openai/gpt-oss-120b",
      name: "GPT OSS 120B",
      active: true,
      context_window: 131072,
      max_completion_tokens: 65536,
      input_modalities: ["text"],
      output_modalities: ["text"],
      supported_features: ["tools", "json_mode", "structured_outputs", "reasoning"],
    },
    {
      id: "whisper-large-v3",
      name: "Whisper",
      active: true,
      context_window: 448,
      input_modalities: ["audio"],
      output_modalities: ["transcription"],
    },
    {
      id: "canopylabs/orpheus-v1-english",
      name: "Orpheus",
      active: true,
      input_modalities: ["text"],
      output_modalities: ["speech"],
    },
    {
      id: "meta-llama/llama-prompt-guard-2-22m",
      name: "Llama Prompt Guard 2 22M",
      active: true,
      input_modalities: ["text"],
      output_modalities: ["text"],
      // Text to text, but declares no features — so it cannot call a tool.
      supported_sampling_parameters: ["temperature"],
    },
    {
      id: "retired-model",
      name: "Retired",
      active: false,
      input_modalities: ["text"],
      output_modalities: ["text"],
      supported_features: ["tools"],
    },
  ],
};

test("listModels keeps text models that can call tools and drops the rest", async () => {
  const { fetchImpl } = fakeFetch([{ status: 200, payload: CATALOGUE }]);
  const models = await model({ apiKey: "k", fetchImpl }).listModels();

  // The filter asks the catalogue rather than guessing from the name — the one place Groq
  // is better to integrate than Gemini, which has no tool-calling flag.
  assert.deepEqual(models.map((entry) => entry.id), ["openai/gpt-oss-120b"]);
  assert.equal(models[0].label, "GPT OSS 120B");
  assert.equal(models[0].inputTokenLimit, 131072);
  assert.equal(models[0].outputTokenLimit, 65536);
});

test("listModels reports a rejected key rather than returning an empty list", async () => {
  const { fetchImpl } = fakeFetch([
    { status: 401, payload: { error: { message: "Invalid API Key" } } },
  ]);

  await assert.rejects(
    () => model({ apiKey: "bad", fetchImpl }).listModels(),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 401);
      assert.equal(error.retryable, false);
      // The provider's own words, which are what tell a user what to fix.
      assert.match(error.message, /Invalid API Key/);
      return true;
    },
  );
});

/* ------------------------------------------------------------------ *
 * Wiring into the shared chain
 * ------------------------------------------------------------------ */

test("the default chain is the one the probe measured, most capable first", () => {
  // Pinned so a reorder is a decision. The numbers behind it are in `groq.ts`.
  assert.deepEqual(GROQ_FALLBACK_MODELS, [
    "openai/gpt-oss-120b",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-20b",
  ]);
  assert.equal(GROQ_DEFAULT_MODEL, "openai/gpt-oss-120b");

  // The fastest model the probe found is deliberately NOT in the chain: it is a policy
  // classifier, and the fastest model that passes a probe is not automatically the right one.
  assert.equal(GROQ_FALLBACK_MODELS.includes("openai/gpt-oss-safeguard-20b"), false);
});

test("a 503 falls through to the next model in Groq's own chain", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 503, payload: { error: { message: "Service Unavailable" } } },
    { status: 503, payload: { error: { message: "Service Unavailable" } } },
    answer("second model answered"),
  ]);

  const result = await model({ apiKey: "k", fetchImpl }).generate({
    model: "openai/gpt-oss-120b",
    turns: [{ role: "user", text: "hi" }],
  });

  assert.equal(result.model, "qwen/qwen3.8-27b");
  assert.equal(result.text, "second model answered");
  // Two attempts on the head, then the second rung — the shared chain's behaviour, reached
  // through this adapter.
  assert.deepEqual(calls.map((call) => call.body!.model), [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-120b",
    "qwen/qwen3.8-27b",
  ]);
});

test("health is recorded against groq, not against a bare model name", async () => {
  const { fetchImpl } = fakeFetch([answer("OK")]);
  await model({ apiKey: "k", fetchImpl }).generate({
    model: "openai/gpt-oss-120b",
    turns: [{ role: "user", text: "hi" }],
  });

  const [health] = modelHealthSnapshot();
  assert.equal(health.provider, "groq");
  assert.equal(health.model, "openai/gpt-oss-120b");
  assert.equal(health.state, "healthy");
  // And it is invisible to the other provider's chain, which is the point of the key.
  assert.deepEqual(modelHealthSnapshot(Date.now(), "google"), []);
});

test("a missing key is refused before any request is made", () => {
  assert.throws(
    () => groqModel({ apiKey: "" }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 401);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test("an error with no message still says something useful, and names the provider", async () => {
  const { fetchImpl } = fakeFetch([{ status: 500, payload: {} }]);
  await assert.rejects(
    () =>
      model({ apiKey: "k", fetchImpl, fallbacks: [] }).generate({
        model: "m",
        turns: [{ role: "user", text: "hi" }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /Groq returned HTTP 500/);
      return true;
    },
  );
});
