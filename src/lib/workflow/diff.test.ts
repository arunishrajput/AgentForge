import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffGraph, diffGraphs, summaryParts } from "./diff";
import { GRAPH_VERSION, type WorkflowGraph, type WorkflowNode } from "./graph";

/**
 * The diff is the one piece of Phase 18 that is pure, and it is also the piece whose
 * mistakes are invisible: a diff that quietly reports "unchanged" for an edited node
 * looks exactly like a correct diff of an unedited workflow.
 */

function node(id: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: "core.log",
    position: { x: 0, y: 0 },
    config: {},
    ...overrides,
  };
}

function graph(nodes: WorkflowNode[], edges: WorkflowGraph["edges"] = []): WorkflowGraph {
  return { version: GRAPH_VERSION, nodes, edges };
}

describe("diffGraphs — nodes", () => {
  it("reports an identical graph as entirely unchanged", () => {
    const a = graph([node("log"), node("set", { type: "core.set" })]);
    const diff = diffGraphs(a, structuredClone(a));

    assert.deepEqual(
      diff.nodes.map((entry) => entry.change),
      ["unchanged", "unchanged"],
    );
    assert.equal(diff.summary.any, false);
    assert.equal(diff.summary.unchanged, 2);
  });

  it("reports a node only in the target as added, and only in the base as removed", () => {
    const diff = diffGraphs(graph([node("a")]), graph([node("a"), node("b")]));

    assert.equal(diff.summary.added, 1);
    assert.equal(diff.summary.removed, 0);
    assert.equal(diff.nodes.find((entry) => entry.id === "b")?.change, "added");

    const back = diffGraphs(graph([node("a"), node("b")]), graph([node("a")]));
    assert.equal(back.summary.removed, 1);
    assert.equal(back.nodes.find((entry) => entry.id === "b")?.change, "removed");
  });

  it("a removed node is carried with the node as it WAS — it exists nowhere else", () => {
    const diff = diffGraphs(
      graph([node("gone", { label: "Old step", position: { x: 40, y: 80 } })]),
      graph([]),
    );

    const removed = diff.nodes[0];
    assert.equal(removed.change, "removed");
    assert.equal(removed.node.label, "Old step");
    assert.deepEqual(removed.node.position, { x: 40, y: 80 });
  });

  it("distinguishes a move from a change", () => {
    const moved = diffGraphs(
      graph([node("a", { position: { x: 0, y: 0 } })]),
      graph([node("a", { position: { x: 300, y: 0 } })]),
    );
    assert.equal(moved.nodes[0].change, "moved");
    assert.equal(moved.summary.moved, 1);
    assert.deepEqual(moved.nodes[0].fields, []);

    const changed = diffGraphs(
      graph([node("a", { config: { message: "one" } })]),
      graph([node("a", { config: { message: "two" } })]),
    );
    assert.equal(changed.nodes[0].change, "changed");
    assert.deepEqual(changed.nodes[0].fields, ["config"]);
  });

  it("substance outranks position: a node reconfigured AND dragged is changed", () => {
    const diff = diffGraphs(
      graph([node("a", { config: { message: "one" }, position: { x: 0, y: 0 } })]),
      graph([node("a", { config: { message: "two" }, position: { x: 99, y: 99 } })]),
    );

    assert.equal(diff.nodes[0].change, "changed");
    assert.equal(diff.summary.moved, 0);
  });

  it("names every field that differs", () => {
    const diff = diffGraphs(
      graph([node("a", { label: "One", config: { message: "x" } })]),
      graph([
        node("a", {
          type: "core.set",
          label: "Two",
          config: { message: "y" },
          policy: { retries: 2, backoffMs: 500 },
        }),
      ]),
    );

    assert.deepEqual(diff.nodes[0].fields, ["type", "label", "config", "policy"]);
  });

  it("does not treat an absent label and an empty one as a change", () => {
    const diff = diffGraphs(graph([node("a")]), graph([node("a", { label: "" })]));
    assert.equal(diff.nodes[0].change, "unchanged");
  });

  it("does not treat reordered config keys as a change — jsonb normalises them", () => {
    const diff = diffGraphs(
      graph([node("a", { config: { alpha: 1, beta: { x: 1, y: 2 } } })]),
      graph([node("a", { config: { beta: { y: 2, x: 1 }, alpha: 1 } })]),
    );

    assert.equal(diff.nodes[0].change, "unchanged");
    assert.equal(diff.summary.any, false);
  });

  it("carries the previous node on a change, so the canvas can show both sides", () => {
    const diff = diffGraphs(
      graph([node("a", { label: "Before" })]),
      graph([node("a", { label: "After" })]),
    );

    assert.equal(diff.nodes[0].before?.label, "Before");
    assert.equal(diff.nodes[0].node.label, "After");
  });

  it("orders nodes by the target, with removed ones appended", () => {
    const diff = diffGraphs(
      graph([node("gone"), node("a"), node("b")]),
      graph([node("b"), node("a")]),
    );

    assert.deepEqual(
      diff.nodes.map((entry) => entry.id),
      ["b", "a", "gone"],
    );
  });
});

