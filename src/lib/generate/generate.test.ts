import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerateRequest, GenerateResult, LanguageModel } from "@/lib/ai/types";
import { fromFlow, graphsEqual, toFlow } from "@/lib/canvas/bridge";
import { validateGraph } from "@/lib/engine/validate";
import { workflowGraphSchema } from "@/lib/workflow/graph";

import { describeNodes } from "@/lib/nodes";

import { checkReferences } from "./references";
import { assembleGraph, generateWorkflow, generationLogFields, interpret, undefinedTypesUsed } from "./generate";
import { generatable, NOT_GENERATED } from "./prompt";
import { selectDeterministic } from "./select";
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
    // The agent's reason, reached by its id: after a Branch, `input` is the branch's own
    // `{ matched, input }`, so `{{input.reason}}` here would be empty. This fixture wrote exactly
    // that until Phase 34's reference check read it.
    { id: "escalate", type: "core.log", config: { message: "Urgent: {{steps.triage.output.reason}}", level: "warn" } },
    { id: "queue", type: "core.log", config: { message: "Queued: {{steps.triage.output.reason}}" } },
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
  // Runnable is not enough: every reference must reach something (Phase 34).
  assert.deepEqual(checkReferences(result.graph), []);
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
  // The stand-in used to be `integration.slack`, and Phase 23B registered it — so this test
  // passed for six phases and then asserted the opposite of its own name. The replacement is
  // deliberately a type nobody would ever build, because the failure mode is silent: a test
  // for "rejects the unknown" whose example has quietly become known proves nothing at all.
  const answer = JSON.stringify({
    name: "Post to a service that does not exist",
    nodes: [
      { id: "trigger", type: "core.manual_trigger", config: {} },
      { id: "post", type: "integration.no_such_service", config: {} },
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

/**
 * Phase 12. Five of twelve generations of the pinned demo prompt wrote
 * `maxIterations: 1` on the agent — schema-valid, graph-valid, and a guaranteed
 * runtime failure the moment the agent reaches for a tool. These assert the guarantee
 * rather than the prompt rule, because a rule a model follows most of the time is not
 * a property.
 */
test("a generated agent budget too small to ever succeed is dropped to the default", () => {
  const parsed = generatedWorkflowSchema.parse({
    name: "Triage",
    nodes: [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "classify", type: "ai.agent", config: { objective: "decide", maxIterations: 1 } },
    ],
    edges: [{ source: "trigger", target: "classify" }],
  });

  const graph = assembleGraph(parsed);
  // Removed, not clamped: absent means the registry default applies, and the default
  // is the one number that stays right when it changes.
  assert.equal("maxIterations" in graph.nodes[1].config, false);
  assert.equal(graph.nodes[1].config.objective, "decide");
});

test("an agent budget the model chose deliberately is left exactly alone", () => {
  const parsed = generatedWorkflowSchema.parse({
    name: "Triage",
    nodes: [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "deep", type: "ai.agent", config: { objective: "research", maxIterations: 7 } },
    ],
    edges: [{ source: "trigger", target: "deep" }],
  });

  assert.equal(assembleGraph(parsed).nodes[1].config.maxIterations, 7);
});

test("the budget guard touches agent nodes only", () => {
  const parsed = generatedWorkflowSchema.parse({
    name: "Loop",
    nodes: [
      { id: "trigger", type: "core.manual_trigger" },
      // A loop's own bound of 1 is a legitimate thing to ask for and is not an agent.
      { id: "each", type: "core.loop", config: { maxIterations: 1 } },
    ],
    edges: [{ source: "trigger", target: "each" }],
  });

  assert.equal(assembleGraph(parsed).nodes[1].config.maxIterations, 1);
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

test("a generated workflow never arrives with a note, a node switched off, or a pin", async () => {
  // Phase 30, D136. Notes are for people, and a workflow must not arrive with steps already
  // off. The schema the model's output is parsed with names neither field, and
  // `assembleGraph` builds every node field by field, so a model that emits them — as one
  // shown a pasted graph eventually will — has them dropped, not stored.
  const answer = JSON.parse(DEMO_ANSWER);
  answer.nodes[1].disabled = true;
  answer.nodes[3].disabled = false;
  answer.notes = [
    { id: "note_1", position: { x: 0, y: 0 }, size: { width: 240, height: 140 }, text: "hi", tone: "yellow" },
  ];
  // Phase 31 (D138): a pinned output is test data a person captured, never a model's to invent.
  answer.nodes[2].pinned = { output: { invented: true } };

  const result = await generate([JSON.stringify(answer)]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal("notes" in result.graph, false);
  assert.ok(result.graph.nodes.every((node) => !("disabled" in node)), JSON.stringify(result.graph.nodes));
  assert.ok(result.graph.nodes.every((node) => !("pinned" in node)), JSON.stringify(result.graph.nodes));
  // And nothing about it counts as a failure worth a retry.
  assert.equal(result.attempts.length, 1);
});

/* ------------------------------------------------------------------ *
 * Phase 34 — catalogue selection, the retry's safety net, the log line
 * ------------------------------------------------------------------ */

const definedIn = (system: string) => [...system.matchAll(/^ {2}- type: "([^"]+)"/gm)].map((match) => match[1]);

test("by default a request is sent full definitions only for the nodes selected for it", async () => {
  const model = scriptedModel([DEMO_ANSWER]);
  const prompt = "triage support messages, decide which are urgent and log them";
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt });

  assert.equal(result.ok, true);
  const expected = selectDeterministic(prompt, describeNodes());
  assert.deepEqual(result.selection, expected);
  assert.deepEqual(definedIn(model.requests[0]!.system!), expected.types);
  assert.ok(expected.types.length < describeNodes().length, "a selection, not the whole catalogue");
  assert.equal(result.promptChars, model.requests[0]!.system!.length);
});

test("the full strategy still sends every definition", async () => {
  const model = scriptedModel([DEMO_ANSWER]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "x", catalogue: { strategy: "full" } });
  assert.equal(result.selection.strategy, "full");
  // Every definition the generator is offered: all of them but the nodes it cannot use (D188).
  assert.deepEqual(definedIn(model.requests[0]!.system!), generatable(describeNodes()).map((node) => node.type));
});

test("a generation is never offered Call workflow — it cannot know a workflow's id — and an edit keeps it only where it is already used", async () => {
  const model = scriptedModel([DEMO_ANSWER]);
  await generateWorkflow({ model, modelId: "fake-1", prompt: "run my welcome workflow", catalogue: { strategy: "full" } });
  const system = model.requests[0]!.system!;
  assert.ok(!definedIn(system).includes("core.call_workflow"), "its definition is not in the prompt");
  assert.ok(!system.includes('"core.call_workflow"'), "and neither is its index line");

  // The registry still has it, the picker still offers it, and the graph an edit starts from may use it.
  const all = describeNodes();
  assert.ok(all.some((node) => node.type === "core.call_workflow"));
  assert.ok(!generatable(all).some((node) => node.type === "core.call_workflow"));
  assert.ok(generatable(all, ["core.call_workflow"]).some((node) => node.type === "core.call_workflow"));
  for (const type of NOT_GENERATED) assert.ok(all.some((node) => node.type === type), `${type} is a registered node`);
});

test("the model strategy spends one call choosing, then generates with what it chose", async () => {
  const model = scriptedModel([JSON.stringify({ nodes: ["integration.slack", "core.log"] }), DEMO_ANSWER]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "post to slack", catalogue: { strategy: "model" } });

  assert.equal(result.ok, true);
  assert.equal(model.requests.length, 2);
  assert.match(model.requests[0]!.system!, /You choose the building blocks/);
  assert.equal(result.selection.strategy, "model");
  const defined = definedIn(model.requests[1]!.system!);
  assert.ok(defined.includes("integration.slack") && defined.includes("core.log"));
  assert.ok(!defined.includes("integration.github"));
});

