import assert from "node:assert/strict";
import { test } from "node:test";

import { describeNodes } from "@/lib/nodes";
import { diffGraphs } from "@/lib/workflow/diff";
import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

import { VALUE_MAX, describeProposal, showValue } from "./proposal";

const registry = new Map(describeNodes().map((node) => [node.type, node]));

const BASE: WorkflowGraph = {
  version: GRAPH_VERSION,
  nodes: [
    { id: "trigger", type: "core.webhook_trigger", position: { x: 0, y: 0 }, config: {} },
    {
      id: "triage",
      type: "ai.agent",
      label: "Decide urgency",
      position: { x: 300, y: 0 },
      config: { objective: "Is it urgent?", choices: ["urgent", "normal"] },
    },
    { id: "queue", type: "core.log", position: { x: 600, y: 0 }, config: { message: "Normal" } },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "triage", sourceHandle: null },
    { id: "e2", source: "triage", target: "queue", sourceHandle: null },
  ],
};

test("an added node is named, says what it is, and lists every value it sets", () => {
  const proposed: WorkflowGraph = {
    ...BASE,
    nodes: [
      ...BASE.nodes,
      { id: "post", type: "integration.slack", label: "Alert the team", position: { x: 900, y: 0 }, config: { text: "Urgent!" } },
    ],
    edges: [...BASE.edges, { id: "e3", source: "triage", target: "post", sourceHandle: null }],
  };
  const lines = describeProposal(diffGraphs(BASE, proposed), registry);
  assert.deepEqual(lines[0], {
    key: "node:post",
    kind: "added",
    subject: "Alert the team",
    what: "Post to Slack",
    details: [{ key: "text", after: "Urgent!" }],
  });
  assert.deepEqual(lines[1], {
    key: 'added:["triage",null,"post"]',
    kind: "connected",
    subject: "Decide urgency → Alert the team",
    details: [],
  });
  assert.equal(new Set(lines.map((line) => line.key)).size, lines.length);
});

test("an agent given tools shows exactly which — least privilege is visible before Accept (D160)", () => {
  const proposed: WorkflowGraph = {
    ...BASE,
    nodes: BASE.nodes.map((node) =>
      node.id === "triage" ? { ...node, config: { ...node.config, tools: ["integration.slack", "core.log"] } } : node,
    ),
  };
  const [line] = describeProposal(diffGraphs(BASE, proposed), registry);
  assert.equal(line.kind, "changed");
  assert.equal(line.subject, "Decide urgency");
  assert.equal(line.summary, "configuration");
  assert.deepEqual(line.details, [{ key: "tools", after: "integration.slack, core.log" }]);
});

test("a changed value shows before and after; a removed key only before", () => {
  const proposed: WorkflowGraph = {
    ...BASE,
    nodes: BASE.nodes.map((node) =>
      node.id === "triage" ? { ...node, config: { choices: ["urgent", "normal", "spam"] } } : node,
    ),
  };
  const [line] = describeProposal(diffGraphs(BASE, proposed), registry);
  assert.deepEqual(line.details, [
    { key: "objective", before: "Is it urgent?" },
    { key: "choices", before: "urgent, normal", after: "urgent, normal, spam" },
  ]);
});

test("a rename is found by the old name and says the new one", () => {
  const proposed: WorkflowGraph = {
    ...BASE,
    nodes: BASE.nodes.map((node) => (node.id === "queue" ? { ...node, label: "Log the rest" } : node)),
  };
  const [line] = describeProposal(diffGraphs(BASE, proposed), registry);
  assert.equal(line.subject, "Log message");
  assert.equal(line.summary, "name");
  assert.deepEqual(line.details, [{ key: "name", before: "Log message", after: "Log the rest" }]);
});

test("a removed branch is the node, then its connection, by name — with the handle it left", () => {
  const proposed: WorkflowGraph = {
    ...BASE,
    nodes: BASE.nodes.filter((node) => node.id !== "queue"),
    edges: BASE.edges.filter((edge) => edge.id !== "e2"),
  };
  const lines = describeProposal(diffGraphs(BASE, proposed), registry);
  assert.deepEqual(
    lines.map((line) => [line.kind, line.subject]),
    [
      ["removed", "Log message"],
      ["disconnected", "Decide urgency → Log message"],
    ],
  );

  const handled = describeProposal(
    diffGraphs(
      { ...BASE, edges: [{ id: "e9", source: "triage", target: "queue", sourceHandle: "true" }] },
      { ...BASE, edges: [] },
    ),
    registry,
  );
  assert.equal(handled[0].subject, "Decide urgency (true) → Log message");
});

test("no change is no lines", () => {
  assert.deepEqual(describeProposal(diffGraphs(BASE, BASE), registry), []);
});

test("a value is one readable line: strings as they are, lists joined, the rest as JSON, all bounded", () => {
  assert.equal(showValue(""), "(empty)");
  assert.equal(showValue([]), "(none)");
  assert.equal(showValue(["a", "b"]), "a, b");
  assert.equal(showValue({ retries: 2 }), '{"retries":2}');
  assert.equal(showValue(3), "3");
  const long = showValue("x".repeat(500));
  assert.equal(long.length, VALUE_MAX);
  assert.ok(long.endsWith("…"));
});