describe("diffGraphs — edges", () => {
  it("matches an edge by what it connects, not by its id", () => {
    // `nextEdgeId` re-mints the lowest free `eN`, so an id-matched diff would call
    // these two completely different edges "unchanged".
    const diff = diffGraphs(
      graph([node("a"), node("b"), node("c")], [{ id: "e1", source: "a", target: "b" }]),
      graph([node("a"), node("b"), node("c")], [{ id: "e1", source: "a", target: "c" }]),
    );

    assert.equal(diff.summary.edgesAdded, 1);
    assert.equal(diff.summary.edgesRemoved, 1);
    assert.equal(diff.summary.any, true);
  });

  it("treats the same connection under a different id as unchanged", () => {
    const diff = diffGraphs(
      graph([node("a"), node("b")], [{ id: "e1", source: "a", target: "b" }]),
      graph([node("a"), node("b")], [{ id: "e7", source: "a", target: "b" }]),
    );

    assert.equal(diff.summary.edgesAdded, 0);
    assert.equal(diff.summary.edgesRemoved, 0);
    assert.equal(diff.summary.any, false);
  });

  it("a rewired branch handle is a different edge", () => {
    const diff = diffGraphs(
      graph([node("a"), node("b")], [{ id: "e1", source: "a", target: "b", sourceHandle: "true" }]),
      graph([node("a"), node("b")], [{ id: "e1", source: "a", target: "b", sourceHandle: "false" }]),
    );

    assert.equal(diff.summary.edgesAdded, 1);
    assert.equal(diff.summary.edgesRemoved, 1);
  });

  it("normalises an absent handle to null so it matches a stored null", () => {
    const diff = diffGraphs(
      graph([node("a"), node("b")], [{ id: "e1", source: "a", target: "b" }]),
      graph([node("a"), node("b")], [{ id: "e1", source: "a", target: "b", sourceHandle: null }]),
    );

    assert.equal(diff.summary.any, false);
    assert.equal(diff.edges[0].sourceHandle, null);
  });
});

describe("diffGraph — the renderable union", () => {
  it("includes both sides' nodes, removed ones at their old position", () => {
    const base = graph(
      [node("kept"), node("gone", { position: { x: 500, y: 20 } })],
      [{ id: "e1", source: "kept", target: "gone" }],
    );
    const target = graph([node("kept"), node("new")]);

    const union = diffGraph(diffGraphs(base, target), GRAPH_VERSION);

    assert.deepEqual(
      union.nodes.map((entry) => entry.id).toSorted(),
      ["gone", "kept", "new"],
    );
    assert.deepEqual(union.nodes.find((entry) => entry.id === "gone")?.position, {
      x: 500,
      y: 20,
    });
  });

  it("never stacks a removed node on top of a live one", () => {
    // The defect this test exists for, found in a browser and invisible to every API
    // check: delete the last node of a chain and add a new one, and `addNode` places
    // the new node in the slot the old one just vacated. The union then holds two
    // nodes at identical coordinates, React Flow stacks them, and the ADDED node is
    // rendered invisible underneath the removed one.
    const base = graph([node("keep"), node("gone", { position: { x: 520, y: 0 } })]);
    const target = graph([node("keep"), node("fresh", { position: { x: 520, y: 0 } })]);

    const union = diffGraph(diffGraphs(base, target), GRAPH_VERSION);
    const fresh = union.nodes.find((entry) => entry.id === "fresh");
    const gone = union.nodes.find((entry) => entry.id === "gone");

    assert.deepEqual(fresh?.position, { x: 520, y: 0 }, "the live graph keeps its layout");
    assert.notDeepEqual(gone?.position, fresh?.position, "the ghost must move clear");
    assert.ok((gone?.position.y ?? 0) > 0, "it drops rather than drifting sideways");
  });

  it("moves a ghost only when it would collide, and never a surviving node", () => {
    const base = graph([node("keep"), node("gone", { position: { x: 900, y: 400 } })]);
    const target = graph([node("keep")]);

    const union = diffGraph(diffGraphs(base, target), GRAPH_VERSION);

    assert.deepEqual(
      union.nodes.find((entry) => entry.id === "gone")?.position,
      { x: 900, y: 400 },
      "a ghost with the space to itself keeps the position it had",
    );
  });

  it("separates two removed nodes that shared a slot with each other", () => {
    const base = graph([
      node("a", { position: { x: 0, y: 0 } }),
      node("b", { position: { x: 0, y: 0 } }),
    ]);
    const union = diffGraph(diffGraphs(base, graph([])), GRAPH_VERSION);

    const [first, second] = union.nodes;
    assert.notDeepEqual(first.position, second.position);
  });

  it("gives every edge a unique id, including a removed one that collides", () => {
    // `e1` deleted and `e1` re-minted for a different connection: both must draw.
    const base = graph([node("a"), node("b"), node("c")], [{ id: "e1", source: "a", target: "b" }]);
    const target = graph(
      [node("a"), node("b"), node("c")],
      [{ id: "e1", source: "a", target: "c" }],
    );

    const union = diffGraph(diffGraphs(base, target), GRAPH_VERSION);
    const ids = union.edges.map((edge) => edge.id);

    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2, "edge ids must be unique or React Flow drops one");
  });
});

describe("summaryParts", () => {
  it("is empty when nothing changed", () => {
    const { summary } = diffGraphs(graph([node("a")]), graph([node("a")]));
    assert.deepEqual(summaryParts(summary), []);
  });

  it("carries a written form beside every symbol — never colour or glyph alone", () => {
    const { summary } = diffGraphs(
      graph([node("a"), node("b")], [{ id: "e1", source: "a", target: "b" }]),
      graph([node("a"), node("c", { label: "New" })]),
    );

    const parts = summaryParts(summary);
    assert.ok(parts.length > 0);
    for (const part of parts) {
      assert.ok(part.symbol.length > 0, "every part needs a symbol");
      assert.ok(/[a-z]/.test(part.words), `"${part.words}" must read as words`);
    }
  });

  it("pluralises by count", () => {
    const one = diffGraphs(graph([]), graph([node("a")])).summary;
    assert.equal(summaryParts(one)[0].words, "1 node added");

    const two = diffGraphs(graph([]), graph([node("a"), node("b")])).summary;
    assert.equal(summaryParts(two)[0].words, "2 nodes added");
  });
});
