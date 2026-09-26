import assert from "node:assert/strict";
import { test } from "node:test";

import { agentToolSet, projectTool, toToolName } from "@/lib/ai/tools";
import { describeFields, defaultConfig } from "@/lib/canvas/schema";
import { validateGraph } from "@/lib/engine/validate";
import { describeNode, getNode, listAgentTools, listNodes } from "@/lib/nodes";

import { discordNode } from "./discord";
import { gmailNode } from "./gmail";
import { httpNode } from "./http";
import { jsonRecord } from "./shared";
import { sheetsNode } from "./sheets";

/**
 * The registry-level properties of the four Phase 9 integrations.
 *
 * These are the assertions that would have caught Phase 6's worst bug — a config
 * schema Gemini rejects with a 400, which surfaces only when an agent node first runs
 * on the deployed app with a real key, i.e. during the demo. Proving the projection
 * here costs a millisecond and nothing else does it.
 */

const integrations = [httpNode, discordNode, sheetsNode, gmailNode];

test("all four integrations are registered and dispatchable by type", () => {
  for (const node of integrations) {
    assert.equal(getNode(node.type), node, node.type);
    assert.equal(node.category, "integration", node.type);
    assert.equal(node.kind, "action", node.type);
  }
  assert.equal(listNodes().length, 15);
});

test("every integration declares the shape of its output", () => {
  // D38: without this the generator writes `{{steps.x.output}}` where it meant a
  // field, and the workflow runs successfully while doing the wrong thing.
  for (const node of integrations) {
    assert.ok(node.outputShape && node.outputShape.length > 20, node.type);
  }
});

test("three integrations are agent-callable and Gmail deliberately is not", () => {
  const callable = new Set(listAgentTools().map((node) => node.type));
  assert.ok(callable.has("integration.http"));
  assert.ok(callable.has("integration.discord"));
  assert.ok(callable.has("integration.sheets"));
  // D19/D36. A model-chosen recipient plus a model-chosen body is the one capability
  // here whose effect leaves the user's own account and cannot be recalled.
  assert.equal(callable.has("integration.gmail"), false);
  assert.equal(gmailNode.agentCallable, false);
});

test("the agent tool set is exactly the callable registry, projected", () => {
  const tools = agentToolSet();
  assert.deepEqual(
    [...tools.byName.keys()].sort(),
    ["core_log", "core_set", "integration_discord", "integration_http", "integration_sheets"].sort(),
  );
  assert.equal(toToolName("integration.http"), "integration_http");
  assert.equal(tools.rejected.length, 0);
});

test("a tool set narrowed to an integration cannot be widened past agentCallable", () => {
  const tools = agentToolSet({ allow: ["integration.sheets", "integration.gmail"] });
  assert.deepEqual([...tools.byName.keys()], ["integration_sheets"]);
  assert.deepEqual(tools.rejected, ["integration.gmail"]);
});

test("every integration's config projects to a schema Gemini accepts", () => {
  for (const node of integrations) {
    const spec = projectTool(node);
    assert.equal(spec.name, node.type.replace(/\./g, "_"));
    assert.ok(spec.description.length > 40, node.type);
    const parameters = spec.parameters as Record<string, unknown> | null;
    assert.ok(parameters, node.type);
    assert.equal(parameters.type, "object", node.type);
    // The Phase 6 trap: an undocumented key is a hard 400 from Gemini, not a warning.
    const forbidden = ["$schema", "additionalProperties", "propertyNames"];
    const serialised = JSON.stringify(parameters);
    for (const key of forbidden) {
      assert.ok(!serialised.includes(key), `${node.type} leaked ${key}`);
    }
  }
});

test("every integration's config renders as form fields, none falling back to raw JSON", () => {
  // The registry's whole claim: adding a node needs no UI work. A field landing on
  // the `json` fallback is the signal that claim has broken for this node.
  const kindsByNode = Object.fromEntries(
    integrations.map((node) => [
      node.type,
      describeFields(describeNode(node).configSchema).map((field) => `${field.key}:${field.kind}`),
    ]),
  );

  // `url` is a textarea, not an input: it is capped at 2000 characters because a URL
  // can carry a long query string, and `describeFields` sends anything over 200 to a
  // text box. Deliberate, and asserted so it stays deliberate.
  assert.deepEqual(kindsByNode["integration.http"], [
    "method:enum",
    "url:text",
    "headers:record",
    "body:text",
    "timeoutMs:number",
    "failOnError:boolean",
  ]);
  assert.deepEqual(kindsByNode["integration.discord"], ["content:text", "username:string"]);
  assert.deepEqual(kindsByNode["integration.gmail"], [
    "to:string",
    "subject:text",
    "body:text",
    "cc:string",
  ]);
  // `values` is an array, which is the documented raw-JSON fallback — acceptable here
  // and recorded as a Phase 10 polish item rather than pretended away.
  assert.deepEqual(kindsByNode["integration.sheets"], [
    "spreadsheetId:string",
    "sheet:string",
    "values:json",
    "valueInputOption:enum",
  ]);
});

