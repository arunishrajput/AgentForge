import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listNodes } from "@/lib/nodes";

import { GRAPH_VERSION, type WorkflowGraph, type WorkflowNode } from "./graph";
import { publishableTypes, shareNode, shareWorkflow } from "./share";

/**
 * **What a public share link may carry.** This is the test for the product's fourth
 * unauthenticated surface, so it is written as a set of properties rather than as a list
 * of examples: the interesting failure is not "this field came out wrong", it is "a field
 * nobody thought about came out at all".
 */

const node = (over: Partial<WorkflowNode> & Pick<WorkflowNode, "type">): WorkflowNode => ({
  id: "n1",
  position: { x: 0, y: 0 },
  config: {},
  ...over,
});

describe("the publishable table stays in step with the registry", () => {
  it("has an entry for every registered node type", () => {
    // **The check that makes "fails closed" a property rather than an intention.** Adding a
    // node makes this fail until somebody has decided what a public link may show of it.
    // Without it the default is still closed — an unlisted node publishes nothing — but the
    // decision would be taken by omission, which is not the same as being taken.
    const declared = new Set(publishableTypes());
    const missing = listNodes()
      .map((definition) => definition.type)
      .filter((type) => !declared.has(type));
    assert.deepEqual(
      missing,
      [],
      `these node types have no entry in PUBLISHABLE in lib/workflow/share.ts: ${missing.join(", ")}`,
    );
  });

  it("names no type the registry does not have", () => {
    // The other direction: a stale entry for a renamed node is a rule that silently stopped
    // applying, and the node it was written for is now publishing nothing.
    const registered = new Set(listNodes().map((definition) => definition.type));
    const stale = publishableTypes().filter((type) => !registered.has(type));
    assert.deepEqual(stale, [], `stale entries: ${stale.join(", ")}`);
  });

  it("publishes no config field the node's own schema does not declare", () => {
    // Catches a rename: `timeoutMs` allowlisted after the field became `timeout` is a rule
    // that no longer protects anything, and nothing else would report it.
    for (const definition of listNodes()) {
      const shape = (definition.configSchema as unknown as { _zod?: { def?: { shape?: object } } })
        ._zod?.def?.shape;
      if (!shape) continue;
      const fields = new Set(Object.keys(shape));
      // Round-trip a fully-populated config through the redactor and check that everything
      // it published is a field the schema knows about.
      const config = Object.fromEntries([...fields].map((name) => [name, "x"]));
      const shared = shareNode(node({ type: definition.type, config }));
      for (const published of Object.keys(shared.config)) {
        assert.equal(fields.has(published), true, `${definition.type}.${published}`);
      }
    }
  });
});

