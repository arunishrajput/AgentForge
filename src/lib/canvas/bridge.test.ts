import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_NODE_TYPE,
  fromFlow,
  graphsEqual,
  nextEdgeId,
  nextNodeId,
  readOnlyChanges,
  restoreEdges,
  restoreNodes,
  toFlow,
  type CanvasEdge,
  type CanvasNode,
} from "./bridge";
import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

/**
 * The canvas round trip. A workflow that reloads with a scrambled layout or a lost
 * edge handle is a broken product, not a cosmetic bug, so this is a critical-path
 * test: it is the same assertion the deployed verification makes over HTTP.
 */

const graph: WorkflowGraph = {
  version: GRAPH_VERSION,
  nodes: [
    {
      id: "manual_trigger",
      type: "core.manual_trigger",
      position: { x: -120.5, y: 40 },
      config: {},
    },
    {
      id: "shape",
      type: "core.set",
      label: "Build the payload",
      position: { x: 240, y: 0 },
      config: { fields: { subject: "{{input.topic}}" }, merge: false },
    },
    {
      id: "check",
      type: "core.branch",
      position: { x: 520, y: 0 },
      config: { left: "{{input.status}}", operator: "equals", right: "ok" },
    },
  ],
  edges: [
    { id: "e1", source: "manual_trigger", target: "shape", sourceHandle: null },
    { id: "e2", source: "shape", target: "check", sourceHandle: null },
    { id: "e3", source: "check", target: "shape", sourceHandle: "true" },
  ],
};

test("a graph survives the trip to the canvas and back, unchanged", () => {
  const { nodes, edges } = toFlow(graph);
  assert.deepEqual(fromFlow(nodes, edges), graph);
});

test("positions are preserved exactly, including negatives and fractions", () => {
  const { nodes, edges } = toFlow(graph);
  const back = fromFlow(nodes, edges);
  assert.deepEqual(
    back.nodes.map((node) => node.position),
    [
      { x: -120.5, y: 40 },
      { x: 240, y: 0 },
      { x: 520, y: 0 },
    ],
  );
});

test("named output handles survive; the default output stays null", () => {
  const { nodes, edges } = toFlow(graph);
  assert.deepEqual(
    fromFlow(nodes, edges).edges.map((edge) => edge.sourceHandle),
    [null, null, "true"],
  );
});

test("React Flow's undefined sourceHandle is normalised to null", () => {
  // React Flow reports the default output as `undefined`; the engine reads `null`.
  const edges = [{ id: "e1", source: "a", target: "b" }] as CanvasEdge[];
  assert.equal(fromFlow([], edges).edges[0].sourceHandle, null);
});

test("canvas-only node state never reaches the stored graph", () => {
  const { nodes, edges } = toFlow(graph);
  const dirty = nodes.map((node) => ({
    ...node,
    selected: true,
    dragging: false,
    measured: { width: 220, height: 80 },
  })) as CanvasNode[];

  assert.deepEqual(fromFlow(dirty, edges), graph);
});

test("a node with no label keeps the key absent rather than writing undefined", () => {
  const { nodes, edges } = toFlow(graph);
  const back = fromFlow(nodes, edges);
  assert.ok(!("label" in back.nodes[0]), "absent label must stay absent");
  assert.equal(back.nodes[1].label, "Build the payload");
});

test("every canvas node carries the single React Flow type, with the registry type in data", () => {
  const { nodes } = toFlow(graph);
  assert.deepEqual(
    nodes.map((node) => node.type),
    [CANVAS_NODE_TYPE, CANVAS_NODE_TYPE, CANVAS_NODE_TYPE],
  );
  assert.equal(nodes[1].data.nodeType, "core.set");
});

test("node ids are readable, derived from the type, and never collide", () => {
  assert.equal(nextNodeId([], "core.set"), "set");
  assert.equal(nextNodeId(["set"], "core.set"), "set_2");
  assert.equal(nextNodeId(["set", "set_2"], "core.set"), "set_3");
  assert.equal(nextNodeId([], "core.manual_trigger"), "manual_trigger");
});

test("edge ids fill the first free slot", () => {
  assert.equal(nextEdgeId([]), "e1");
  assert.equal(nextEdgeId(["e1", "e2"]), "e3");
  assert.equal(nextEdgeId(["e2"]), "e1");
});

test("graphs compare structurally, not by key order", () => {
  // What Postgres jsonb hands back: same data, keys reordered.
  const reordered: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      config: node.config,
      position: { y: node.position.y, x: node.position.x },
      type: node.type,
      id: node.id,
      ...(node.label === undefined ? {} : { label: node.label }),
    })) as WorkflowGraph["nodes"],
  };

  assert.notEqual(
    JSON.stringify(reordered),
    JSON.stringify(graph),
    "the fixture must actually differ as a string, or this test proves nothing",
  );
  assert.equal(graphsEqual(reordered, graph), true);
});

test("a real difference is still a difference", () => {
  const moved: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.map((node, index) =>
      index === 0 ? { ...node, position: { x: 0, y: 0 } } : node,
    ),
  };
  assert.equal(graphsEqual(moved, graph), false);

  const relabelled: WorkflowGraph = {
    ...graph,
    edges: graph.edges.map((edge) =>
      edge.id === "e3" ? { ...edge, sourceHandle: "false" } : edge,
    ),
  };
  assert.equal(graphsEqual(relabelled, graph), false);
});

