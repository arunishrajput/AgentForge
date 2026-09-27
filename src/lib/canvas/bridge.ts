import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import type { NodePolicy } from "@/lib/engine/policy";
import {
  GRAPH_VERSION,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from "@/lib/workflow/graph";

/**
 * The canvas ↔ stored-graph mapping — CONTRACT.md → "Workflow / node / edge JSON".
 *
 * This module is the whole reason a workflow survives a reload. It is kept pure
 * and free of React so the round-trip can be tested on Node with no DOM: a graph
 * mapped to the canvas and back must be *deeply equal* to what was stored,
 * positions included. `bridge.test.ts` asserts exactly that.
 *
 * Two rules this file exists to enforce:
 *
 *  - **`data` carries persisted fields only.** Run status and the node's registry
 *    definition reach the node component through context instead, so `fromFlow`
 *    is a straight inverse of `toFlow` with nothing to strip. Anything React Flow
 *    hangs on a node (`selected`, `measured`, `dragging`) is dropped here.
 *  - **`sourceHandle` is normalised to `null`.** React Flow uses `undefined` for
 *    "the default output"; the stored graph and the engine use `null`. Letting
 *    `undefined` through would write an edge the engine cannot follow.
 */

/** The single React Flow node type. The *registry* type lives in `data.nodeType`. */
export const CANVAS_NODE_TYPE = "workflow";

export interface CanvasNodeData extends Record<string, unknown> {
  /** The registry type, e.g. `core.set`. Not React Flow's `type`, which is always CANVAS_NODE_TYPE. */
  nodeType: string;
  label?: string;
  config: Record<string, unknown>;
  /**
   * Retry and timeout (Phase 17). Persisted, so it belongs here rather than in context —
   * and it follows `label`'s rule exactly: **absent stays absent.** A node that has never
   * been given a policy must round-trip without gaining a key, or every existing workflow
   * would come back from the canvas structurally different from what was stored and show
   * as unsaved the moment it loaded.
   */
  policy?: NodePolicy;
}

export type CanvasNode = FlowNode<CanvasNodeData, typeof CANVAS_NODE_TYPE>;
export type CanvasEdge = FlowEdge;

export function toFlowNode(node: WorkflowNode): CanvasNode {
  return {
    id: node.id,
    type: CANVAS_NODE_TYPE,
    position: { x: node.position.x, y: node.position.y },
    data: {
      nodeType: node.type,
      ...(node.label === undefined ? {} : { label: node.label }),
      config: node.config ?? {},
      ...(node.policy === undefined ? {} : { policy: node.policy }),
    },
  };
}

export function toFlowEdge(edge: WorkflowEdge): CanvasEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
  };
}

export function toFlow(graph: WorkflowGraph): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    nodes: graph.nodes.map(toFlowNode),
    edges: graph.edges.map(toFlowEdge),
  };
}

/**
 * Canvas state back to a storable graph.
 *
 * `label` and `policy` are omitted rather than written as `undefined`: the stored
 * graph is compared structurally after a Postgres `jsonb` round trip, and an explicit
 * `undefined` disappears through JSON while an absent key stays absent.
 */
export function fromFlow(nodes: CanvasNode[], edges: CanvasEdge[]): WorkflowGraph {
  return {
    version: GRAPH_VERSION,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      ...(node.data.label === undefined ? {} : { label: node.data.label }),
      position: { x: node.position.x, y: node.position.y },
      config: node.data.config ?? {},
      ...(node.data.policy === undefined ? {} : { policy: node.data.policy }),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
  };
}

/**
 * Readable, stable node ids. The id is persisted in every run step and every SSE
 * event, and Phase 7 asks a model to produce graphs — `set_2` is far easier to
 * reason about in a prompt, a log and a diff than a uuid.
 */
export function nextNodeId(taken: Iterable<string>, nodeType: string): string {
  const used = new Set(taken);
  const base =
    (nodeType.split(".").pop() ?? nodeType).replace(/[^a-zA-Z0-9_]/g, "_") || "node";

  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Edge ids only have to be unique and short; nothing reads meaning from them. */
export function nextEdgeId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const candidate = `e${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Whether the canvas has unsaved work.
 *
 * Re-exported rather than defined here: the comparison is a property of the graph
 * shape, so it lives in `lib/workflow/graph.ts` beside the schema it compares, and
 * `lib/workflow/versions.ts` asks the same function the same question on the server.
 * Two copies would eventually disagree, and the failure would be silent in both
 * directions — a canvas that never looks saved, or a history that drops an edit.
 */
export { graphsEqual } from "@/lib/workflow/graph";
