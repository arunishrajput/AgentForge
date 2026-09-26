import assert from "node:assert/strict";
import { test } from "node:test";

import { agentToolSet } from "./tools";
import {
  geminiModel,
  parseCandidate,
  toContents,
  toFunctionDeclarations,
  type FetchLike,
} from "./gemini";
import { ProviderError, type ChatTurn } from "./types";

/**
 * Every shape asserted here was taken from a live response on 2026-09-26. The
 * `thoughtSignature` cases in particular exist because the live API rejects a
 * conversation that has lost one, with HTTP 400 — a failure that only appears on an
 * agent node's *second* tool call.
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

function answer(text: string) {
  return {
    status: 200,
    payload: {
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
    },
  };
}

const model = (overrides: Parameters<typeof geminiModel>[0]) =>
  geminiModel({ backoffMs: [0, 0], ...overrides });

test("a model turn is replayed verbatim, keeping its thoughtSignature", () => {
  // Gemini signs functionCall parts. Dropping the signature is a 400 on the next
  // request, so the raw content is what goes back on the wire.
  const raw = {
    role: "model",
    parts: [
      {
        functionCall: { name: "core_log", args: { message: "hi" }, id: "call_1" },
        thoughtSignature: "EmAKXgFpFH0TJBzy",
      },
    ],
  };

  const contents = toContents([
    { role: "user", text: "Log hi." },
    { role: "model", text: "", toolCalls: [{ id: "call_1", name: "core_log", args: { message: "hi" } }], raw },
    { role: "tool", results: [{ id: "call_1", name: "core_log", result: { ok: true } }] },
  ]);

  assert.equal(contents.length, 3);
  assert.equal(contents[1].parts[0].thoughtSignature, "EmAKXgFpFH0TJBzy");
  assert.deepEqual(contents[2].parts[0].functionResponse, {
    id: "call_1",
    name: "core_log",
    response: { output: { ok: true } },
  });
});

test("a model turn with no raw payload is rebuilt, for a non-Gemini history", () => {
  const contents = toContents([
    { role: "model", text: "thinking", toolCalls: [{ id: "x", name: "core_log", args: { message: "a" } }], raw: null },
  ]);
  assert.deepEqual(contents[0].parts, [
    { text: "thinking" },
    { functionCall: { name: "core_log", args: { message: "a" } } },
  ]);
});

test("all tool results for one turn go back in a single turn", () => {
  const turn: ChatTurn = {
    role: "tool",
    results: [
      { id: "1", name: "core_log", result: { ok: true } },
      { id: "2", name: "core_set", result: null },
    ],
  };
  const contents = toContents([turn]);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].parts.length, 2);
  // A tool may legitimately return null; Gemini requires an object.
  assert.deepEqual(contents[0].parts[1].functionResponse?.response, { output: null });
});

test("parallel function calls in one turn are parsed as a batch", () => {
  const parsed = parseCandidate({
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { functionCall: { name: "core_log", args: { message: "a" }, id: "c1" } },
            { functionCall: { name: "core_log", args: { message: "b" }, id: "c2" } },
          ],
        },
        finishReason: "STOP",
      },
    ],
  });
  assert.equal(parsed.toolCalls.length, 2);
  assert.deepEqual(parsed.toolCalls.map((call) => call.id), ["c1", "c2"]);
});

test("a call with no id still gets one, so results can be matched back", () => {
  const parsed = parseCandidate({
    candidates: [{ content: { parts: [{ functionCall: { name: "core_log" } }] } }],
  });
  assert.equal(parsed.toolCalls.length, 1);
  assert.ok(parsed.toolCalls[0].id.length > 0);
  assert.deepEqual(parsed.toolCalls[0].args, {});
});

test("no key at all is refused before any request is made", () => {
  assert.throws(() => geminiModel({ apiKey: "" }), ProviderError);
});

test("a 503 is retried on the same model and can succeed", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 503, payload: { error: { message: "high demand", status: "UNAVAILABLE" } } },
    answer("OK"),
  ]);
  const result = await model({ apiKey: "k", fetchImpl }).generate({
    model: "gemini-3.5-flash-lite",
    turns: [{ role: "user", text: "hi" }],
  });

  assert.equal(result.text, "OK");
  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.equal(calls.length, 2);
  // The attempt list is what makes a retry visible instead of silent.
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), [503, 200]);
});

test("a model that keeps failing falls back to the next one in the chain", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 503, payload: { error: { message: "high demand" } } },
    { status: 503, payload: { error: { message: "high demand" } } },
    answer("from the fallback"),
  ]);
  const result = await model({
    apiKey: "k",
    fetchImpl,
    fallbacks: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  }).generate({ model: "gemini-3.5-flash-lite", turns: [{ role: "user", text: "hi" }] });

  assert.equal(result.text, "from the fallback");
  assert.equal(result.model, "gemini-3.1-flash-lite");
  assert.match(calls[2].url, /gemini-3\.1-flash-lite/);
  // The requested model is not attempted twice in the chain.
  assert.equal(calls.filter((call) => call.url.includes("3.5-flash-lite")).length, 2);
});

test("a 400 is not retried and not failed over — another model cannot fix it", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 400, payload: { error: { message: 'Unknown name "additionalProperties"' } } },
  ]);
  await assert.rejects(
    () => model({ apiKey: "k", fetchImpl }).generate({ model: "m", turns: [] }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 400);
      assert.equal(error.retryable, false);
      assert.match(error.message, /additionalProperties/);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("a bad key fails once, with the provider's own message", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 403, payload: { error: { message: "API key not valid" } } },
  ]);
  await assert.rejects(
    () => model({ apiKey: "bad", fetchImpl }).generate({ model: "m", turns: [] }),
    /API key not valid/,
  );
  assert.equal(calls.length, 1);
});

test("the registry's real tool set reaches the wire with no rejected keys", async () => {
  const { fetchImpl, calls } = fakeFetch([answer("done")]);
  const tools = agentToolSet().specs;
  assert.ok(tools.length > 0);

  await model({ apiKey: "k", fetchImpl }).generate({
    model: "m",
    turns: [{ role: "user", text: "go" }],
    tools,
  });

  const wire = JSON.stringify(calls[0].body);
  for (const forbidden of ["additionalProperties", "propertyNames", "$schema", '"default"']) {
    assert.equal(wire.includes(forbidden), false, `${forbidden} reached the wire`);
  }
});

test("a tool with no configurable fields declares no parameters key", () => {
  const declarations = toFunctionDeclarations([
    { name: "no_args", description: "d", parameters: null },
    { name: "with_args", description: "d", parameters: { type: "object", properties: { a: { type: "string" } } } },
  ]) as Array<Record<string, unknown>>;

  assert.equal("parameters" in declarations[0], false);
  assert.ok("parameters" in declarations[1]);
});

test("json mode is dropped when tools are present — Gemini forbids both", async () => {
  const withTools = fakeFetch([answer("{}")]);
  await model({ apiKey: "k", fetchImpl: withTools.fetchImpl }).generate({
    model: "m",
    turns: [{ role: "user", text: "go" }],
    tools: [{ name: "core_log", description: "d", parameters: null }],
    json: true,
  });
  const config = withTools.calls[0].body?.generationConfig as Record<string, unknown>;
  assert.equal("responseMimeType" in config, false);

  const noTools = fakeFetch([answer("{}")]);
  await model({ apiKey: "k", fetchImpl: noTools.fetchImpl }).generate({
    model: "m",
    turns: [{ role: "user", text: "go" }],
    json: true,
  });
  const jsonConfig = noTools.calls[0].body?.generationConfig as Record<string, unknown>;
  assert.equal(jsonConfig.responseMimeType, "application/json");
});

test("listModels keeps text models and drops the rest", async () => {
  const { fetchImpl } = fakeFetch([
    {
      status: 200,
      payload: {
        models: [
          { name: "models/gemini-3.5-flash-lite", displayName: "Flash Lite", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1048576, outputTokenLimit: 65536 },
          { name: "models/gemini-3.8-flash-tts", displayName: "TTS", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-image", displayName: "Nano Banana", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-embedding-2", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemma-4-31b-it", displayName: "Gemma", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.5-computer-use-preview-10-2025", displayName: "CU", supportedGenerationMethods: ["generateContent"] },
        ],
      },
    },
  ]);

  const models = await model({ apiKey: "k", fetchImpl }).listModels();
  assert.deepEqual(models.map((entry) => entry.id), ["gemini-3.5-flash-lite"]);
  assert.equal(models[0].inputTokenLimit, 1048576);
});

test("listModels reports a rejected key rather than returning an empty list", async () => {
  const { fetchImpl } = fakeFetch([
    { status: 400, payload: { error: { message: "API key not valid" } } },
  ]);
  await assert.rejects(() => model({ apiKey: "k", fetchImpl }).listModels(), /API key not valid/);
});

test("usage is reported when the provider sends it", async () => {
  const { fetchImpl } = fakeFetch([answer("OK")]);
  const result = await model({ apiKey: "k", fetchImpl }).generate({ model: "m", turns: [] });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14 });
});