/* ------------------------------------------------------------------ *
 * Phase 17 — the per-node retry and timeout policy
 * ------------------------------------------------------------------ */

test("a node's policy survives the canvas round-trip", () => {
  // Without this the canvas would drop the policy on every save, which is the worst kind
  // of loss: the run still works, just without the retries somebody configured.
  const original: WorkflowGraph = {
    version: GRAPH_VERSION,
    nodes: [
      {
        id: "call",
        type: "integration.http",
        position: { x: 0, y: 0 },
        config: { url: "https://example.com" },
        policy: { retries: 2, backoffMs: 1000, timeoutMs: 20_000 },
      },
    ],
    edges: [],
  };

  const { nodes, edges } = toFlow(original);
  assert.deepEqual(fromFlow(nodes, edges), original);
});

test("a node with no policy round-trips without gaining one", () => {
  // Every workflow saved before Phase 17 is this case. A `policy: undefined` key would
  // make a freshly loaded graph structurally different from the stored one, and the
  // canvas would show it as unsaved the instant it loaded.
  const original: WorkflowGraph = {
    version: GRAPH_VERSION,
    nodes: [{ id: "a", type: "core.log", position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  };

  const { nodes, edges } = toFlow(original);
  const back = fromFlow(nodes, edges);
  assert.deepEqual(back, original);
  assert.equal("policy" in back.nodes[0], false);
  assert.equal(graphsEqual(back, original), true);
});

test("adding a policy makes the graph dirty, and removing it makes it clean again", () => {
  const clean: WorkflowGraph = {
    version: GRAPH_VERSION,
    nodes: [{ id: "a", type: "core.log", position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  };
  const withPolicy: WorkflowGraph = {
    ...clean,
    nodes: [{ ...clean.nodes[0], policy: { retries: 1, backoffMs: 500 } }],
  };

  assert.equal(graphsEqual(clean, withPolicy), false);

  // And the reverse: a policy set and then cleared leaves a graph equal to the original,
  // so "Reset to default" in the inspector genuinely returns the node to unsaved-clean.
  const flowed = toFlow(withPolicy);
  for (const node of flowed.nodes) node.data.policy = undefined;
  assert.equal(graphsEqual(clean, fromFlow(flowed.nodes, flowed.edges)), true);
});

test("restoring a graph over the canvas applies every stored field and nothing else", () => {
  const { nodes, edges } = toFlow(graph);
  // What React Flow hangs on the nodes and edges on screen.
  const onScreen: CanvasNode[] = nodes.map((node) => ({
    ...node,
    selected: node.id === "shape",
    measured: { width: 224, height: 119 },
  }));
  const onScreenEdges: CanvasEdge[] = edges.map((edge) => ({ ...edge, selected: edge.id === "e2" }));

  // The step being applied: `shape` moved and relabelled, `check` gone, a new node added.
  const step: WorkflowGraph = {
    version: GRAPH_VERSION,
    nodes: [
      graph.nodes[0],
      { ...graph.nodes[1], label: "Earlier name", position: { x: 10, y: 20 } },
      { id: "log", type: "core.log", position: { x: 900, y: 0 }, config: {} },
    ],
    edges: [graph.edges[0], { id: "e2", source: "shape", target: "log", sourceHandle: null }],
  };

  const restored = { nodes: restoreNodes(onScreen, step), edges: restoreEdges(onScreenEdges, step) };
  assert.deepEqual(fromFlow(restored.nodes, restored.edges), step, "the canvas now holds the step, exactly");

  const shape = restored.nodes.find((node) => node.id === "shape")!;
  assert.equal(shape.selected, true, "a surviving node keeps its selection");
  assert.deepEqual(shape.measured, { width: 224, height: 119 }, "and its measurement");
  const log = restored.nodes.find((node) => node.id === "log")!;
  assert.equal(log.selected, undefined, "a node only the graph has arrives fresh");
  assert.equal(restored.nodes.some((node) => node.id === "check"), false);
  assert.equal(restored.edges.find((edge) => edge.id === "e2")?.target, "log", "an edge id reused takes the graph's ends");
  assert.equal(restored.edges.find((edge) => edge.id === "e2")?.selected, true);
});

test("a canvas that cannot be edited still selects and measures, and changes nothing else", () => {
  const changes = [
    { type: "select" as const, id: "shape", selected: true },
    { type: "dimensions" as const, id: "shape", dimensions: { width: 224, height: 119 } },
    { type: "position" as const, id: "shape", position: { x: 9, y: 9 }, dragging: true },
    { type: "remove" as const, id: "shape" },
  ];
  assert.deepEqual(
    readOnlyChanges(changes).map((change) => change.type),
    ["select", "dimensions"],
  );
  assert.deepEqual(
    readOnlyChanges([
      { type: "select" as const, id: "e1", selected: true },
      { type: "remove" as const, id: "e1" },
    ]).map((change) => change.type),
    ["select"],
  );
});
