import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_AGENT_ITERATIONS,
  HARD_MAX_AGENT_ITERATIONS,
  runAgentLoop,
} from "./loop";
import type { GenerateRequest, GenerateResult, LanguageModel, ToolCall } from "./types";

/**
 * A scripted model. `turns` is what it returns on each successive call, so a loop that
 * should stop after two model calls can be proven to have made exactly two.
 */
function scriptedModel(
  turns: Array<{ text?: string; toolCalls?: ToolCall[] }>,
  options: { answeredBy?: string } = {},
): LanguageModel & { requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  let index = 0;

  const model = {
    provider: "fake",
    defaultModel: "fake-1",
    requests,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      requests.push(structuredClone({ ...request, signal: undefined }));
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      return {
        model: options.answeredBy ?? request.model,
        text: turn.text ?? "",
        toolCalls: turn.toolCalls ?? [],
        raw: { role: "model", parts: [{ text: turn.text ?? "" }] },
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        finishReason: "STOP",
        attempts: [],
      };
    },
    async listModels() {
      return [];
    },
  };

  return model;
}

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: `c${Math.random().toString(36).slice(2, 7)}`,
  name,
  args,
});

const base = {
  modelId: "fake-1",
  system: "You are a test agent.",
  objective: "Do the thing.",
  tools: [{ name: "core_log", description: "Logs.", parameters: null }],
};

test("a model that answers straight away makes one call and stops", async () => {
  const model = scriptedModel([{ text: "Done." }]);
  const result = await runAgentLoop({ ...base, model, runTool: async () => null });

  assert.equal(result.stopped, "answered");
  assert.equal(result.text, "Done.");
  assert.equal(result.iterations, 1);
  assert.equal(model.requests.length, 1);
  assert.deepEqual(result.toolCalls, []);
});

test("a tool call is executed and its result fed back before the next turn", async () => {
  const model = scriptedModel([
    { toolCalls: [call("core_log", { message: "hello" })] },
    { text: "Logged it." },
  ]);
  const seen: ToolCall[] = [];

  const result = await runAgentLoop({
    ...base,
    model,
    runTool: async (toolCall) => {
      seen.push(toolCall);
      return { ok: true };
    },
  });

  assert.equal(result.stopped, "answered");
  assert.equal(result.text, "Logged it.");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].args, { message: "hello" });

  // The second request carries the model turn and the tool turn, in that order.
  const second = model.requests[1];
  assert.equal(second.turns.length, 3);
  assert.equal(second.turns[1].role, "model");
  assert.equal(second.turns[2].role, "tool");
  assert.equal(result.toolCalls[0].ok, true);
});

test("the model turn is carried forward with its raw payload intact", async () => {
  // The lossless-history property, at the loop level: without `raw`, Gemini rejects
  // the follow-up request with a 400 about a missing thought_signature.
  const model = scriptedModel([{ toolCalls: [call("core_log")] }, { text: "ok" }]);
  await runAgentLoop({ ...base, model, runTool: async () => null });

  const forwarded = model.requests[1].turns[1];
  assert.equal(forwarded.role, "model");
  assert.ok(forwarded.role === "model" && forwarded.raw !== null);
});

test("several tool calls in one turn are all executed and answered together", async () => {
  const model = scriptedModel([
    { toolCalls: [call("core_log", { message: "a" }), call("core_log", { message: "b" })] },
    { text: "both done" },
  ]);
  const ran: string[] = [];

  const result = await runAgentLoop({
    ...base,
    model,
    runTool: async (toolCall) => {
      ran.push(String(toolCall.args.message));
      return null;
    },
  });

  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(result.toolCalls.length, 2);
  // One tool turn holding both results, not two turns.
  const turn = model.requests[1].turns[2];
  assert.equal(turn.role, "tool");
  assert.equal(turn.role === "tool" && turn.results.length, 2);
});

