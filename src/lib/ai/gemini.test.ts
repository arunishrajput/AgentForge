import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { modelHealthSnapshot, resetModelHealth } from "./health";
import { agentToolSet } from "./tools";
import {
  DEFAULT_MODEL,
  FALLBACK_MODELS,
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

/**
 * The breaker is per-process state shared by every model built here, so each test
 * starts from a clean one. Without this a 503 in one test reorders another's chain and
 * the suite passes or fails on file order.
 */
beforeEach(() => resetModelHealth());

/**
 * A fetch that accepts the request and then says nothing — the Phase 12 failure mode.
 * It rejects only when the caller's own signal aborts, which is what makes the
 * adapter's budget, rather than the fake, decide how long the attempt takes.
 */
function hangingFetch(hangs: number): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl: FetchLike = (url, init) => {
    calls.push(url);
    const hang = index < hangs;
    index += 1;
    if (!hang) {
      return Promise.resolve({ status: 200, json: async () => answer("from the fallback").payload });
    }
    return new Promise((_resolve, reject) => {
      const signal = init.signal;
      if (!signal) return;
      signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        reject(error);
      });
    });
  };
  return { fetchImpl, calls };
}

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


/**
 * Phase 13 — the latency regression tests.
 *
 * Each of these fails against the Chapter 1 adapter, which retried a timed-out model in
 * place with a 45 s budget and no overall deadline. That is the code path that made one
 * `ai.agent` step cost 91.9 s on 2026-09-26.
 */

test("a model that hangs is not given a second chance — the chain moves on", async () => {
  const { fetchImpl, calls } = hangingFetch(1);
  const started = Date.now();

  const result = await model({
    apiKey: "k",
    fetchImpl,
    attemptTimeoutMs: 300,
    fallbacks: ["primary", "second"],
  }).generate({ model: "primary", turns: [{ role: "user", text: "hi" }] });

  const elapsed = Date.now() - started;

  assert.equal(result.model, "second");
  // Two calls, not three: the wedged model is tried ONCE and then abandoned. The old
  // adapter made two attempts on it before moving on, which is the whole 90 s.
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((url) => url.includes("primary")).length, 1);
  // One timeout, not two.
  assert.ok(elapsed < 900, `took ${elapsed} ms; one 300 ms timeout was expected`);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), [0, 200]);
  assert.match(result.attempts[0].error!, /no answer within 300 ms/);
});

test("the whole call is bounded by a total budget, however many models fail", async () => {
  // Every model hangs. The old adapter would spend attempts × models × timeout here.
  const { fetchImpl, calls } = hangingFetch(99);
  const started = Date.now();

  await assert.rejects(
    () =>
      model({
        apiKey: "k",
        fetchImpl,
        attemptTimeoutMs: 400,
        totalBudgetMs: 1_000,
        fallbacks: ["a", "b", "c", "d", "e"],
      }).generate({ model: "a", turns: [] }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /No model answered within|Could not reach/);
      return true;
    },
  );

  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1_800, `took ${elapsed} ms against a 1000 ms budget`);
  // It stopped because the budget ran out, not because it ran out of models.
  assert.ok(calls.length < 5, `made ${calls.length} attempts; the budget should have cut it short`);
});

test("a wedged model is skipped on the NEXT call, not rediscovered", async () => {
  // The breaker's real payoff. One request pays the timeout; the one after it does not.
  const first = hangingFetch(1);
  await model({
    apiKey: "k",
    fetchImpl: first.fetchImpl,
    attemptTimeoutMs: 200,
    fallbacks: ["primary", "second"],
  }).generate({ model: "primary", turns: [] });

  // One timeout is a degrade, not an open breaker. A second request makes it two.
  const second = hangingFetch(1);
  await model({
    apiKey: "k",
    fetchImpl: second.fetchImpl,
    attemptTimeoutMs: 200,
    fallbacks: ["primary", "second"],
  }).generate({ model: "primary", turns: [] });

  const third = hangingFetch(0);
  const started = Date.now();
  const result = await model({
    apiKey: "k",
    fetchImpl: third.fetchImpl,
    attemptTimeoutMs: 200,
    fallbacks: ["primary", "second"],
  }).generate({ model: "primary", turns: [] });

  assert.equal(result.model, "second", "the breaker should have reordered the chain");
  assert.equal(third.calls.length, 1, "the known-bad model should not be called at all");
  assert.ok(Date.now() - started < 150, "no timeout should be paid on the third call");
});

test("health records what happened, so a fallback is inspectable rather than buried", async () => {
  const { fetchImpl } = hangingFetch(1);
  await model({
    apiKey: "k",
    fetchImpl,
    attemptTimeoutMs: 200,
    fallbacks: ["primary", "second"],
  }).generate({ model: "primary", turns: [] });

  const snapshot = modelHealthSnapshot();
  const primary = snapshot.find((entry) => entry.model === "primary")!;
  const second = snapshot.find((entry) => entry.model === "second")!;

  assert.equal(primary.state, "degraded");
  assert.match(primary.lastError!, /no answer within/);
  assert.equal(second.state, "healthy");
  assert.equal(second.successes, 1);
});

