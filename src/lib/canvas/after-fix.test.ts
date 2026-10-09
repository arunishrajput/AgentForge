import assert from "node:assert/strict";
import { test } from "node:test";

import { diffGraphs } from "@/lib/workflow/diff";
import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

import { afterFix } from "./after-fix";

/**
 * Which way to run again after a fix — Phase 36, D171. The case that matters most is the one a
 * retry would get silently wrong: a fix to a step that already ran, which a retry would reuse.
 */

/** trigger → total → check, where `check` (an assert) failed on what `total` produced. */
const BASE: WorkflowGraph = {
  version: GRAPH_VERSION,
  nodes: [
    { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
    { id: "total", type: "transform.number", label: "Add tax", position: { x: 300, y: 0 }, config: { operation: "multiply", value: 18 } },
    { id: "check", type: "core.assert", label: "Check the total", position: { x: 600, y: 0 }, config: { operator: "lt", right: 1000 } },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "total", sourceHandle: null },
    { id: "e2", source: "total", target: "check", sourceHandle: null },
  ],
};

const FACTS = { failedNodeId: "check", ran: ["trigger", "total"], partialTest: false };

function edit(change: (graph: WorkflowGraph) => void): WorkflowGraph {
  const graph = structuredClone(BASE);
  change(graph);
  return graph;
}

const node = (graph: WorkflowGraph, id: string) => graph.nodes.find((candidate) => candidate.id === id)!;

test("a fix to the step that failed is retried from that step", () => {
  const fixed = edit((graph) => {
    node(graph, "check").config = { operator: "lt", right: 100_000 };
  });
  assert.deepEqual(afterFix(FACTS, diffGraphs(BASE, fixed)), { kind: "retry" });
});

test("a fix to a step that already ran is a re-run — a retry would reuse its old output and fail again", () => {
  const fixed = edit((graph) => {
    node(graph, "total").config = { operation: "multiply", value: 1.18 };
  });
  assert.deepEqual(afterFix(FACTS, diffGraphs(BASE, fixed)), { kind: "rerun", why: "ran", nodes: ["total"] });
});

test("renaming a step that ran changes nothing it does, so a retry still stands", () => {
  const fixed = edit((graph) => {
    node(graph, "total").label = "Add 18% tax";
    node(graph, "check").config = { operator: "lt", right: 100_000 };
  });
  assert.deepEqual(afterFix(FACTS, diffGraphs(BASE, fixed)), { kind: "retry" });
});

test("a step put in front of the failed one would never run in a retry, so it is a re-run", () => {
  const fixed = edit((graph) => {
    graph.nodes.push({ id: "round", type: "transform.number", position: { x: 450, y: 0 }, config: { operation: "round" } });
    graph.edges = [
      { id: "e1", source: "trigger", target: "total", sourceHandle: null },
      { id: "e2", source: "total", target: "round", sourceHandle: null },
      { id: "e3", source: "round", target: "check", sourceHandle: null },
    ];
  });
  const advice = afterFix(FACTS, diffGraphs(BASE, fixed));
  assert.equal(advice.kind, "rerun");
  assert.ok(advice.kind === "rerun" && advice.nodes.includes("check"));
});

test("a step added after the failed one runs in a retry", () => {
  const fixed = edit((graph) => {
    node(graph, "check").config = { operator: "lt", right: 100_000 };
    graph.nodes.push({ id: "log", type: "core.log", position: { x: 900, y: 0 }, config: { message: "ok" } });
    graph.edges.push({ id: "e3", source: "check", target: "log", sourceHandle: null });
  });
  assert.deepEqual(afterFix(FACTS, diffGraphs(BASE, fixed)), { kind: "retry" });
});

test("removing the step it failed at leaves nothing to retry from", () => {
  const fixed = edit((graph) => {
    graph.nodes = graph.nodes.filter((candidate) => candidate.id !== "check");
    graph.edges = graph.edges.filter((edge) => edge.target !== "check");
  });
  assert.deepEqual(afterFix(FACTS, diffGraphs(BASE, fixed)), { kind: "rerun", why: "gone", nodes: ["check"] });
});

test("a test of part of the workflow is tested again, whatever the fix", () => {
  const fixed = edit((graph) => {
    node(graph, "check").config = { operator: "lt", right: 100_000 };
  });
  assert.deepEqual(afterFix({ ...FACTS, partialTest: true }, diffGraphs(BASE, fixed)), { kind: "rerun", why: "test", nodes: [] });
});

test("a run that stopped between steps is retried from where it stopped, unless a step that ran changed", () => {
  const between = { failedNodeId: null, ran: ["trigger", "total", "check"], partialTest: false };
  const changed = edit((graph) => {
    node(graph, "check").config = { operator: "lt", right: 100_000 };
  });
  assert.deepEqual(afterFix(between, diffGraphs(BASE, changed)), { kind: "rerun", why: "ran", nodes: ["check"] });
  const relabelled = edit((graph) => {
    node(graph, "check").label = "Check it";
  });
  assert.deepEqual(afterFix(between, diffGraphs(BASE, relabelled)), { kind: "retry" });
});