describe("shareNode redacts every authored value", () => {
  it("publishes an HTTP node's settings and header NAMES, never its url, body or header values", () => {
    // The sharpest case in the table: the node's own schema documents `headers` as where to
    // put "an authorization header", so its values can never be published — and a key in a
    // query string is the oldest way to leak one, which is why the url goes too.
    const shared = shareNode(
      node({
        type: "integration.http",
        config: {
          method: "POST",
          url: "https://api.example.com/v1/send?api_key=SECRET",
          headers: { authorization: "Bearer SECRET", "content-type": "application/json" },
          body: '{"to":"someone@example.com"}',
          timeoutMs: 15_000,
          failOnError: true,
        },
      }),
    );

    assert.equal(shared.config.method, "POST");
    assert.equal(shared.config.timeoutMs, 15_000);
    assert.equal(shared.config.failOnError, true);
    assert.deepEqual(shared.config.headers, { authorization: null, "content-type": null });
    assert.equal("url" in shared.config, false);
    assert.equal("body" in shared.config, false);
    assert.doesNotMatch(JSON.stringify(shared), /SECRET/);
    assert.doesNotMatch(JSON.stringify(shared), /someone@example\.com/);
    // The reader is told values were withheld rather than shown a node that looks
    // unconfigured — including `headers`, of which they can see names and no values.
    assert.deepEqual([...shared.redacted].sort(), ["body", "headers", "url"]);
  });

  it("publishes nothing at all from a Gmail node", () => {
    // `to` and `cc` are other people's addresses, which are not the workflow author's to
    // publish, and the subject and body are content.
    const shared = shareNode(
      node({
        type: "integration.gmail",
        config: { to: "person@example.com", cc: "other@example.com", subject: "Hi", body: "Text" },
      }),
    );
    assert.deepEqual(shared.config, {});
    assert.doesNotMatch(JSON.stringify(shared), /@example\.com/);
    assert.equal(shared.redacted.length, 4);
  });

  it("publishes a Set node's field NAMES and none of its values", () => {
    const shared = shareNode(
      node({
        type: "core.set",
        config: { merge: true, fields: { apiKey: "sk-live-1234", subject: "{{input.topic}}" } },
      }),
    );
    assert.equal(shared.config.merge, true);
    assert.deepEqual(shared.config.fields, { apiKey: null, subject: null });
    assert.doesNotMatch(JSON.stringify(shared), /sk-live/);
  });

  it("publishes an agent's model, caps, tools and choices, and not its prompts", () => {
    const shared = shareNode(
      node({
        type: "ai.agent",
        config: {
          objective: "Decide whether this is urgent",
          system: "You are given an internal escalation policy: CONFIDENTIAL",
          model: "gemini-3-flash-preview",
          tools: ["integration.http"],
          choices: ["urgent", "normal"],
          maxIterations: 4,
          temperature: 0.2,
        },
      }),
    );
    assert.equal(shared.config.model, "gemini-3-flash-preview");
    assert.deepEqual(shared.config.tools, ["integration.http"]);
    assert.deepEqual(shared.config.choices, ["urgent", "normal"]);
    assert.equal(shared.config.maxIterations, 4);
    assert.doesNotMatch(JSON.stringify(shared), /CONFIDENTIAL/);
    assert.doesNotMatch(JSON.stringify(shared), /urgent\?|Decide whether/);
  });

  it("publishes the trigger's interface — the fields a caller must send, and the cron", () => {
    const webhook = shareNode(
      node({ type: "core.webhook_trigger", config: { requiredFields: ["message", "email"] } }),
    );
    assert.deepEqual(webhook.config.requiredFields, ["message", "email"]);

    const schedule = shareNode(node({ type: "core.schedule_trigger", config: { cron: "*/15 * * * *" } }));
    assert.equal(schedule.config.cron, "*/15 * * * *");
  });

  it("publishes nothing from a node type it does not know", () => {
    // A graph can name a type this build does not have — a node renamed in a later phase, a
    // version restored from an older one. The honest answer on a public endpoint is to
    // publish none of it, and to say so in `redacted`.
    const shared = shareNode(node({ type: "integration.invented", config: { token: "SECRET", n: 1 } }));
    assert.deepEqual(shared.config, {});
    assert.deepEqual([...shared.redacted].sort(), ["n", "token"]);
    assert.doesNotMatch(JSON.stringify(shared), /SECRET/);
  });

  it("redacts a field declared object-shaped when its value is not an object", () => {
    // A `keys` field holding a string cannot have its names published, and guessing at it
    // would publish the string. Redacted whole.
    const shared = shareNode(node({ type: "integration.http", config: { headers: "Bearer SECRET" } }));
    assert.equal("headers" in shared.config, false);
    assert.deepEqual(shared.redacted, ["headers"]);
    assert.doesNotMatch(JSON.stringify(shared), /SECRET/);
  });

  it("does not call an empty object field redacted", () => {
    // Nothing was withheld, so the count must not claim otherwise — a "1 value hidden" on a
    // node with no values is the same kind of lie in the other direction.
    const shared = shareNode(node({ type: "integration.http", config: { headers: {} } }));
    assert.deepEqual(shared.config.headers, {});
    assert.deepEqual(shared.redacted, []);
  });

  it("keeps id, type, position and label, and adds nothing else", () => {
    const shared = shareNode(
      node({ type: "core.log", id: "say", label: "Say it", position: { x: 12, y: -4 }, config: { level: "warn", message: "hi" } }),
    );
    assert.deepEqual(Object.keys(shared).sort(), ["config", "id", "label", "position", "redacted", "type"]);
    assert.deepEqual(shared.position, { x: 12, y: -4 });
    assert.equal(shared.label, "Say it");
  });

  it("omits label rather than sending undefined when a node has none", () => {
    const shared = shareNode(node({ type: "core.log" }));
    assert.equal("label" in shared, false);
  });
});