test("a node the model reached from the index alone is defined in full on the retry", async () => {
  // The selector's safety net: Slack was asked for, Airtable was not, and the model used Airtable
  // with a config its index line could not tell it. The retry must hand it Airtable's definition.
  const reachedUndefined = JSON.stringify({
    name: "x",
    nodes: [
      { id: "trigger", type: "core.manual_trigger", config: {} },
      { id: "file", type: "integration.airtable", config: { operation: "deleteRecord" } },
    ],
    edges: [{ source: "trigger", target: "file" }],
  });
  const model = scriptedModel([reachedUndefined, DEMO_ANSWER]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "post a message to slack" });

  assert.equal(result.ok, true);
  assert.ok(!result.selection.types.includes("integration.airtable"), "the premise: Airtable was not selected");
  const retry = (model.requests[1]!.turns[2] as { text: string }).text;
  assert.match(retry, /Full definitions of the nodes you used that were only listed/);
  assert.match(retry, /type: "integration\.airtable"/);
  assert.match(retry, /operation: one of "createRecord" \| "listRecords"/);
});

test("a retry adds no definitions when every node the answer used was already defined", async () => {
  const model = scriptedModel(["not json at all", DEMO_ANSWER]);
  await generateWorkflow({ model, modelId: "fake-1", prompt: "triage messages" });
  assert.ok(!(model.requests[1]!.turns[2] as { text: string }).text.includes("Full definitions"));
});

