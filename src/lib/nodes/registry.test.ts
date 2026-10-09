import assert from "node:assert/strict";
import { test } from "node:test";

import { agentToolSet } from "@/lib/ai/tools";
import { GUIDANCE, indexLine, renderCatalogue, renderIndex, systemPrompt } from "@/lib/generate/prompt";
import { ERROR_HANDLE } from "@/lib/engine/policy";
import { ALWAYS, MAX_SELECTED } from "@/lib/generate/select";

import { describeNodes, getNode, listAgentTools, listNodes } from "./index";

/**
 * The registry's obligations, asserted in one place — Phase 23A.
 *
 * `ARCHITECTURE.md` → *The node registry is the spine*: one table, several consumers.
 * By Phase 23A a node type owes five things, and four of them are enforced somewhere a
 * long way from the node file itself, which is exactly why they need tests that name
 * them:
 *
 *   1. an entry in `PUBLISHABLE`            → `workflow/share.test.ts` (Phase 20)
 *   2. an entry in `ROTATION_RULES`, if it  → `credentials/credentials.test.ts` (21)
 *      carries a credential kind
 *   3. an output field named `model` ONLY   → Phase 22's analytics read the JSONB, so
 *      if it really is a model call            a stray `model` field is miscounted
 *   4. a catalogue entry the generator can  → `generate/prompt.test.ts` (Phase 7); since Phase 34
 *      render                                  also an index line, and a label that selects it
 *                                              (`generate/select.test.ts`)
 *   5. documentation a person can read      → here (Phase 23A)
 *
 * This file covers 5, re-states 3 as a test rather than a comment, and holds the
 * properties that are true of *every* entry regardless of what it does.
 */

const nodes = listNodes();

test("the registry is 31 nodes and every type is unique", () => {
  // 31 since Phase 37 added `core.error_trigger`.
  assert.equal(nodes.length, 31);
  assert.equal(new Set(nodes.map((node) => node.type)).size, 31);
});

test("no node declares an output keyed \"error\" — the on-error policy reserves it (D174)", () => {
  // The engine adds an Error output to a node whose policy routes; a node that already had one
  // would have two exits with one name, and an edge could not say which it meant.
  for (const node of nodes) {
    assert.ok(!node.outputs.some((output) => output.key === ERROR_HANDLE), `${node.type} declares "${ERROR_HANDLE}"`);
  }
});

test("every node type is namespaced, and its namespace exists", () => {
  // The type is persisted in every saved graph, so the shape of it is a contract.
  for (const node of nodes) {
    assert.match(node.type, /^[a-z]+\.[a-z_]+$/, node.type);
    assert.ok(
      ["core", "transform", "integration", "ai"].includes(node.type.split(".")[0] ?? ""),
      `${node.type} uses an unknown namespace`,
    );
  }
});

test("every node has a description written for the model, not a tooltip", () => {
  // It is read verbatim by the agent — CONTRACT.md. A three-word label would make the
  // tool uncallable in practice while looking fine in the palette.
  for (const node of nodes) {
    assert.ok(node.description.length >= 40, `${node.type}'s description is too short`);
    assert.ok(node.description.trim().endsWith("."), `${node.type}'s description is a fragment`);
  }
});

test("every node that produces data declares its output shape — D38", () => {
  // A generated graph can be valid and still do the wrong thing. The exceptions are
  // the nodes that hand their input straight back.
  const passthrough = new Set(["core.manual_trigger", "core.delay", "core.log", "core.assert"]);
  for (const node of nodes) {
    if (passthrough.has(node.type)) continue;
    assert.ok(node.outputShape, `${node.type} must say what its output looks like`);
  }
});

test("every node Phase 23A onward added documents itself for a person", () => {
  // `description` is for the model and is tuned for it. `docs.summary` is the sentence
  // the inspector shows a user who has just dragged the node onto a canvas.
  const documented = nodes.filter((node) => node.docs !== undefined);
  // Ten from Phase 23A, four from Phase 23B, one from Phase 23C.
  assert.ok(documented.length >= 15, "every node added from Phase 23A onward carries docs");

  for (const node of documented) {
    assert.ok(node.docs, node.type);
    assert.ok(node.docs.summary.length >= 60, `${node.type}'s summary is too thin`);
    assert.notEqual(
      node.docs.summary,
      node.description,
      `${node.type} must not repeat its model-facing description at the user`,
    );
    for (const example of node.docs.examples ?? []) {
      assert.ok(example.title.length > 0 && example.body.length > 0, node.type);
    }
  }
});

test("an output field called `model` means a model call, and nothing else uses the name", () => {
  // Phase 22's analytics count a model call by reading `model` out of the step's output
  // JSONB rather than from a list of AI node types. That makes a new AI node count
  // itself, and makes any other node that borrows the field name miscount.
  for (const node of nodes) {
    if (node.type.startsWith("ai.")) continue;
    assert.ok(
      !/\bmodel\b/.test(node.outputShape ?? ""),
      `${node.type} puts a "model" field on its output, which Phase 22 would count as a model call`,
    );
  }
});

test("agentCallable is opt-in, and nothing that routes or sends mail is callable", () => {
  const callable = new Set(listAgentTools().map((node) => node.type));
  // D19, restated structurally: a node whose entire purpose is the edge it leaves
  // through cannot be a tool, because a tool call has no edge to take.
  for (const node of nodes) {
    if (node.kind === "branch" || node.kind === "loop" || node.kind === "trigger") {
      assert.equal(callable.has(node.type), false, `${node.type} is a ${node.kind} and must not be a tool`);
    }
  }
  assert.equal(callable.has("integration.gmail"), false);
});