describe("shareWorkflow builds the whole response from an explicit list", () => {
  const graph: WorkflowGraph = {
    version: GRAPH_VERSION,
    nodes: [
      node({ type: "core.manual_trigger", id: "trigger" }),
      node({ type: "integration.gmail", id: "mail", config: { to: "person@example.com" } }),
    ],
    edges: [{ id: "e1", source: "trigger", target: "mail", sourceHandle: null }],
  };

  const row = {
    id: "wf-1",
    ownerId: "user-1",
    workspaceId: "ws-1",
    name: "Escalate urgent mail",
    description: "What it does",
    graph,
    webhookToken: "WEBHOOK-TOKEN-SECRET",
    scheduleNextAt: null,
    scheduleLastFiredAt: null,
    version: 7,
    visibility: "workspace" as const,
    shareToken: "SHARE-TOKEN-SECRET",
    sharedAt: new Date("2026-09-30T00:00:00Z"),
    webhookTokenRotatedAt: null,
    // Phase 26's two columns. Neither may reach a share link: whether a workflow is
    // switched on and when its timer is armed are operating facts, not the diagram.
    scheduleArmedFor: new Date("2026-10-07T09:00:00Z"),
    active: false,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-29T12:00:00Z"),
  };

  it("carries the name, description, version and updatedAt", () => {
    const shared = shareWorkflow(row);
    assert.equal(shared.name, "Escalate urgent mail");
    assert.equal(shared.description, "What it does");
    assert.equal(shared.version, 7);
    assert.equal(shared.updatedAt, "2026-09-29T12:00:00.000Z");
  });

  it("carries no token, no id and no owner — the reason it is built field by field", () => {
    // Spreading the row and deleting the known secrets is the shape that fails the day a
    // column is added to `workflow`. This asserts the outcome of not doing that.
    const body = JSON.stringify(shareWorkflow(row));
    for (const forbidden of ["WEBHOOK-TOKEN-SECRET", "SHARE-TOKEN-SECRET", "user-1", "ws-1", "wf-1"]) {
      assert.doesNotMatch(body, new RegExp(forbidden), forbidden);
    }
    assert.deepEqual(
      Object.keys(shareWorkflow(row)).sort(),
      ["description", "graph", "name", "updatedAt", "version"],
    );
  });

  it("redacts inside the graph, not only around it", () => {
    assert.doesNotMatch(JSON.stringify(shareWorkflow(row)), /person@example\.com/);
  });

  it("keeps the edges, so the shape survives", () => {
    const shared = shareWorkflow(row);
    assert.equal(shared.graph.nodes.length, 2);
    assert.deepEqual(shared.graph.edges, [
      { id: "e1", source: "trigger", target: "mail", sourceHandle: null },
    ]);
  });

  it("normalises an absent sourceHandle to null, as the stored graph does", () => {
    const shared = shareWorkflow({
      ...row,
      graph: { ...graph, edges: [{ id: "e1", source: "trigger", target: "mail" }] },
    });
    assert.equal(shared.graph.edges[0]?.sourceHandle, null);
  });
});