test("a 404 moves to the next model — another model can absolutely fix 'no longer available'", async () => {
  // Chapter 1 shipped three names that later answered 404. Treating it as fatal meant a
  // retired model took the whole run down when a fallback was sitting right there.
  const { fetchImpl, calls } = fakeFetch([
    { status: 404, payload: { error: { message: "no longer available to new users" } } },
    answer("from the fallback"),
  ]);

  const result = await model({
    apiKey: "k",
    fetchImpl,
    fallbacks: ["retired", "current"],
  }).generate({ model: "retired", turns: [] });

  assert.equal(result.model, "current");
  // Tried once. A 404 is permanent, so there is nothing to retry in place.
  assert.equal(calls.filter((call) => call.url.includes("retired")).length, 1);
  assert.equal(modelHealthSnapshot().find((entry) => entry.model === "retired")!.state, "unavailable");
});

test("a bad key still fails fast and leaves every model's health untouched", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 403, payload: { error: { message: "API key not valid" } } },
  ]);

  await assert.rejects(
    () => model({ apiKey: "bad", fetchImpl, fallbacks: ["a", "b"] }).generate({ model: "a", turns: [] }),
    /API key not valid/,
  );

  assert.equal(calls.length, 1, "a rejected key must not be tried against the whole chain");
  assert.deepEqual(modelHealthSnapshot(), [], "a bad key says nothing about any model");
});

test("ignoreHealth pins a probe to the model it was asked about", async () => {
  // settings.ts verifies a user's model choice with one real call. The breaker must not
  // reorder that away, and a deliberate probe of a bad model must not skew health.
  const { fetchImpl, calls } = fakeFetch([
    { status: 503, payload: { error: { message: "high demand" } } },
    { status: 503, payload: { error: { message: "high demand" } } },
  ]);

  await assert.rejects(
    () =>
      model({ apiKey: "k", fetchImpl, fallbacks: [], ignoreHealth: true }).generate({
        model: "chosen",
        turns: [],
      }),
    /high demand/,
  );

  assert.ok(calls.every((call) => call.url.includes("chosen")));
  assert.deepEqual(modelHealthSnapshot(), []);
});

test("the default chain is the one the probe measured, fastest first", () => {
  // Guards against a model name drifting back in from memory. Re-run
  // `scripts/probe-models.mjs` and update both places if this fails legitimately.
  assert.deepEqual(FALLBACK_MODELS, [
    "gemini-3-flash-preview",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ]);
  assert.equal(DEFAULT_MODEL, "gemini-3-flash-preview");
  // The model that hung for 91.9 s in Phase 12 is no longer tried first.
  assert.notEqual(DEFAULT_MODEL, "gemini-3.5-flash-lite");
});

test("an already-aborted run never reaches the provider", async () => {
  // The engine cancels at its deadline. Spending a model call after that is spending
  // the user's quota on a result nobody will read.
  const { fetchImpl, calls } = fakeFetch([answer("too late")]);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      model({ apiKey: "k", fetchImpl }).generate({
        model: "m",
        turns: [],
        signal: controller.signal,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.retryable, false);
      assert.match(error.message, /stopped before the model answered/);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test("a transport error that is not a timeout IS retried on the same model", async () => {
  // The distinction Phase 13 draws. A socket that died is worth one more try; a model
  // that accepted the request and went quiet is not.
  let attempt = 0;
  const fetchImpl: FetchLike = async () => {
    attempt += 1;
    if (attempt === 1) throw new TypeError("fetch failed");
    return { status: 200, json: async () => answer("recovered").payload };
  };

  const result = await model({ apiKey: "k", fetchImpl, fallbacks: ["a", "b"] }).generate({
    model: "a",
    turns: [],
  });

  assert.equal(result.text, "recovered");
  assert.equal(result.model, "a", "it recovered in place rather than falling back");
  assert.equal(attempt, 2);
});

test("a provider error with no message still says something useful", async () => {
  const { fetchImpl } = fakeFetch([{ status: 500, payload: {} }]);
  await assert.rejects(
    () => model({ apiKey: "k", fetchImpl, fallbacks: [] }).generate({ model: "m", turns: [] }),
    /Gemini returned HTTP 500/,
  );
});

test("a caller may raise the budget for one request without changing the default", async () => {
  // An `ai.llm` node with a very large prompt is the case this exists for.
  const { fetchImpl, calls } = hangingFetch(1);
  const started = Date.now();

  const result = await model({
    apiKey: "k",
    fetchImpl,
    attemptTimeoutMs: 50_000,
    fallbacks: ["primary", "second"],
  }).generate({ model: "primary", turns: [], timeoutMs: 250 });

  // `timeoutMs` narrowed the 50 s default to 250 ms, so the hang cost 250 ms, not 50 s.
  assert.ok(Date.now() - started < 900, "the per-request budget should have won");
  assert.equal(result.model, "second");
  assert.equal(calls.length, 2);
});
