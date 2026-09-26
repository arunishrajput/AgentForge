import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerateRequest, GenerateResult, LanguageModel } from "@/lib/ai/types";
import { fromFlow, graphsEqual, toFlow } from "@/lib/canvas/bridge";
import { validateGraph } from "@/lib/engine/validate";
import { workflowGraphSchema } from "@/lib/workflow/graph";

import { assembleGraph, generateWorkflow, interpret } from "./generate";
import { generatedWorkflowSchema } from "./schema";

/**
 * Critical-path tests for the headline feature — BUILD_PLAN.md Phase 7, task 6.
 *
 * Every one runs against a scripted model: no network, no quota, no key. What a real
 * model adds is whether it can follow the prompt, which only the deployed check can
 * answer. What these prove is the part that must never regress — that invalid output
 * is rejected rather than persisted, that the retry happens exactly once, and that a
 * generated graph survives the canvas round-trip.
 */

/** Returns each scripted answer in turn, and records what it was asked. */
function scriptedModel(answers: string[]): LanguageModel & { requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  let index = 0;

  return {
    provider: "fake",
    defaultModel: "fake-1",
    requests,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      requests.push(structuredClone({ ...request, signal: undefined }));
      const text = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return {
        model: request.model,
        text,
        toolCalls: [],
        raw: { role: "model", parts: [{ text }] },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        finishReason: "STOP",
        attempts: [],
      };
    },
    async listModels() {
      return [];
    },
  };
}

/**
 * The shape of the demo request: a trigger, an agent that decides, a branch that
 * routes on the decision, and a different action on each side. This is the graph
 * `DEMO.md` Beat 3 shows, expressed with the nodes the registry holds today.
 */
const DEMO_ANSWER = JSON.stringify({
  name: "Triage support messages",
  description: "Summarises an incoming message and escalates the urgent ones.",
  nodes: [
    { id: "trigger", type: "core.manual_trigger", config: {} },
    {
      id: "triage",
      type: "ai.agent",
      label: "Decide urgency",
      config: {
        objective: "Read the support message in {{input.message}} and decide whether it is urgent.",
        choices: ["urgent", "normal"],
        tools: ["core.log"],
      },
    },
    {
      id: "route",
      type: "core.branch",
      config: { left: "{{input.decision}}", operator: "equals", right: "urgent" },
    },
    { id: "escalate", type: "core.log", config: { message: "Urgent: {{input.reason}}", level: "warn" } },
    { id: "queue", type: "core.log", config: { message: "Queued: {{input.reason}}" } },
  ],
  edges: [
    { source: "trigger", target: "triage" },
    { source: "triage", target: "route" },
    { source: "route", target: "escalate", sourceHandle: "true" },
    { source: "route", target: "queue", sourceHandle: "false" },
  ],
});

const generate = (answers: string[], name?: string) =>
  generateWorkflow({
    model: scriptedModel(answers),
    modelId: "fake-1",
    prompt: "Summarise incoming support messages and escalate the urgent ones.",
    ...(name === undefined ? {} : { name }),
  });

test("the demo prompt produces a valid, runnable workflow", async () => {
  const result = await generate([DEMO_ANSWER]);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.name, "Triage support messages");
  assert.equal(result.graph.nodes.length, 5);
  assert.equal(result.graph.edges.length, 4);
  assert.ok(validateGraph(result.graph).valid, "the generated graph must be runnable");
  assert.equal(result.attempts.length, 1, "a valid answer must not be retried");
});

test("the system supplies version, positions and edge ids; the model does not", async () => {
  const result = await generate([DEMO_ANSWER]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.graph.version, 1);
  assert.deepEqual(
    result.graph.edges.map((edge) => edge.id),
    ["e1", "e2", "e3", "e4"],
  );
  for (const node of result.graph.nodes) {
    assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
  }
  // A branch's two targets must not land on top of each other.
  const escalate = result.graph.nodes.find((node) => node.id === "escalate")!;
  const queue = result.graph.nodes.find((node) => node.id === "queue")!;
  assert.notDeepEqual(escalate.position, queue.position);
});

test("an absent label stays absent rather than becoming undefined", async () => {
  const result = await generate([DEMO_ANSWER]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const trigger = result.graph.nodes.find((node) => node.id === "trigger")!;
  assert.ok(!("label" in trigger), "CONTRACT.md: an absent label is never written");
  assert.equal(result.graph.nodes.find((node) => node.id === "triage")!.label, "Decide urgency");
});

test("a generated workflow round-trips through the canvas and through JSON", async () => {
  const result = await generate([DEMO_ANSWER]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const flow = toFlow(result.graph);
  assert.deepEqual(fromFlow(flow.nodes, flow.edges), result.graph);

  // What a jsonb column gives back: same data, reordered keys. `graphsEqual` is the
  // structural comparison the canvas uses for dirty state (D25).
  const throughJson = workflowGraphSchema.parse(JSON.parse(JSON.stringify(result.graph)));
  assert.ok(graphsEqual(throughJson, result.graph));
});

test("a model that answers with prose is rejected, not persisted", async () => {
  const result = await generate(["Sure! Here is a workflow you might like."]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.issues[0].code, "not_json");
  assert.match(result.message, /did not return a workflow/);
});

test("a fenced JSON answer is still accepted", async () => {
  const result = await generate(["```json\n" + DEMO_ANSWER + "\n```"]);
  assert.equal(result.ok, true);
});

test("output naming a node type that does not exist is rejected", async () => {
  const answer = JSON.stringify({
    name: "Post to Slack",
    nodes: [
      { id: "trigger", type: "core.manual_trigger", config: {} },
      { id: "post", type: "integration.slack", config: {} },
    ],
    edges: [{ source: "trigger", target: "post" }],
  });

  const result = await generate([answer, answer]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === "unknown_node_type"));
});

test("output with no trigger is rejected", async () => {
  const answer = JSON.stringify({
    name: "Just a log",
    nodes: [{ id: "log", type: "core.log", config: { message: "hi" } }],
    edges: [],
  });

  const result = await generate([answer, answer]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === "no_trigger"));
});