test("a model that never converges is stopped by the cap", async () => {
  // Measured against the live API: a model told to call a tool forever does exactly
  // that. This is the property that stops it costing the user their quota.
  const model = scriptedModel([{ toolCalls: [call("core_log", { message: "again" })] }]);
  const result = await runAgentLoop({
    ...base,
    model,
    runTool: async () => null,
    maxIterations: 3,
  });

  assert.equal(result.stopped, "cap");
  assert.equal(result.iterations, 3);
  assert.equal(model.requests.length, 3);
  assert.equal(result.toolCalls.length, 3);
});

test("the cap cannot be raised above the hard ceiling", async () => {
  const model = scriptedModel([{ toolCalls: [call("core_log")] }]);
  const result = await runAgentLoop({
    ...base,
    model,
    runTool: async () => null,
    maxIterations: 1000,
  });

  assert.equal(result.iterations, HARD_MAX_AGENT_ITERATIONS);
  assert.equal(result.stopped, "cap");
});

test("a nonsense cap falls back to the default rather than looping unbounded", async () => {
  const model = scriptedModel([{ toolCalls: [call("core_log")] }]);
  for (const bad of [0, -5, Number.NaN]) {
    const result = await runAgentLoop({
      ...base,
      model: scriptedModel([{ toolCalls: [call("core_log")] }]),
      runTool: async () => null,
      maxIterations: bad,
    });
    assert.ok(result.iterations >= 1 && result.iterations <= HARD_MAX_AGENT_ITERATIONS);
  }
  const unset = await runAgentLoop({ ...base, model, runTool: async () => null });
  assert.equal(unset.iterations, DEFAULT_AGENT_ITERATIONS);
});

test("a failing tool is reported to the model instead of failing the step", async () => {
  const model = scriptedModel([
    { toolCalls: [call("core_log", { message: "x" })] },
    { text: "recovered" },
  ]);

  const result = await runAgentLoop({
    ...base,
    model,
    runTool: async () => {
      throw new Error("Invalid config: message too long");
    },
  });

  assert.equal(result.stopped, "answered");
  assert.equal(result.text, "recovered");
  assert.equal(result.toolCalls[0].ok, false);
  assert.match(String(result.toolCalls[0].error), /message too long/);

  const turn = model.requests[1].turns[2];
  assert.equal(turn.role, "tool");
  assert.deepEqual(turn.role === "tool" && turn.results[0].result, {
    error: "Invalid config: message too long",
  });
});

test("every tool call is logged, so the canvas shows the reasoning live", async () => {
  // D30: log lines are persisted as written, so these appear while the node still runs.
  const model = scriptedModel([{ toolCalls: [call("core_log", { message: "a" })] }, { text: "done" }]);
  const lines: string[] = [];

  await runAgentLoop({
    ...base,
    model,
    runTool: async () => ({ ok: true }),
    log: (message) => lines.push(message),
  });

  assert.ok(lines.some((line) => line.includes("Calling tool core_log")));
  assert.ok(lines.some((line) => line.includes('"message":"a"')));
  assert.ok(lines.some((line) => line.includes("returned in")));
  assert.ok(lines.some((line) => line.includes("Model answered: done")));
});

test("a fallback model is announced rather than swallowed", async () => {
  const model = scriptedModel([{ text: "ok" }], { answeredBy: "gemini-3.1-flash-lite" });
  const lines: Array<{ message: string; level?: string }> = [];

  const result = await runAgentLoop({
    ...base,
    model,
    runTool: async () => null,
    log: (message, level) => lines.push({ message, level }),
  });

  assert.equal(result.model, "gemini-3.1-flash-lite");
  const warning = lines.find((line) => line.level === "warn");
  assert.ok(warning, "a fallback produced no warning");
  assert.match(warning.message, /unavailable/);
});

test("usage is summed across every model call", async () => {
  const model = scriptedModel([{ toolCalls: [call("core_log")] }, { text: "done" }]);
  const result = await runAgentLoop({ ...base, model, runTool: async () => null });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14 });
});
