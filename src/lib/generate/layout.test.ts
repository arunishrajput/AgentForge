import assert from "node:assert/strict";
import { test } from "node:test";

import { layout } from "./layout";
import type { GeneratedEdge, GeneratedNode } from "./schema";

const node = (id: string): GeneratedNode => ({ id, type: "core.log", config: {} });
const edge = (source: string, target: string, sourceHandle?: string): GeneratedEdge => ({
  source,
  target,
  ...(sourceHandle === undefined ? {} : { sourceHandle }),
});

/** A canvas node is 224 px wide and roughly 100 px tall. */
const NODE_WIDTH = 224;
const NODE_HEIGHT = 100;

function assertNoOverlap(positions: Map<string, { x: number; y: number }>) {
  const entries = [...positions.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [idA, a] = entries[i];
      const [idB, b] = entries[j];
      const apart =
        Math.abs(a.x - b.x) >= NODE_WIDTH || Math.abs(a.y - b.y) >= NODE_HEIGHT;
      assert.ok(apart, `${idA} and ${idB} overlap: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
}

test("a chain lays out left to right, one column per step", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const positions = layout(nodes, [edge("a", "b"), edge("b", "c")]);

  assert.deepEqual(positions.get("a"), { x: 0, y: 0 });
  assert.equal(positions.get("b")!.x, 300);
  assert.equal(positions.get("c")!.x, 600);
  assertNoOverlap(positions);
});

test("a node sits to the right of everything that feeds it, not just its first edge", () => {
  // `c` is reachable in one hop from `a` and in two through `b`. The longest path
  // wins, or the edge from `b` would point backwards on the canvas.
  const positions = layout(
    [node("a"), node("b"), node("c")],
    [edge("a", "b"), edge("b", "c"), edge("a", "c")],
  );

  assert.equal(positions.get("c")!.x, 600);
  assert.ok(positions.get("c")!.x > positions.get("b")!.x);
});

test("a fan-out is centred rather than hanging off one side", () => {
  const positions = layout(
    [node("route"), node("yes"), node("no")],
    [edge("route", "yes", "true"), edge("route", "no", "false")],
  );

  assert.equal(positions.get("yes")!.y, -70);
  assert.equal(positions.get("no")!.y, 70);
  assertNoOverlap(positions);
});

test("nodes in the same column never overlap, however wide the fan-out", () => {
  const nodes = [node("root"), ...Array.from({ length: 12 }, (_, i) => node(`leaf${i}`))];
  const edges = nodes.slice(1).map((leaf) => edge("root", leaf.id));

  assertNoOverlap(layout(nodes, edges));
});

test("an unconnected node still gets a position and does not sit on another", () => {
  const positions = layout([node("a"), node("b"), node("orphan")], [edge("a", "b")]);

  assert.equal(positions.size, 3);
  assertNoOverlap(positions);
});

/**
 * The reason layout is bounded relaxation rather than a topological walk. A legal
 * loop closes a cycle, and an illegal one has to survive layout long enough for
 * `validateGraph` to report it properly.
 */
test("a cycle terminates instead of hanging", () => {
  const positions = layout(
    [node("a"), node("b"), node("c")],
    [edge("a", "b"), edge("b", "c"), edge("c", "a")],
  );

  assert.equal(positions.size, 3);
  for (const position of positions.values()) {
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
  }
});

test("an edge naming a node that does not exist is skipped, not invented", () => {
  const positions = layout([node("a")], [edge("a", "ghost"), edge("ghost", "a")]);

  assert.equal(positions.size, 1);
  assert.deepEqual(positions.get("a"), { x: 0, y: 0 });
});

test("the same graph lays out identically twice", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [edge("a", "b"), edge("a", "c")];

  assert.deepEqual([...layout(nodes, edges)], [...layout(nodes, edges)]);
});
