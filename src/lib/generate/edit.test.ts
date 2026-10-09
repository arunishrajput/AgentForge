import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerateRequest, GenerateResult, LanguageModel } from "@/lib/ai/types";
import { validateGraph } from "@/lib/engine/validate";
import { describeNodes } from "@/lib/nodes";
import { diffGraphs, overlaps } from "@/lib/workflow/diff";
import { GRAPH_VERSION, workflowGraphSchema, type WorkflowGraph } from "@/lib/workflow/graph";

import { assembleEdit, editWorkflow, placeAdded } from "./edit";
import { editPrompt, modelView, systemPrompt } from "./prompt";
import type { GeneratedWorkflow } from "./schema";

/**
 * The copilot's edit — Phase 35. Against a scripted model, like `generate.test.ts`: what these
 * prove is the part that must never regress — that a proposal keeps everything the model does
 * not own, that it is validated exactly as a generated graph is, that it is not blamed for what
 * the canvas already had wrong, and that run data never reaches the prompt.
 */

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

/** A pinned output nobody would type — so finding it in a prompt can only mean it leaked. */
const PIN_CANARY = "CANARY-pinned-webhook-body-7f3a";

/**
 * The demo's shape, on a canvas: dragged about, one node tuned, one pinned, one off, a note. Parsed
 * by the graph schema, as the copilot route parses what the canvas sends, so its defaults are filled.
 */
const CANVAS: WorkflowGraph = workflowGraphSchema.parse({
  version: GRAPH_VERSION,
  nodes: [
    {
      id: "trigger",
      type: "core.webhook_trigger",
      position: { x: 0, y: 40 },
      config: {},
      pinned: { output: { message: PIN_CANARY } },
    },
    {
      id: "summarise",
      type: "ai.llm",
      label: "Summarise it",
      position: { x: 320, y: 30 },
      config: { prompt: "Summarise: {{trigger.message}}" },
      policy: { retries: 2 },
    },
    {
      id: "triage",
      type: "ai.agent",
      position: { x: 650, y: 10 },
      config: { objective: "Is {{input.text}} urgent?", choices: ["urgent", "normal"], maxIterations: 1 },
    },
    {
      id: "route",
      type: "core.branch",
      position: { x: 960, y: 0 },
      config: { left: "{{input.decision}}", operator: "equals", right: "urgent" },
    },
    {
      id: "escalate",
      type: "integration.discord",
      position: { x: 1280, y: -90 },
      config: { content: "Urgent: {{steps.summarise.output.text}}" },
    },
    {
      id: "queue",
      type: "core.log",
      position: { x: 1280, y: 110 },
      config: { message: "Normal: {{steps.summarise.output.text}}" },
      disabled: true,
    },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "summarise", sourceHandle: null },
    { id: "e2", source: "summarise", target: "triage", sourceHandle: null },
    { id: "e3", source: "triage", target: "route", sourceHandle: null },
    { id: "e4", source: "route", target: "escalate", sourceHandle: "true" },
    { id: "e5", source: "route", target: "queue", sourceHandle: "false" },
  ],
  notes: [
    { id: "note_1", position: { x: 0, y: -200 }, size: { width: 240, height: 140 }, text: "Ask Sam first", tone: "yellow" },
  ],
});

const SUBJECT = { name: "Triage", description: "Routes urgent messages.", graph: CANVAS };

/** What a model echoing the canvas sends back: the model's view, edited by `change`. */
function answer(change: (view: ReturnType<typeof modelView>) => void, unsupported: string[] = []): string {
  const view = structuredClone(modelView(SUBJECT));
  change(view);
  return JSON.stringify({ ...view, unsupported });
}

const addSlack = answer((view) => {
  view.nodes.push({ id: "post_slack", type: "integration.slack", label: "Post to Slack", config: { text: "Urgent: {{steps.summarise.output.text}}" } });
  view.edges.push({ source: "route", target: "post_slack", sourceHandle: "true" });
});

const asGenerated = (text: string) => JSON.parse(text) as GeneratedWorkflow;

/* ------------------------------------------------------------------ *
 * assembleEdit — what the model does not own is carried by id
 * ------------------------------------------------------------------ */

test("an unchanged node keeps its position, policy, pin and off switch; the notes are untouched", () => {
  const graph = assembleEdit(CANVAS, asGenerated(addSlack));
  for (const before of CANVAS.nodes) {
    const after = graph.nodes.find((node) => node.id === before.id);
    assert.deepEqual(after, before, before.id);
  }
  assert.deepEqual(graph.notes, CANVAS.notes);
  assert.equal(graph.version, CANVAS.version);
});