test("a freshly added integration node starts with its schema defaults", () => {
  const config = defaultConfig(describeNode(httpNode).configSchema);
  assert.equal(config.method, "GET");
  assert.equal(config.timeoutMs, 15_000);
  assert.equal(config.failOnError, true);
  // `url` is required with no default, so the node reports invalid_config until it is
  // filled in — the honest state to show (see `defaultConfig`).
  assert.equal("url" in config, false);
});

test("required fields are required and optional ones are not", () => {
  const required = (node: typeof httpNode) =>
    describeFields(describeNode(node).configSchema)
      .filter((field) => field.required)
      .map((field) => field.key);

  assert.deepEqual(required(httpNode), ["url"]);
  assert.deepEqual(required(discordNode), ["content"]);
  // `spreadsheetId` and `to` are schema-optional on purpose: a generated workflow
  // that invented a spreadsheet id or a recipient would be worse than one that
  // visibly has none. Each fails with its own message if run before being filled in.
  assert.deepEqual(required(sheetsNode), ["values"]);
  assert.deepEqual(required(gmailNode), []);
});

/* ------------------------------------------------------------------ *
 * The header-map coercion, which exists for the agent
 * ------------------------------------------------------------------ */

test("a record field accepts the object a form sends and the JSON string a model sends", () => {
  const schema = jsonRecord("Headers.");
  assert.deepEqual(schema.parse({ authorization: "Bearer x" }), { authorization: "Bearer x" });
  assert.deepEqual(schema.parse('{"authorization":"Bearer x"}'), { authorization: "Bearer x" });
  assert.deepEqual(schema.parse(undefined), {});
  assert.deepEqual(schema.parse(""), {});
  assert.deepEqual(schema.parse("   "), {});
});

test("a malformed record is an issue, never an escaping throw", () => {
  // A throwing `preprocess` escapes safeParse entirely (measured on zod 4.6.5), which
  // would turn a bad agent argument into an unhandled 500 instead of a tool error the
  // model can correct.
  const schema = jsonRecord("Headers.");
  const result = schema.safeParse("not json at all");
  assert.equal(result.success, false);
  assert.equal(schema.safeParse('["a","b"]').success, false);
  assert.equal(schema.safeParse('{"a":1}').success, false);
});

test("the HTTP node's own schema accepts headers as a JSON string", () => {
  // End to end through the real node schema, because this is the path a tool call takes.
  const parsed = httpNode.configSchema.safeParse({
    url: "https://api.test/v1",
    method: "POST",
    headers: '{"content-type":"application/json"}',
    body: "{}",
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(
    (parsed.data as { headers: Record<string, string> }).headers,
    { "content-type": "application/json" },
  );
});

/* ------------------------------------------------------------------ *
 * The generation path: a workflow the model builds must actually validate
 * ------------------------------------------------------------------ */

test("a generated workflow whose spreadsheet is not yet chosen still validates", () => {
  // The shape DEMO.md Beat 2's prompt produces: "log every one to my Google Sheet"
  // names no spreadsheet. Generation validates before it persists (D40), so if this
  // were rejected the whole request would fail rather than producing an editable
  // workflow — which is exactly what a `min(1)` on spreadsheetId would have caused.
  const result = validateGraph({
    version: 1,
    nodes: [
      { id: "hook", type: "core.webhook_trigger", position: { x: 0, y: 0 }, config: {} },
      {
        id: "record",
        type: "integration.sheets",
        position: { x: 220, y: 0 },
        config: { spreadsheetId: "", sheet: "Sheet1", values: ["a literal, no template"] },
      },
    ],
    edges: [{ id: "e1", source: "hook", target: "record", sourceHandle: null }],
  });
  assert.equal(result.valid, true, JSON.stringify(result.problems));
});

test("a generated Discord and Gmail pair validates with no template to hide behind", () => {
  const result = validateGraph({
    version: 1,
    nodes: [
      { id: "start", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      {
        id: "notify",
        type: "integration.discord",
        position: { x: 220, y: 0 },
        config: { content: "done" },
      },
      { id: "mail", type: "integration.gmail", position: { x: 440, y: 0 }, config: { to: "" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "notify", sourceHandle: null },
      { id: "e2", source: "notify", target: "mail", sourceHandle: null },
    ],
  });
  assert.equal(result.valid, true, JSON.stringify(result.problems));
});

test("an HTTP node with no URL is rejected at validation, not at run time", () => {
  // The opposite case, and the reason the two above are not just laxity: a URL is not
  // something the user can be expected to supply later from context, so an absent one
  // is a broken node and validation says so.
  const result = validateGraph({
    version: 1,
    nodes: [
      { id: "start", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      { id: "call", type: "integration.http", position: { x: 220, y: 0 }, config: {} },
    ],
    edges: [{ id: "e1", source: "start", target: "call", sourceHandle: null }],
  });
  assert.equal(result.valid, false);
  assert.equal(result.problems[0]?.code, "invalid_config");
  assert.match(result.problems[0]?.message ?? "", /url/);
});
