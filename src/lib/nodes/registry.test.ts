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

test("the registry is 30 nodes and every type is unique", () => {
  assert.equal(nodes.length, 30);
  assert.equal(new Set(nodes.map((node) => node.type)).size, 30);
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

test("the generation prompt stays within budget, per node as well as in total", () => {
  // The catalogue is rendered from the registry, so every node added grows the prompt on
  // every generation call. Not a style rule: generation latency tracks prompt size, and the
  // model's attention is finite long before its input limit is.
  //
  // **Phase 23B re-based this, and the note it replaces was wrong in an interesting way.**
  // Phase 23A budgeted 24,000 characters for 25 nodes and said "if this fails, the answer is
  // a shorter catalogue rendering, not a bigger budget". Phase 23B's four nodes took it to
  // 23,685 — 315 characters of headroom, tight enough that an unrelated docs edit would turn
  // CI red. So the rendering was examined, and there is no fat in it that is free: the one
  // obviously droppable line, `name:`, is what a model copies to label the nodes it
  // generates, so removing it would trade prompt size for worse generated graphs.
  //
  // The honest reading is that 29 nodes genuinely cost what they cost — **~817 characters
  // each, measured** — and that a ceiling sized for 25 was the thing that was out of date.
  //
  // **The per-node assertion is the one that now does the work.** A ceiling only says when
  // the registry has grown too big; an average says when a *single* node is too expensive,
  // which is the failure somebody can actually fix. Both have to hold.
  //
  // The structural answer, when this fails again: stop sending the whole catalogue on every
  // call. Selecting the nodes a request could plausibly need is a design change and belongs
  // in a phase of its own, not in whichever phase happens to trip the ceiling.
  const prompt = systemPrompt();
  const catalogue = renderCatalogue();
  const perNode = catalogue.length / nodes.length;

  assert.ok(
    perNode < 900,
    `the catalogue spends ${Math.round(perNode)} characters per node, which is more than any node needs`,
  );
  assert.ok(
    prompt.length < 26_000,
    `the system prompt is ${prompt.length} characters, which is more than Phase 23B budgeted`,
  );

  // And every node really is in there.
  for (const node of nodes) assert.ok(catalogue.includes(`"${node.type}"`), node.type);
});
