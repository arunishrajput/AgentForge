import assert from "node:assert/strict";
import { test } from "node:test";

import { getNode, WORKFLOW_TOOL_PREFIX as NODE_PREFIX, workflowIdOf as nodeWorkflowIdOf } from "@/lib/nodes";
import { toToolName } from "@/lib/ai/tools";
import { listNodes } from "@/lib/nodes";

import {
  readToolArgs,
  toolRef,
  toolSpec,
  toolWireName,
  TOOL_NAME_PREFIX,
  WORKFLOW_TOOL_PREFIX,
  workflowAgentToolSchema,
  workflowIdOf,
} from "./tool";

const tool = (overrides: Record<string, unknown> = {}) =>
  workflowAgentToolSchema.parse({
    name: "send_receipt",
    description: "Emails a receipt for an order to the customer who placed it.",
    fields: [
      { name: "order_id", type: "string", description: "The order", required: true },
      { name: "copies", type: "number", required: false },
      { name: "urgent", type: "boolean" },
    ],
    ...overrides,
  });

test("a tool needs a snake_case name and a sentence a model can act on", () => {
  assert.equal(workflowAgentToolSchema.safeParse({ name: "Send Receipt", description: "Emails a receipt to the customer.", fields: [] }).success, false);
  assert.equal(workflowAgentToolSchema.safeParse({ name: "1st", description: "Emails a receipt to the customer.", fields: [] }).success, false);
  assert.equal(workflowAgentToolSchema.safeParse({ name: "send_receipt", description: "Sends", fields: [] }).success, false);
  assert.equal(workflowAgentToolSchema.safeParse({ name: "send_receipt", description: "Emails a receipt to the customer.", fields: [] }).success, true);
});

test("two inputs cannot share a name, and there are at most twelve", () => {
  const dup = workflowAgentToolSchema.safeParse({
    name: "x_tool",
    description: "Does a thing with two of the same input.",
    fields: [
      { name: "a", type: "string" },
      { name: "a", type: "number" },
    ],
  });
  assert.equal(dup.success, false);

  const many = Array.from({ length: 13 }, (_, index) => ({ name: `f${index}`, type: "string" }));
  assert.equal(workflowAgentToolSchema.safeParse({ name: "x_tool", description: "Has far too many inputs to use.", fields: many }).success, false);
});

test("an input is required unless it says otherwise", () => {
  const parsed = tool();
  assert.deepEqual(parsed.fields.map((field) => field.required), [true, false, true]);
});

test("the wire name can never be a registry tool's, whatever the workflow is called", () => {
  const wire = toolWireName(tool({ name: "core_log" }));
  assert.equal(wire, `${TOOL_NAME_PREFIX}core_log`);
  const registry = new Set(listNodes().map((node) => toToolName(node.type)));
  assert.equal(registry.has(wire), false);
  // The prefix is outside every registry namespace, so no node type can ever project onto it.
  for (const type of registry) assert.ok(!type.startsWith(TOOL_NAME_PREFIX), type);
  assert.ok(getNode("core.log"));
});

test("the spec is the declared name, the author's description verbatim, and a plain object schema", () => {
  const spec = toolSpec(tool());
  assert.equal(spec.name, "workflow_send_receipt");
  assert.equal(spec.description, "Emails a receipt for an order to the customer who placed it.");
  assert.deepEqual(spec.parameters, {
    type: "object",
    properties: {
      order_id: { type: "string", description: "The order" },
      copies: { type: "number" },
      urgent: { type: "boolean" },
    },
    required: ["order_id", "urgent"],
  });
  // A provider's dialect rejects a lot; nothing but type/description/properties/required is sent.
  assert.deepEqual(Object.keys(spec.parameters as object).sort(), ["properties", "required", "type"]);
});

test("a tool with no inputs is still an object the model can call with nothing", () => {
  const spec = toolSpec(tool({ fields: [] }));
  assert.deepEqual(spec.parameters, { type: "object", properties: {}, required: [] });
  assert.deepEqual(readToolArgs(tool({ fields: [] }), {}), { ok: true, input: {} });
});

test("arguments are checked against the declared inputs, strictly, and the sentence names what is wrong", () => {
  const t = tool();
  assert.deepEqual(readToolArgs(t, { order_id: "A-1", urgent: false }), { ok: true, input: { order_id: "A-1", urgent: false } });
  assert.deepEqual(readToolArgs(t, { order_id: "A-1", copies: 2, urgent: true }), { ok: true, input: { order_id: "A-1", copies: 2, urgent: true } });

  const missing = readToolArgs(t, { urgent: true });
  assert.ok(!missing.ok && /order_id/.test(missing.error), JSON.stringify(missing));
  const wrongType = readToolArgs(t, { order_id: "A", urgent: "yes" });
  assert.ok(!wrongType.ok && /urgent/.test(wrongType.error), JSON.stringify(wrongType));
  const extra = readToolArgs(t, { order_id: "A", urgent: true, sneaky: 1 });
  assert.ok(!extra.ok && /unknown input sneaky/.test(extra.error), JSON.stringify(extra));
  assert.ok(!extra.ok && extra.error.startsWith("Invalid arguments for workflow_send_receipt"));
});

test("a tools entry is a workflow only with the prefix and an id after it", () => {
  assert.equal(workflowIdOf(toolRef("abc-123")), "abc-123");
  assert.equal(workflowIdOf("workflow:"), null);
  assert.equal(workflowIdOf("core.log"), null);
  assert.equal(workflowIdOf("workflows:abc"), null);
});

test("the prefix is defined in two places and they agree — the agent node's and this module's", () => {
  // See the note on `WORKFLOW_TOOL_PREFIX`: the duplication is deliberate, so equality is the guard.
  assert.equal(NODE_PREFIX, WORKFLOW_TOOL_PREFIX);
  for (const entry of ["workflow:abc", "workflow:", "core.log", "workflows:abc", "workflow:with:colon"]) {
    assert.equal(nodeWorkflowIdOf(entry), workflowIdOf(entry), entry);
  }
});