test("the diff of an added step is exactly that step and its connection — not remove-plus-add", () => {
  const diff = diffGraphs(CANVAS, assembleEdit(CANVAS, asGenerated(addSlack)));
  assert.deepEqual(
    { added: diff.summary.added, removed: diff.summary.removed, changed: diff.summary.changed, moved: diff.summary.moved },
    { added: 1, removed: 0, changed: 0, moved: 0 },
  );
  assert.equal(diff.summary.edgesAdded, 1);
  assert.equal(diff.summary.edgesRemoved, 0);
  assert.equal(diff.summary.notes, 0);
});

test("a surviving connection keeps its edge id and a new one takes the lowest free id", () => {
  const graph = assembleEdit(
    CANVAS,
    asGenerated(
      answer((view) => {
        // Drop e2's connection and add two: the first new one may reuse e2, as `nextEdgeId` does on the canvas.
        view.edges = view.edges.filter((edge) => !(edge.source === "summarise" && edge.target === "triage"));
        view.edges.push({ source: "summarise", target: "route", sourceHandle: null });
        view.edges.push({ source: "trigger", target: "triage", sourceHandle: null });
      }),
    ),
  );
  const ids = Object.fromEntries(graph.edges.map((edge) => [`${edge.source}>${edge.target}`, edge.id]));
  assert.equal(ids["trigger>summarise"], "e1");
  assert.equal(ids["route>escalate"], "e4");
  assert.equal(ids["summarise>route"], "e2");
  assert.equal(ids["trigger>triage"], "e6");
});

test("a node whose type changed keeps its place but not the old node's pin, policy or off switch", () => {
  const graph = assembleEdit(
    CANVAS,
    asGenerated(
      answer((view) => {
        const trigger = view.nodes.find((node) => node.id === "trigger")!;
        trigger.type = "core.manual_trigger";
        const summarise = view.nodes.find((node) => node.id === "summarise")!;
        summarise.type = "ai.agent";
        summarise.config = { objective: "Summarise {{trigger.message}}" };
        const queue = view.nodes.find((node) => node.id === "queue")!;
        queue.type = "integration.slack";
        queue.config = { text: "Normal" };
      }),
    ),
  );
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  assert.deepEqual(byId.get("trigger")?.position, { x: 0, y: 40 });
  assert.equal(byId.get("trigger")?.pinned, undefined);
  assert.equal(byId.get("summarise")?.policy, undefined);
  assert.equal(byId.get("queue")?.disabled, undefined);
});

test("a label the model forgot to copy is kept; an empty one clears it; a new one is the model's", () => {
  const forgot = assembleEdit(CANVAS, asGenerated(answer((view) => delete view.nodes[1].label)));
  assert.equal(forgot.nodes[1].label, "Summarise it");

  const cleared = assembleEdit(CANVAS, asGenerated(answer((view) => (view.nodes[1].label = ""))));
  assert.equal(cleared.nodes[1].label, "");

  const renamed = assembleEdit(CANVAS, asGenerated(answer((view) => (view.nodes[1].label = "Shorten it"))));
  assert.equal(renamed.nodes[1].label, "Shorten it");
  assert.deepEqual(diffGraphs(CANVAS, renamed).nodes.find((entry) => entry.id === "summarise")?.fields, ["label"]);
});

test("an agent budget the person set is theirs; one the model chose too small is dropped", () => {
  // `triage` was saved with maxIterations 1 — deliberately, by somebody typing it.
  const copied = assembleEdit(CANVAS, asGenerated(addSlack));
  assert.equal(copied.nodes.find((node) => node.id === "triage")?.config.maxIterations, 1);

  const added = assembleEdit(
    CANVAS,
    asGenerated(
      answer((view) => {
        view.nodes.push({ id: "second_opinion", type: "ai.agent", config: { objective: "Check it", maxIterations: 1 } });
        view.edges.push({ source: "queue", target: "second_opinion", sourceHandle: null });
      }),
    ),
  );
  assert.equal(added.nodes.find((node) => node.id === "second_opinion")?.config.maxIterations, undefined);
});

/* ------------------------------------------------------------------ *
 * placeAdded — only new nodes are placed, beside what they connect to
 * ------------------------------------------------------------------ */

test("a new step lands to the right of the step that feeds it, where that step actually is, clear of every card", () => {
  const placed = placeAdded(CANVAS, asGenerated(addSlack));
  assert.deepEqual([...placed.keys()], ["post_slack"]);
  const position = placed.get("post_slack")!;
  assert.ok(position.x > 960, `x ${position.x} is right of the branch`);
  for (const node of CANVAS.nodes) assert.ok(!overlaps(node.position, position), `overlaps ${node.id}`);
});

