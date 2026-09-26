import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import { describeNodes } from "@/lib/nodes";

import { toGeminiSchema, toToolParameters } from "./schema";

/**
 * These assertions are written against what the live API actually rejected
 * (2026-09-26), not against a reading of the docs. Every `additionalProperties`
 * case below is a schema Zod produces for a node that is already in the registry.
 */

test("strips the keys Gemini rejects with a 400", () => {
  const schema = toGeminiSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      fields: {
        type: "object",
        properties: { a: { type: "string" } },
        propertyNames: { type: "string" },
        additionalProperties: {},
      },
    },
    additionalProperties: {},
  });

  assert.equal("$schema" in schema, false);
  assert.equal("additionalProperties" in schema, false);
  const fields = (schema.properties as Record<string, Record<string, unknown>>).fields;
  assert.equal("propertyNames" in fields, false);
  assert.equal("additionalProperties" in fields, false);
});

test("keeps the keys Gemini documents", () => {
  const schema = toGeminiSchema({
    type: "string",
    description: "A message",
    enum: ["info", "warn"],
    maxLength: 2000,
  });
  assert.deepEqual(schema, {
    description: "A message",
    enum: ["info", "warn"],
    maxLength: 2000,
    type: "string",
  });
});

test("moves a default into the description rather than dropping the fact", () => {
  const schema = toGeminiSchema({ type: "string", default: "info" });
  assert.equal("default" in schema, false);
  assert.equal(schema.description, 'Defaults to "info".');

  const withBoth = toGeminiSchema({ type: "boolean", description: "Merge input.", default: false });
  assert.equal(withBoth.description, "Merge input. Defaults to false.");
});

test("a typeless schema becomes a string rather than an empty schema", () => {
  // z.unknown() emits `{}`. Gemini cannot express "any", and an empty schema is
  // rejected, so the field stays callable as a string.
  assert.deepEqual(toGeminiSchema({}), {
    type: "string",
    description: "Any JSON value, given as a string.",
  });
});

test("an unknown type is treated as untyped, not passed through", () => {
  const schema = toGeminiSchema({ type: "integer64" });
  assert.equal(schema.type, "string");
});

test("required is filtered to properties that survived", () => {
  const schema = toGeminiSchema({
    type: "object",
    properties: { kept: { type: "string" } },
    required: ["kept", "vanished"],
  });
  assert.deepEqual(schema.required, ["kept"]);
});

test("an object with no properties is not emitted as an empty object schema", () => {
  const nested = toGeminiSchema({ type: "object", properties: {} });
  assert.equal(nested.type, "string");
  assert.match(String(nested.description), /JSON object/);
});

test("arrays recurse into items", () => {
  const schema = toGeminiSchema({ type: "array", items: { type: "object", properties: { a: { type: "number" } } } });
  const items = schema.items as Record<string, unknown>;
  assert.equal(items.type, "object");
});

test("a tool with no configurable fields declares no parameters at all", () => {
  assert.equal(toToolParameters({ type: "object", properties: {} }), undefined);
  assert.equal(toToolParameters(z.toJSONSchema(z.object({}), { io: "input" })), undefined);
});

test("every agent-callable node in the registry sanitises to a valid Gemini schema", () => {
  // The guard that matters: adding a node must not be able to break the agent.
  const allowed = new Set([
    "type",
    "description",
    "title",
    "format",
    "nullable",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "properties",
    "required",
    "items",
  ]);

  function walk(node: unknown, path: string): void {
    assert.ok(node && typeof node === "object", `${path} must be an object`);
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      assert.ok(allowed.has(key), `${path}.${key} is not a documented Gemini Schema key`);
    }
    assert.ok(typeof record.type === "string", `${path} must declare a type`);
    if (record.type === "object") {
      const properties = record.properties as Record<string, unknown>;
      assert.ok(properties && Object.keys(properties).length > 0, `${path} object needs properties`);
      for (const [name, value] of Object.entries(properties)) walk(value, `${path}.${name}`);
    }
    if (record.type === "array") walk(record.items, `${path}.items`);
  }

  const agentNodes = describeNodes().filter((node) => node.agentCallable);
  assert.ok(agentNodes.length > 0, "the agent has no tools at all");
  for (const node of agentNodes) {
    const parameters = toToolParameters(node.configSchema);
    if (parameters) walk(parameters, node.type);
  }
});