test("undefinedTypesUsed reads only real types the prompt did not define", () => {
  const selection = { strategy: "deterministic" as const, types: ["core.manual_trigger", "core.log"] };
  const nodes = describeNodes();
  const answer = JSON.stringify({
    nodes: [{ type: "core.log" }, { type: "integration.slack" }, { type: "integration.teams" }, { type: 7 }, "x"],
  });
  assert.deepEqual(undefinedTypesUsed(answer, selection, nodes), ["integration.slack"]);
  assert.deepEqual(undefinedTypesUsed("not json", selection, nodes), []);
  assert.deepEqual(undefinedTypesUsed("[]", selection, nodes), []);
});

test("the log line says which attempt produced the graph, and carries no prompt or answer", async () => {
  const first = await generateWorkflow({ model: scriptedModel([DEMO_ANSWER]), modelId: "fake-1", prompt: "a secret request" });
  const second = await generateWorkflow({ model: scriptedModel(["nope", DEMO_ANSWER]), modelId: "fake-1", prompt: "a secret request" });
  const failed = await generateWorkflow({ model: scriptedModel(["nope", "nope"]), modelId: "fake-1", prompt: "a secret request" });

  assert.equal(generationLogFields(first, 10).outcome, "first");
  assert.equal(generationLogFields(second, 10).outcome, "second");
  const failedFields = generationLogFields(failed, 10);
  assert.equal(failedFields.outcome, "failed");
  assert.equal(failedFields.attempts, 2);
  assert.equal(failedFields.issues, 1);

  const fields = generationLogFields(first, 1234);
  assert.equal(fields.selector, "deterministic");
  assert.equal(fields.durationMs, 1234);
  assert.equal(fields.selected, first.selection.types.length);
  // Facts only (`logger.ts`): every value a scalar, and nothing of what the person typed.
  for (const value of Object.values(fields)) assert.ok(value === null || typeof value !== "object");
  assert.ok(!JSON.stringify(fields).includes("secret"));
});

/* ------------------------------------------------------------------ *
 * Phase 34 — a valid graph whose references reach nothing
 * ------------------------------------------------------------------ */

/** The eval set's catch: a Loop body reading `{{input.name}}` where its input is `{ index, item, total }`. */
const loopAnswer = (field: string) =>
  JSON.stringify({
    name: "Users to sheet",
    nodes: [
      { id: "trigger", type: "core.manual_trigger", config: {} },
      { id: "each", type: "core.loop", config: { items: "{{trigger.users}}" } },
      { id: "row", type: "integration.sheets", config: { spreadsheetId: "", values: [`{{${field}}}`] } },
    ],
    edges: [
      { source: "trigger", target: "each" },
      { source: "each", target: "row", sourceHandle: "loop" },
      { source: "row", target: "each" },
    ],
  });

test("a valid graph whose reference reaches nothing earns the retry, with the exact problem", async () => {
  const model = scriptedModel([loopAnswer("input.name"), loopAnswer("input.item.name")]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "users to a sheet" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(model.requests.length, 2);
  assert.equal(result.attempt, 2);
  assert.deepEqual(result.attempts[0]!.issues.map((issue) => issue.code), ["unresolved_reference"]);
  assert.deepEqual(result.attempts[1]!.issues, []);
  const retry = (model.requests[1]!.turns[2] as { text: string }).text;
  assert.match(retry, /references reach nothing/);
  assert.match(retry, /\{\{input\.name\}\}: the input here has no "name" — it has index, item, total/);
  assert.equal(generationLogFields(result, 1).outcome, "second");
  assert.equal(generationLogFields(result, 1).referenceRetry, true);
});

test("a retry that breaks the graph never costs the valid first answer", async () => {
  const model = scriptedModel([loopAnswer("input.name"), "not json"]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "users to a sheet" });

  assert.equal(result.ok, true, "a valid graph is never failed over a reference");
  if (!result.ok) return;
  assert.equal(result.attempt, 1);
  assert.equal(result.graph.nodes.find((node) => node.id === "row")?.config.values?.toString(), "{{input.name}}");
  assert.equal(generationLogFields(result, 1).outcome, "first");
});

test("references still unresolved on the second attempt are listed, and the graph accepted", async () => {
  const model = scriptedModel([loopAnswer("input.name"), loopAnswer("input.email")]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "users to a sheet" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(model.requests.length, 2, "two attempts, never more");
  assert.equal(result.attempt, 2);
  assert.equal(result.attempts[1]!.issues[0]?.code, "unresolved_reference");
});

test("an answer whose references all resolve is accepted on one call", async () => {
  const model = scriptedModel([loopAnswer("input.item.name")]);
  const result = await generateWorkflow({ model, modelId: "fake-1", prompt: "users to a sheet" });
  assert.equal(result.ok && result.attempt, 1);
  assert.equal(model.requests.length, 1);
});