test("every transform node is pure enough to be agent-callable, and is", () => {
  // The justification for widening the agent's reach in Phase 23A: these reach no
  // service, hold no credential and can have no effect outside the run.
  const callable = new Set(listAgentTools().map((node) => node.type));
  for (const node of nodes.filter((entry) => entry.type.startsWith("transform."))) {
    assert.equal(callable.has(node.type), true, `${node.type} should be a tool`);
  }
});

test("describeNode produces plain JSON for every node, including the docs", () => {
  // It crosses to the client from a server component, and React refuses anything that
  // is not a plain object — a failure that shows up as a console error at render time,
  // never as a type error.
  const described = describeNodes();
  assert.deepEqual(JSON.parse(JSON.stringify(described)), described);
  assert.equal(described.length, nodes.length);
  const filter = described.find((node) => node.type === "transform.filter");
  assert.ok(filter?.docs?.summary, "docs survive the projection");
});

test("getNode answers for every registered type and for nothing else", () => {
  for (const node of nodes) assert.equal(getNode(node.type)?.type, node.type);
  assert.equal(getNode("core.nope"), undefined);
  assert.equal(getNode(""), undefined);
  // A prototype key must not resolve to a function off Object.prototype.
  assert.equal(getNode("toString"), undefined);
  assert.equal(getNode("__proto__"), undefined);
});

/**
 * **The generation prompt's budget, per request — Phase 34, which lifted D112.**
 *
 * Until Phase 34 this asserted the whole catalogue against a 26,000-character ceiling: every node
 * was sent on every call, ~820 characters each, and at 25,081 the registry had room for one more
 * node (D112). The prompt now carries an **index** line for every node and **full definitions only
 * for the nodes selected** for the request (`generate/select.ts`), so it is budgeted in the two
 * parts that grow differently:
 *
 *   1. **The selected part** — prose, the always-sent nodes, and at most `MAX_SELECTED` others,
 *      advice included. Bounded by the cap, not by the registry, so it is asserted at its worst
 *      case: the largest definitions the selector could ever pick together.
 *   2. **The index** — one line per node, the only part that grows as nodes are added. So it is
 *      budgeted per node: that is what each new node costs every request.
 *
 * And per node, so a single expensive node is caught where it can be fixed: its definition and its
 * index line. If (1) fails, the answer is a shorter definition or a smaller `MAX_SELECTED` measured
 * against the eval set — not a bigger number here.
 */
test("the generation prompt is within budget per request, so the registry can grow — D156", () => {
  const described = describeNodes();
  const always = new Set([...described.filter((node) => node.kind === "trigger").map((node) => node.type), ...ALWAYS]);
  const cost = (type: string) =>
    renderCatalogue(described.filter((node) => node.type === type)).length +
    GUIDANCE.filter((entry) => entry.type === type).reduce((sum, entry) => sum + entry.text.length, 0);

  const largest = described
    .map((node) => node.type)
    .filter((type) => !always.has(type))
    .sort((a, b) => cost(b) - cost(a))
    .slice(0, MAX_SELECTED);
  const worst = new Set([...always, ...largest, "core.branch"]);
  const worstPrompt = systemPrompt(described, [...worst]);
  const index = renderIndex(described);

  assert.ok(
    worstPrompt.length - index.length < 17_500,
    `the worst-case selection is ${worstPrompt.length - index.length} characters before the index`,
  );
  assert.ok(index.length / described.length < 140, `the index spends ${Math.round(index.length / described.length)} characters a node`);
  // The point of the phase: even the worst case is well under what the whole catalogue costs.
  assert.ok(worstPrompt.length < systemPrompt(described).length * 0.85);

  for (const node of described) {
    assert.ok(indexLine(node).length <= 220, `${node.type}'s index line is ${indexLine(node).length} characters`);
    assert.ok(renderCatalogue([node]).length <= 1_300, `${node.type}'s definition is ${renderCatalogue([node]).length} characters`);
  }

  // And every node really is in the index.
  for (const node of nodes) assert.ok(index.includes(`"${node.type}"`), node.type);
});

/**
 * **The agent's tool list is the registry's other per-request cost** — `BUILD_PLAN.md` Phase 34:
 * "measure its size too, because a registry of 40 nodes will reach it next". An agent with no
 * `tools` is offered every callable node, and each is a JSON Schema the provider bills as input on
 * every turn of the loop. Measured on 2026-10-08: 19 tools, 13,297 characters, Postgres the largest
 * at 1,856. The fix when it binds already exists — a generated agent lists its `tools`, and the
 * runtime narrows to them (`ai/tools.ts`) — so this pins the per-tool cost and the total for now.
 */
test("the agent's tool list stays within budget, per tool and in total", () => {
  const specs = agentToolSet().specs;
  for (const spec of specs) {
    assert.ok(JSON.stringify(spec).length <= 2_000, `${spec.name}'s tool definition is ${JSON.stringify(spec).length} characters`);
  }
  assert.ok(JSON.stringify(specs).length < 16_000, `the full tool list is ${JSON.stringify(specs).length} characters`);
});