test("output whose edges point at nothing is rejected", async () => {
  const answer = JSON.stringify({
    name: "Dangling",
    nodes: [{ id: "trigger", type: "core.manual_trigger", config: {} }],
    edges: [{ source: "trigger", target: "ghost" }],
  });

  const result = await generate([answer, answer]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === "dangling_edge"));
});

test("output using a handle the source node does not declare is rejected", async () => {
  const answer = JSON.stringify({
    name: "Bad handle",
    nodes: [
      { id: "trigger", type: "core.manual_trigger", config: {} },
      { id: "log", type: "core.log", config: {} },
    ],
    // core.log has one default output; "true" is a branch's handle.
    edges: [{ source: "trigger", target: "log", sourceHandle: "true" }],
  });

  const result = await generate([answer, answer]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === "unknown_output_handle"));
});

test("output missing a required config field is rejected", async () => {
  const answer = JSON.stringify({
    name: "Agent with no objective",
    nodes: [
      { id: "trigger", type: "core.manual_trigger", config: {} },
      { id: "think", type: "ai.agent", config: { choices: ["a", "b"] } },
    ],
    edges: [{ source: "trigger", target: "think" }],
  });

  const result = await generate([answer, answer]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === "invalid_config"));
});

test("output that is JSON but not the expected shape is rejected", async () => {
  const result = await generate(['{"workflow":{"steps":["do a thing"]}}', '{"still":"wrong"}']);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === "bad_shape"));
});

test("an invalid first answer is retried exactly once, and a fixed second answer is accepted", async () => {
  const model = scriptedModel(["not json at all", DEMO_ANSWER]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "triage messages" });

  assert.equal(result.ok, true);
  assert.equal(model.requests.length, 2, "exactly one retry");

  // The retry must carry the model's own turn back verbatim (D33) and then say what
  // was wrong — a model told its own mistake fixes it; one merely asked again repeats it.
  const retry = model.requests[1];
  assert.equal(retry.turns.length, 3);
  assert.equal(retry.turns[1].role, "model");
  assert.deepEqual((retry.turns[1] as { raw: unknown }).raw, {
    role: "model",
    parts: [{ text: "not json at all" }],
  });
  assert.match((retry.turns[2] as { text: string }).text, /rejected/);
});

test("two invalid answers fail with a readable message and never a third call", async () => {
  const model = scriptedModel(["nope", "still nope"]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "triage messages" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(model.requests.length, 2, "no repair loop beyond one retry");
  assert.equal(result.attempts.length, 2);
  assert.ok(result.message.length > 0);
});

test("generation asks for JSON mode and sends no tools", async () => {
  const model = scriptedModel([DEMO_ANSWER]);
  await generateWorkflow({ model, modelId: "fake-1", prompt: "triage messages" });

  const request = model.requests[0];
  assert.equal(request.json, true);
  // Gemini forbids JSON mode together with tools, so generation must send none.
  assert.equal(request.tools, undefined);
  assert.ok(request.system!.includes("core.manual_trigger"), "the registry is in the prompt");
});

test("a provider failure propagates rather than being reported as bad output", async () => {
  const model: LanguageModel = {
    provider: "fake",
    defaultModel: "fake-1",
    async generate() {
      throw new Error("API key not valid");
    },
    async listModels() {
      return [];
    },
  };

  await assert.rejects(
    generateWorkflow({ model, modelId: "fake-1", prompt: "triage messages" }),
    /API key not valid/,
  );
});

test("an explicit name overrides the title the model chose", async () => {
  const result = await generate([DEMO_ANSWER], "My own name");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.name, "My own name");
});

test("interpret is the whole gate: nothing reaches a graph without passing validation", () => {
  const rejected = interpret('{"name":"x","nodes":[],"edges":[]}');
  assert.equal(rejected.ok, false);

  const accepted = interpret(DEMO_ANSWER);
  assert.equal(accepted.ok, true);
});

test("a model that omits config entirely still produces a graph with an object config", () => {
  const parsed = generatedWorkflowSchema.parse({
    name: "Minimal",
    nodes: [{ id: "trigger", type: "core.manual_trigger" }],
    edges: [],
  });

  const graph = assembleGraph(parsed);
  assert.deepEqual(graph.nodes[0].config, {});
});

test("what the model could not build is reported, not swallowed", async () => {
  const answer = JSON.stringify({
    name: "Summarise and post",
    nodes: [
      { id: "trigger", type: "core.manual_trigger", config: {} },
      { id: "summarise", type: "ai.llm", config: { prompt: "Summarise {{trigger.message}}" } },
    ],
    edges: [{ source: "trigger", target: "summarise" }],
    unsupported: ["post the summary to Discord", "add a row to a Google Sheet"],
  });

  const result = await generate([answer]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.unsupported, [
    "post the summary to Discord",
    "add a row to a Google Sheet",
  ]);
  // The buildable part is still a real, runnable workflow.
  assert.ok(validateGraph(result.graph).valid);
});

test("a fully supported request reports no gaps", async () => {
  const result = await generate([DEMO_ANSWER]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.unsupported, [], "an omitted `unsupported` defaults to empty");
});
