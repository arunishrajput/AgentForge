import assert from "node:assert/strict";
import { test } from "node:test";

import { renderCatalogue, systemPrompt } from "@/lib/generate/prompt";

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
 *   4. a catalogue entry the generator can  → `generate/prompt.test.ts` (Phase 7)
 *      render
 *   5. documentation a person can read      → here (Phase 23A)
 *
 * This file covers 5, re-states 3 as a test rather than a comment, and holds the
 * properties that are true of *every* entry regardless of what it does.
 */

const nodes = listNodes();

test("the registry is 25 nodes and every type is unique", () => {
  assert.equal(nodes.length, 25);
  assert.equal(new Set(nodes.map((node) => node.type)).size, 25);
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

test("every node Phase 23A added documents itself for a person", () => {
  // `description` is for the model and is tuned for it. `docs.summary` is the sentence
  // the inspector shows a user who has just dragged the node onto a canvas.
  const documented = nodes.filter((node) => node.docs !== undefined);
  assert.ok(documented.length >= 10, "Phase 23A's ten nodes all carry docs");

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

test("the generation prompt still fits a sensible budget with 25 nodes", () => {
  // The catalogue is rendered from the registry, so every node added grows the prompt
  // on every generation call. This is not a style rule: the free-tier model has an
  // input limit and generation latency tracks prompt size. If this fails, the answer is
  // a shorter catalogue rendering, not a bigger budget.
  const prompt = systemPrompt();
  assert.ok(
    prompt.length < 24_000,
    `the system prompt is ${prompt.length} characters, which is more than Phase 23A budgeted`,
  );
  // And every node really is in there.
  const catalogue = renderCatalogue();
  for (const node of nodes) assert.ok(catalogue.includes(`"${node.type}"`), node.type);
});