test("a chain of new steps hangs off the step that already existed, in order", () => {
  const placed = placeAdded(
    CANVAS,
    asGenerated(
      answer((view) => {
        view.nodes.push({ id: "a", type: "core.log", config: {} }, { id: "b", type: "core.log", config: {} });
        view.edges.push({ source: "queue", target: "a", sourceHandle: null }, { source: "a", target: "b", sourceHandle: null });
      }),
    ),
  );
  assert.ok(placed.get("a")!.x > 1280);
  assert.ok(placed.get("b")!.x > placed.get("a")!.x);
});

test("a new trigger that feeds an existing step is placed before it", () => {
  const placed = placeAdded(
    CANVAS,
    asGenerated(
      answer((view) => {
        view.nodes = view.nodes.filter((node) => node.id !== "trigger");
        view.nodes.unshift({ id: "every_morning", type: "core.schedule_trigger", config: { cron: "0 9 * * *" } });
        view.edges[0] = { source: "every_morning", target: "summarise", sourceHandle: null };
      }),
    ),
  );
  assert.ok(placed.get("every_morning")!.x < 320);
});

test("new steps connected to nothing that exists start a column right of everything", () => {
  const placed = placeAdded(
    CANVAS,
    asGenerated(
      answer((view) => {
        view.nodes.push({ id: "x", type: "core.log", config: {} }, { id: "y", type: "core.log", config: {} });
        view.edges.push({ source: "x", target: "y", sourceHandle: null });
      }),
    ),
  );
  assert.ok(placed.get("x")!.x > 1280);
  assert.ok(placed.get("y")!.x > placed.get("x")!.x);
  assert.ok(!overlaps(placed.get("x")!, placed.get("y")!));
});

/* ------------------------------------------------------------------ *
 * editWorkflow — the pipeline, shared with generation
 * ------------------------------------------------------------------ */

const edit = (answers: string[], extra: Partial<Parameters<typeof editWorkflow>[0]> = {}) => {
  const model = scriptedModel(answers);
  return {
    model,
    result: editWorkflow({
      model,
      modelId: "fake-1",
      instruction: "Also post the urgent ones to Slack",
      subject: SUBJECT,
      ...extra,
    }),
  };
};

test("an edit is one call, valid, and the proposal is the canvas plus the change", async () => {
  const { model, result } = edit([addSlack]);
  const proposal = await result;
  assert.ok(proposal.ok);
  assert.equal(model.requests.length, 1);
  assert.equal(proposal.attempt, 1);
  assert.equal(validateGraph(proposal.graph).problems.length, 0);
  assert.ok(proposal.graph.nodes.some((node) => node.type === "integration.slack"));
  // The subject's own name, never the model's.
  assert.equal(proposal.name, "Triage");
});

