import assert from "node:assert/strict";
import { test } from "node:test";

import { describeNodes } from "@/lib/nodes";
import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

import { checkReferences, declaredFields } from "./references";

/**
 * Phase 34's reference check. Every test here is one way a generated graph can be valid and still
 * resolve a reference to nothing — and, as importantly, one way it must **not** raise a false alarm,
 * because a check that cries wolf teaches whoever reads the eval report to ignore it.
 */

type Node = { id: string; type: string; config?: Record<string, unknown> };
type Edge = [source: string, target: string, handle?: string];

function graph(nodes: Node[], edges: Edge[]): WorkflowGraph {
  return {
    version: GRAPH_VERSION,
    nodes: nodes.map((node) => ({ id: node.id, type: node.type, position: { x: 0, y: 0 }, config: node.config ?? {} })),
    edges: edges.map(([source, target, handle], index) => ({
      id: `e${index}`,
      source,
      target,
      sourceHandle: handle ?? null,
    })),
  };
}

const problemsOf = (g: WorkflowGraph) => checkReferences(g).map((p) => `${p.nodeId}: ${p.reference}`);

test("declaredFields reads the top-level keys of every brace group in an output shape", () => {
  assert.deepEqual(
    [...(declaredFields("{ text: the answer, json: parsed or null, model, usage, input }. Use output.text.") ?? [])],
    ["text", "json", "model", "usage", "input"],
  );
  // Two shapes, one per mode: the union, so a reference to either is accepted.
  assert.deepEqual(
    [...(declaredFields("{ text: the result, length } for every operation except split, which gives { items: the pieces, count }") ?? [])],
    ["text", "length", "items", "count"],
  );
  // A nested brace is a value, not a key of the shape.
  assert.deepEqual([...(declaredFields("{ a: { b, c }, d }") ?? [])], ["a", "d"]);
  assert.equal(declaredFields("its input, unchanged."), null);
  assert.equal(declaredFields(undefined), null);
});

test("every registered node's output shape is either prose or parses into fields", () => {
  // A shape with braces that yields no field would silently disable the check for that node.
  for (const node of describeNodes()) {
    // A `{{ }}` in a shape is an example reference, not a shape.
    if (!node.outputShape?.replace(/\{\{[^}]*\}\}/g, "").includes("{")) continue;
    assert.ok(declaredFields(node.outputShape)?.size, `${node.type}'s output shape yields no field`);
  }
});

test("a field the source node does not produce is reported — the Known Issue's shape", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.webhook_trigger" },
      { id: "summarise", type: "ai.llm", config: { prompt: "Summarise {{trigger.message}}" } },
      { id: "log", type: "core.log", config: { message: "{{steps.summarise.output.summary}}" } },
    ],
    [["trigger", "summarise"], ["summarise", "log"]],
  );
  const problems = checkReferences(g);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.reference, "steps.summarise.output.summary");
  assert.match(problems[0]!.message, /has no "summary" — it has text, json/);
});

test("after a Branch, input is the branch's own output — {{input.reason}} reaches nothing", () => {
  // The branch outputs { matched, input }. A generated graph routing on an agent's decision and
  // then writing {{input.reason}} sends an empty message, and nothing in validation sees it.
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "triage", type: "ai.agent", config: { objective: "x", choices: ["urgent", "normal"] } },
      { id: "route", type: "core.branch", config: { left: "{{input.decision}}", right: "urgent" } },
      { id: "wrong", type: "core.log", config: { message: "Urgent: {{input.reason}}" } },
      { id: "right", type: "core.log", config: { message: "Urgent: {{steps.triage.output.reason}} {{input.input.reason}}" } },
    ],
    [["trigger", "triage"], ["triage", "route"], ["route", "wrong", "true"], ["route", "right", "false"]],
  );
  assert.deepEqual(problemsOf(g), ["wrong: input.reason"]);
});

