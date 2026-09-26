import assert from "node:assert/strict";
import { test } from "node:test";

import { describeNodes } from "@/lib/nodes";

import { describeConfigSchema, renderCatalogue, systemPrompt } from "./prompt";

/**
 * The prompt's job is to put the registry in front of the model. These tests exist so
 * a node added in Phase 8 or 9 cannot be silently missing from generation — the
 * failure mode would otherwise be a model that never emits the new node, which looks
 * like a bad prompt rather than a missing catalogue entry.
 */

test("every registered node appears in the catalogue, with its description verbatim", () => {
  const catalogue = renderCatalogue();

  for (const node of describeNodes()) {
    assert.ok(catalogue.includes(`"${node.type}"`), `${node.type} is missing from the catalogue`);
    assert.ok(
      catalogue.includes(node.description),
      `${node.type}'s description must reach the model verbatim`,
    );
  }
});

test("a node's declared outputs are named exactly as an edge must write them", () => {
  const catalogue = renderCatalogue();

  // A branch's handles are contract; a model that guesses "yes"/"no" produces an
  // unknown_output_handle, so the real keys must be in the prompt.
  assert.ok(catalogue.includes('"true"'));
  assert.ok(catalogue.includes('"false"'));
  assert.ok(catalogue.includes('"loop"'));
  assert.ok(catalogue.includes('"done"'));
  assert.ok(catalogue.includes("(default, omit sourceHandle)"));
});

test("config fields are rendered with their type, requiredness and default", () => {
  const lines = describeConfigSchema({
    type: "object",
    properties: {
      message: { type: "string", default: "" },
      level: { type: "string", enum: ["info", "warn", "error"], default: "info" },
      left: {},
      items: { type: "array", items: { type: "string" } },
    },
    required: ["left"],
  });

  assert.deepEqual(lines, [
    '      - message: string, default ""',
    '      - level: one of "info" | "warn" | "error", default "info"',
    "      - left: any, REQUIRED",
    "      - items: array of string, optional",
  ]);
});

test("a node with no config says so rather than rendering an empty block", () => {
  assert.deepEqual(describeConfigSchema({ type: "object", properties: {} }), []);
  assert.ok(renderCatalogue().includes("config: none"));
});

test("the prompt states the trigger rule with the trigger types that actually exist", () => {
  const prompt = systemPrompt();
  const triggers = describeNodes().filter((node) => node.kind === "trigger");

  assert.ok(triggers.length > 0, "there must be at least one trigger to generate with");
  for (const trigger of triggers) {
    assert.ok(prompt.includes(`"${trigger.type}"`));
  }
  assert.ok(prompt.includes("Exactly one trigger node"));
});

test("the prompt forbids the expression syntax the template layer does not support", () => {
  // D17: {{ }} is lookup, not an expression language. A model that emits
  // "{{input.a + input.b}}" produces a field that silently resolves to empty.
  assert.match(systemPrompt(), /not an expression/);
});

test("a node's output shape reaches the model, so a reference can be written correctly", () => {
  const catalogue = renderCatalogue();

  // The bug this prevents: a model writing {{steps.x.output}} where it means
  // {{steps.x.output.text}}. The branch then compares "[object Object]" and the
  // workflow runs, valid, down the wrong path.
  for (const node of describeNodes()) {
    if (!node.outputShape) continue;
    assert.ok(
      catalogue.includes(node.outputShape),
      `${node.type}'s output shape must reach the model`,
    );
  }

  assert.ok(catalogue.includes("output value:"));
});

test("the nodes whose output feeds a branch all document their shape", () => {
  const byType = new Map(describeNodes().map((node) => [node.type, node]));

  // These are the ones a generated graph routes on. A new node added without an
  // outputShape is fine; these four regressing to none is not.
  for (const type of ["ai.llm", "ai.agent", "core.set", "core.loop"]) {
    assert.ok(byType.get(type)?.outputShape, `${type} must say what it outputs`);
  }
});

test("the prompt steers a named choice to the agent's constrained decision", () => {
  assert.match(systemPrompt(), /output\.decision/);
});

/**
 * Phase 12. The primary half of the `maxIterations` fix — the guarantee is asserted in
 * `generate.test.ts`. Both exist because the prompt rule is what keeps the *model* from
 * writing a self-defeating budget, and the guard is what makes it not matter when it does.
 */
test("the prompt tells the model not to starve an agent of model calls", () => {
  const prompt = systemPrompt();
  assert.match(prompt, /Do not set "maxIterations"/);
  // The reason, not just the instruction: a rule a model is given a reason for survives
  // a request that seems to argue for the opposite.
  assert.match(prompt, /one model call deciding to use a tool and another reading/);
});