test("the copilot's prompt is the generation prompt with an edit opening and the editing rules", async () => {
  const { model, result } = edit([addSlack]);
  await result;
  const [request] = model.requests;
  const system = request.system ?? "";
  assert.match(system, /^You edit workflows for AgentForge/);
  assert.match(system, /Never change an existing node's id/);
  assert.equal(request.json, true);
  assert.equal(request.tools, undefined);

  // Everything else is generation's prompt, word for word.
  const generate = systemPrompt(describeNodes(), undefined, "generate");
  const shared = generate.slice(generate.indexOf("Answer with JSON only."), generate.indexOf("Designing with"));
  assert.ok(shared.length > 1000);
  const editing = systemPrompt(describeNodes(), undefined, "edit");
  assert.ok(editing.includes(shared), "the edit prompt forked from the generation prompt");
});

test("every node type already on the canvas is defined in full, beside what the instruction selects", async () => {
  const { result } = edit([addSlack]);
  const proposal = await result;
  for (const node of CANVAS.nodes) assert.ok(proposal.selection.types.includes(node.type), node.type);
  assert.ok(proposal.selection.types.includes("integration.slack"));
});

test("pinned run data, positions and the notes never reach the model", async () => {
  const { model, result } = edit([addSlack]);
  await result;
  const sent = JSON.stringify(model.requests);
  assert.ok(!sent.includes(PIN_CANARY), "a pinned output reached the prompt");
  assert.ok(!sent.includes("Ask Sam first"), "a note reached the prompt");
  assert.ok(!sent.includes("1280"), "a position reached the prompt");
  assert.ok(!sent.includes('"retries"'), "a retry policy reached the prompt");
});

test("refine: the earlier instructions are in the prompt, as changes the workflow already has", () => {
  const text = editPrompt(SUBJECT, "no, only on weekdays", ["Also post the urgent ones to Slack"]);
  assert.match(text, /already includes them:\n\n- Also post the urgent ones to Slack/);
  assert.ok(text.trimEnd().endsWith("no, only on weekdays"));
  assert.doesNotMatch(editPrompt(SUBJECT, "x"), /Earlier in this conversation/);
});

test("a problem the canvas already had is carried, not retried over", async () => {
  // A Discord step dropped from the palette and not yet written: invalid config, on purpose.
  const unfinished: WorkflowGraph = {
    ...CANVAS,
    nodes: CANVAS.nodes.map((node) => (node.id === "escalate" ? { ...node, config: {} } : node)),
  };
  assert.equal(validateGraph(unfinished).valid, false);
  const subject = { ...SUBJECT, graph: unfinished };
  const echo = (() => {
    const view = structuredClone(modelView(subject));
    view.nodes.push({ id: "post_slack", type: "integration.slack", config: { text: "Urgent" } });
    view.edges.push({ source: "route", target: "post_slack", sourceHandle: "true" });
    return JSON.stringify({ ...view, unsupported: [] });
  })();
  const model = scriptedModel([echo]);
  const proposal = await editWorkflow({ model, modelId: "fake-1", instruction: "Also post to Slack", subject });
  assert.ok(proposal.ok);
  assert.equal(model.requests.length, 1, "the retry was spent on a problem the person left there");
  assert.equal(proposal.attempts[0].issues.length, 0);
});

test("a problem the proposal adds earns the one retry, like a generated graph's", async () => {
  const broken = answer((view) => {
    view.nodes.push({ id: "post_slack", type: "integration.slack", config: {} });
    view.edges.push({ source: "route", target: "post_slack", sourceHandle: "true" });
  });
  const { model, result } = edit([broken, addSlack]);
  const proposal = await result;
  assert.ok(proposal.ok);
  assert.equal(model.requests.length, 2);
  assert.equal(proposal.attempt, 2);
  assert.equal(proposal.attempts[0].issues[0].code, "invalid_config");
});

test("two invalid proposals fail with the issues, and propose nothing", async () => {
  const broken = answer((view) => view.edges.push({ source: "route", target: "nowhere", sourceHandle: "true" }));
  const { result } = edit([broken, broken]);
  const proposal = await result;
  assert.equal(proposal.ok, false);
  if (!proposal.ok) assert.ok(proposal.issues.some((issue) => issue.code === "dangling_edge"));
});

test("a reference the canvas already had unresolved is carried; one the proposal adds is retried", async () => {
  const stale: WorkflowGraph = {
    ...CANVAS,
    nodes: CANVAS.nodes.map((node) =>
      node.id === "escalate" ? { ...node, config: { content: "{{steps.summarise.output.summary}}" } } : node,
    ),
  };
  const subject = { ...SUBJECT, graph: stale };
  const respond = (content: string) => {
    const view = structuredClone(modelView(subject));
    view.nodes.push({ id: "post_slack", type: "integration.slack", config: { text: content } });
    view.edges.push({ source: "route", target: "post_slack", sourceHandle: "true" });
    return JSON.stringify({ ...view, unsupported: [] });
  };

  const carried = scriptedModel([respond("{{steps.summarise.output.text}}")]);
  const kept = await editWorkflow({ model: carried, modelId: "fake-1", instruction: "Also Slack", subject });
  assert.ok(kept.ok);
  assert.equal(carried.requests.length, 1);

  const added = scriptedModel([respond("{{steps.summarise.output.nope}}"), respond("{{steps.summarise.output.text}}")]);
  const retried = await editWorkflow({ model: added, modelId: "fake-1", instruction: "Also Slack", subject });
  assert.ok(retried.ok);
  assert.equal(added.requests.length, 2);
  const retry = added.requests[1].turns.at(-1);
  const said = retry && "text" in retry ? retry.text : "";
  assert.match(said, /steps\.summarise\.output\.nope/);
  assert.doesNotMatch(said, /output\.summary/);
});

test("what the copilot could not do is reported, with the graph it could build", async () => {
  const honest = answer(() => {}, ["rename the workflow — type the new name in the toolbar"]);
  const { result } = edit([honest], { instruction: "Rename this workflow to Urgent triage" });
  const proposal = await result;
  assert.ok(proposal.ok);
  assert.deepEqual(proposal.unsupported, ["rename the workflow — type the new name in the toolbar"]);
  assert.equal(diffGraphs(CANVAS, proposal.graph).summary.any, false);
});

test("a provider failure propagates rather than becoming a proposal", async () => {
  const failing: LanguageModel = {
    provider: "fake",
    defaultModel: "fake-1",
    async generate() {
      throw new Error("quota");
    },
    async listModels() {
      return [];
    },
  };
  await assert.rejects(
    editWorkflow({ model: failing, modelId: "fake-1", instruction: "x", subject: SUBJECT }),
    /quota/,
  );
});