test("a step that cannot have run yet, a step that does not exist, and a root that is not one", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "route", type: "core.branch", config: { left: "{{input.x}}", right: 1 } },
      { id: "yes", type: "integration.discord", config: { message: "hi" } },
      // The other side of the branch: "yes" never ran on this path.
      { id: "no", type: "core.log", config: { message: "{{steps.yes.output.messageId}} {{steps.ghost.output.x}} {{summary}}" } },
    ],
    [["trigger", "route"], ["route", "yes", "true"], ["route", "no", "false"]],
  );
  const problems = checkReferences(g);
  assert.deepEqual(problems.map((p) => p.reference), ["steps.yes.output.messageId", "steps.ghost.output.x", "summary"]);
  assert.match(problems[0]!.message, /cannot have run before "no"/);
  assert.match(problems[1]!.message, /no node "ghost"/);
  assert.match(problems[2]!.message, /not something a reference can read/);
});

test("a webhook's body and a manual run's input are unknowable, so anything on them is accepted", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.webhook_trigger" },
      { id: "log", type: "core.log", config: { message: "{{trigger.anything}} {{input.whatever}}" } },
    ],
    [["trigger", "log"]],
  );
  assert.deepEqual(problemsOf(g), []);
});

test("a schedule trigger's output is known, and a field it lacks is reported", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.schedule_trigger", config: { cron: "0 9 * * *" } },
      { id: "log", type: "core.log", config: { message: "{{trigger.firedAt}} {{input.scheduledFor}} {{trigger.date}}" } },
    ],
    [["trigger", "log"]],
  );
  assert.deepEqual(problemsOf(g), ["log: trigger.date"]);
});

test("a pass-through node hands on what reached it, and Set names its own fields", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "fetch", type: "integration.http", config: { url: "https://example.com" } },
      { id: "note", type: "core.log", config: { message: "status {{input.status}}" } },
      { id: "shape", type: "core.set", config: { fields: { subject: "{{input.json.title}}" } } },
      { id: "after", type: "core.log", config: { message: "{{input.subject}} {{input.status}}" } },
    ],
    [["trigger", "fetch"], ["fetch", "note"], ["note", "shape"], ["shape", "after"]],
  );
  // Set without `merge` replaces its input, so `status` is gone after it.
  assert.deepEqual(problemsOf(g), ["after: input.status"]);
});

test("Set with merge keeps what came in underneath its own fields", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "fetch", type: "integration.http", config: { url: "https://example.com" } },
      { id: "shape", type: "core.set", config: { merge: true, fields: { subject: "x" } } },
      { id: "after", type: "core.log", config: { message: "{{input.subject}} {{input.status}}" } },
    ],
    [["trigger", "fetch"], ["fetch", "shape"], ["shape", "after"]],
  );
  assert.deepEqual(problemsOf(g), []);
});

test("a loop's two outputs carry different shapes, and the edge's handle decides which", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "each", type: "core.loop", config: { items: "{{trigger.items}}" } },
      { id: "body", type: "core.log", config: { message: "{{input.item}} {{input.iterations}}" } },
      { id: "end", type: "core.log", config: { message: "{{input.iterations}} {{input.item}}" } },
    ],
    [["trigger", "each"], ["each", "body", "loop"], ["body", "each"], ["each", "end", "done"]],
  );
  assert.deepEqual(problemsOf(g), ["body: input.iterations", "end: input.item"]);
});

test("run and node expose only what the engine puts in scope", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "log", type: "core.log", config: { message: "{{run.id}} {{node.iteration}} {{run.startedAt}}" } },
    ],
    [["trigger", "log"]],
  );
  assert.deepEqual(problemsOf(g), ["log: run.startedAt"]);
});

test("a whole-output reference and a deeper path are not second-guessed", () => {
  // `{{steps.x.output}}` is sometimes right (an HTTP body), and only the first field of a path is
  // declared anywhere, so neither is a problem this check can honestly report.
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "fetch", type: "integration.http", config: { url: "https://example.com" } },
      { id: "log", type: "core.log", config: { message: "{{steps.fetch.output}} {{steps.fetch.output.json.items[0].name}}" } },
    ],
    [["trigger", "fetch"], ["fetch", "log"]],
  );
  assert.deepEqual(problemsOf(g), []);
});
