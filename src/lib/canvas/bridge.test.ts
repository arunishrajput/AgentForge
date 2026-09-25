import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_NODE_TYPE,
  fromFlow,
  graphsEqual,
  nextEdgeId,
  nextNodeId,
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
