import type { Position } from "@/lib/workflow/graph";

import type { GeneratedEdge, GeneratedNode } from "./schema";

/**
 * Auto-layout for a generated graph — BUILD_PLAN.md Phase 7, task 4.
 *
 * The model emits nodes and edges; positions come from here (see `schema.ts` on why
 * a model is not asked to lay out a graph). The bar from the phase definition is
 * exact: it "does not need to be clever, but it must not overlap nodes — an
 * overlapping graph reads as broken on stage."
 *
 * So: layered left to right. A node's column is the length of the longest path
 * reaching it, which puts every node to the right of everything that feeds it, and
 * a column's members are stacked and centred vertically.
 *
 * A canvas node is `w-56` — 224 px — and roughly 100 px tall, so the steps below
 * leave a clear gutter on both axes at every zoom the demo uses.
 */

const X_STEP = 300;
const Y_STEP = 140;

/**
 * Longest-path depth per node, computed by bounded relaxation rather than a
 * topological sort.
 *
 * A generated graph is not reliably acyclic: a legal loop closes a cycle through a
 * loop node (CONTRACT.md → "Graph validation"), and an *illegal* cycle is something
 * this function must survive long enough for `validateGraph` to report properly.
 * Recursion would either need a path guard or blow the stack; relaxing every edge at
 * most `n` times cannot loop forever, and a cycle simply saturates at the node
 * count. 100 nodes × 200 edges is 20 000 comparisons — nothing.
 */
function depths(nodes: GeneratedNode[], edges: GeneratedEdge[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const node of nodes) depth.set(node.id, 0);

  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;

    for (const edge of edges) {
      const from = depth.get(edge.source);
      const to = depth.get(edge.target);
      // An edge naming a node that does not exist is a `dangling_edge` for
      // validateGraph to report. Layout skips it rather than inventing a node.
      if (from === undefined || to === undefined) continue;

      const candidate = Math.min(from + 1, nodes.length - 1);
      if (candidate > to) {
        depth.set(edge.target, candidate);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return depth;
}

/**
 * Positions for every node, keyed by id. Column order within a layer follows the
 * model's own node order, so a regeneration of the same graph lays out identically
 * and the result is diffable.
 */
export function layout(nodes: GeneratedNode[], edges: GeneratedEdge[]): Map<string, Position> {
  const depth = depths(nodes, edges);

  const columns = new Map<number, GeneratedNode[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    const members = columns.get(column);
    if (members) members.push(node);
    else columns.set(column, [node]);
  }

  const positions = new Map<string, Position>();
  for (const [column, members] of columns) {
    // Centre the column on y = 0 so a fan-out reads as a fan-out rather than as a
    // list hanging off the bottom of one node.
    const offset = ((members.length - 1) * Y_STEP) / 2;
    members.forEach((node, index) => {
      positions.set(node.id, {
        x: column * X_STEP,
        y: index * Y_STEP - offset,
      });
    });
  }

  return positions;
}
