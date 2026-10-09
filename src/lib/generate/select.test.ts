import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerateRequest, GenerateResult, LanguageModel } from "@/lib/ai/types";
import { describeNodes } from "@/lib/nodes";

import { indexLine } from "./prompt";
import {
  ALWAYS,
  ALWAYS_TRIGGERS,
  MAX_SELECTED,
  MIN_SELECTED,
  selectAll,
  selectDeterministic,
  selectorPrompt,
  selectWithModel,
  stem,
  words,
} from "./select";

/**
 * Phase 34's catalogue selection. The eval set (`eval/eval.test.ts`) proves the selector against
 * requests; these pin the rules it is built from, so a change to one is a decision rather than a
 * side effect.
 */

const nodes = describeNodes();
// Phase 40 (D191): only the three common triggers are sent with every request; the error and form
// triggers are chosen by the request's words like any other node.
const triggers = nodes.filter((node) => node.kind === "trigger").map((node) => node.type);

test("the stemmer brings a word's forms together, the same way on both sides", () => {
  assert.equal(stem("sheets"), stem("sheet"));
  assert.equal(stem("posted"), stem("posting"));
  assert.equal(stem("summarize"), stem("summarise"));
  assert.equal(stem("summarised"), stem("summarise"));
  assert.equal(stem("stories"), "story");
  // An "ss" is not a plural.
  assert.equal(stem("address"), "address");
});

test("words drops stop words and bare numbers, and reads 8am as a time of day", () => {
  assert.deepEqual(words("Post the E-mail to my Slack at 8am, 3 times"), ["post", "email", "slack", "oclock", "tim"]);
});

test("the common triggers, and what is always sent, are selected for any request", () => {
  for (const request of ["", "hello", "post to slack", "SSH into my server"]) {
    const { types } = selectDeterministic(request, nodes);
    for (const type of [...ALWAYS_TRIGGERS, ...ALWAYS]) assert.ok(types.includes(type), `${type} for "${request}"`);
  }
});

test("a request that matches almost nothing still gets general-purpose nodes to build with", () => {
  const { types } = selectDeterministic("SSH into my production server and restart nginx.", nodes);
  const actions = types.filter((type) => !triggers.includes(type));
  assert.ok(actions.length >= MIN_SELECTED, `only ${actions.length} non-trigger nodes`);
});

test("an agent brings its Branch, because the prompt tells the model to route on it with one", () => {
  const { types } = selectDeterministic("Have an AI agent research the request and decide", nodes);
  assert.ok(types.includes("ai.agent"));
  assert.ok(types.includes("core.branch"));
});

test("the selection is bounded, unique, known and in registry order", () => {
  const order = nodes.map((node) => node.type);
  // A request that mentions nearly everything.
  const request = nodes.map((node) => `${node.label} ${node.description}`).join(" ");
  const { types } = selectDeterministic(request, nodes);
  assert.equal(new Set(types).size, types.length);
  assert.deepEqual(types, order.filter((type) => types.includes(type)));
  // Triggers + what is always sent + the cap + one companion at most.
  assert.ok(types.length <= triggers.length + ALWAYS.length + MAX_SELECTED + 1, `${types.length} selected`);
});

test("every node in the registry is selected when a request names it", () => {
  // The property that keeps the selector honest as the registry grows: a node somebody asks for by
  // name is never left as an index line. Its label is the name a person sees in the palette.
  for (const node of nodes) {
    const { types } = selectDeterministic(`Use the ${node.label} step.`, nodes);
    assert.ok(types.includes(node.type), `"${node.label}" did not select ${node.type}`);
  }
});

test("the full strategy is every node, in registry order", () => {
  assert.deepEqual(selectAll(nodes).types, nodes.map((node) => node.type));
});

test("the model selector's prompt is the whole index", () => {
  const prompt = selectorPrompt(nodes);
  for (const node of nodes) assert.ok(prompt.includes(indexLine(node)), node.type);
});

function scripted(answer: string | Error): LanguageModel & { requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  return {
    provider: "fake",
    defaultModel: "fake-1",
    requests,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      requests.push(request);
      if (answer instanceof Error) throw answer;
      return {
        model: request.model,
        text: answer,
        toolCalls: [],
        raw: null,
        usage: { inputTokens: 900, outputTokens: 30, totalTokens: 930 },
        finishReason: "STOP",
        attempts: [],
      };
    },
    async listModels() {
      return [];
    },
  };
}

test("the model selector keeps what the model named, drops what does not exist, and completes the set", async () => {
  const model = scripted(JSON.stringify({ nodes: ["integration.slack", "ai.agent", "integration.teams"] }));
  const selection = await selectWithModel({ model, modelId: "fake-1", request: "x", nodes });
  assert.equal(selection.strategy, "model");
  assert.equal(selection.fellBack, undefined);
  assert.ok(selection.types.includes("integration.slack"));
  assert.ok(!selection.types.includes("integration.teams"));
  // Completed exactly as the deterministic selection is: triggers, what is always sent, companions.
  for (const type of [...ALWAYS_TRIGGERS, ...ALWAYS, "core.branch"]) assert.ok(selection.types.includes(type), type);
  assert.equal(selection.usage?.totalTokens, 930);
  assert.equal(model.requests[0]?.json, true);
});

test("a model selector answer that names nothing usable falls back to the deterministic choice", async () => {
  for (const answer of ["I think you need Slack.", JSON.stringify({ nodes: ["integration.teams"] }), "{}"]) {
    const selection = await selectWithModel({ model: scripted(answer), modelId: "fake-1", request: "post to slack", nodes });
    assert.equal(selection.fellBack, true, answer);
    assert.deepEqual(selection.types, selectDeterministic("post to slack", nodes).types);
  }
});

test("a provider failure in the model selector falls back rather than failing the generation", async () => {
  const selection = await selectWithModel({
    model: scripted(new Error("503 high demand")),
    modelId: "fake-1",
    request: "post to slack",
    nodes,
  });
  assert.equal(selection.fellBack, true);
  assert.ok(selection.types.includes("integration.slack"));
});

test("a cancelled request is not papered over by the fallback", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    selectWithModel({
      model: scripted(new Error("aborted")),
      modelId: "fake-1",
      request: "x",
      nodes,
      signal: controller.signal,
    }),
  );
});
