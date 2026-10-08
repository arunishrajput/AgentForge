import assert from "node:assert/strict";
import { test } from "node:test";

import { adaptPayload, triggerFieldsUsed, URGENT_PAYLOAD } from "./demo-payload.mjs";

/**
 * `adaptPayload` fits the smoke walk's fixed payload to whatever graph was generated (D58). A body
 * field the graph reads that the payload lacks resolves to nothing — an empty prompt, a `null`
 * Sheets cell — which is the standing Known Issue's shape. Phase 34 found that only `{{trigger.x}}`
 * was read: the same body field reached as `{{input.x}}` in a node the trigger feeds, or as
 * `{{steps.<trigger>.output.x}}`, was never added.
 */

const graph = (nodes, edges) => ({
  nodes,
  edges: edges.map(([source, target]) => ({ source, target })),
});

test("a {{trigger.x}} field is added to the payload, as since Phase 12", () => {
  const g = graph(
    [
      { id: "hook", type: "core.webhook_trigger", config: {} },
      { id: "log", type: "core.log", config: { message: "{{trigger.submission}}" } },
    ],
    [["hook", "log"]],
  );
  assert.deepEqual(adaptPayload(g).added, ["submission"]);
});

test("the body read as {{input.x}} by a node the trigger feeds is added too", () => {
  const g = graph(
    [
      { id: "hook", type: "core.webhook_trigger", config: {} },
      { id: "summarise", type: "ai.llm", config: { prompt: "Summarise {{input.submission}}" } },
      // Further along, `input` is another node's output — not the body.
      { id: "log", type: "core.log", config: { message: "{{input.text}}" } },
    ],
    [["hook", "summarise"], ["summarise", "log"]],
  );
  assert.deepEqual(triggerFieldsUsed(g), ["submission"]);
  assert.equal(adaptPayload(g).payload.submission, URGENT_PAYLOAD.message);
});

test("the body read as {{steps.<trigger>.output.x}} anywhere is added too", () => {
  const g = graph(
    [
      { id: "hook", type: "core.webhook_trigger", config: {} },
      { id: "summarise", type: "ai.llm", config: { prompt: "x" } },
      { id: "sheet", type: "integration.sheets", config: { values: ["{{steps.hook.output.fullName}}", "{{steps.summarise.output.text}}"] } },
    ],
    [["hook", "summarise"], ["summarise", "sheet"]],
  );
  assert.deepEqual(triggerFieldsUsed(g), ["fullName"]);
});

test("a field the payload already has is never overwritten", () => {
  const g = graph(
    [
      { id: "hook", type: "core.webhook_trigger", config: { requiredFields: ["name"] } },
      { id: "log", type: "core.log", config: { message: "{{input.message}} {{trigger.email}}" } },
    ],
    [["hook", "log"]],
  );
  const { payload, added } = adaptPayload(g);
  assert.deepEqual(added, []);
  assert.deepEqual(payload, URGENT_PAYLOAD);
});
