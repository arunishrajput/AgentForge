import type { Edge as FlowEdge, EdgeChange, Node as FlowNode, NodeChange } from "@xyflow/react";

import type { NodePolicy } from "@/lib/engine/policy";
import {
  GRAPH_VERSION,
  type NoteTone,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNote,
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
  /** Switched off (Phase 30). `true` or absent, never `false` — `policy`'s rule again. */
  disabled?: true;
  /** A fixed output for test runs (Phase 31). Absent stays absent, for the same reason. */
  pinned?: { output: unknown };
}

export type CanvasNode = FlowNode<CanvasNodeData, typeof CANVAS_NODE_TYPE>;
export type CanvasEdge = FlowEdge;

/**
 * **A sticky note is a second React Flow node type** (Phase 30). It is not a registry node and
 * is never one of `CanvasNode` — the editor holds notes in a list of their own and lays them
 * over the nodes only for React Flow, so the hundred places that read `node.data.nodeType`
 * never meet a note. Its stored `size` is React Flow's `width`/`height`, the attributes the
 * resizer sets — never `measured`, which is what the browser happened to lay out.
 */
export const CANVAS_NOTE_TYPE = "note";

export interface CanvasNoteData extends Record<string, unknown> {
  text: string;
  tone: NoteTone;
}

export type CanvasNote = FlowNode<CanvasNoteData, typeof CANVAS_NOTE_TYPE>;

/** A new note's size, and the size a note is read back at if React Flow ever lost it. */
export const NOTE_DEFAULT_SIZE = { width: 240, height: 140 } as const;

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
      ...(node.disabled ? { disabled: true as const } : {}),
      ...(node.pinned === undefined ? {} : { pinned: node.pinned }),
    },
  };
}

/**
 * `zIndex: -1` puts a note behind the nodes and their edges, which is where an annotation
 * belongs: it explains a corner of the graph without covering it. Selecting one lifts it
 * above everything (React Flow adds 1000 to a selected node), so it can still be edited
 * when a node sits on top of it.
 */
export function toFlowNote(note: WorkflowNote): CanvasNote {
  return {
    id: note.id,
    type: CANVAS_NOTE_TYPE,
    position: { x: note.position.x, y: note.position.y },
    width: note.size.width,
    height: note.size.height,
    zIndex: -1,
    data: { text: note.text, tone: note.tone },
  };
}

export function fromFlowNote(note: CanvasNote): WorkflowNote {
  return {
    id: note.id,
    position: { x: note.position.x, y: note.position.y },
    size: {
      width: note.width ?? NOTE_DEFAULT_SIZE.width,
      height: note.height ?? NOTE_DEFAULT_SIZE.height,
    },
    text: note.data.text,
    tone: note.data.tone,
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

export function toFlow(graph: WorkflowGraph): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  notes: CanvasNote[];
} {
  return {
    nodes: graph.nodes.map(toFlowNode),
    edges: graph.edges.map(toFlowEdge),
    notes: (graph.notes ?? []).map(toFlowNote),
  };
}

/**
 * Canvas state back to a storable graph.
 *
 * `label`, `policy`, `disabled` and `pinned` are omitted rather than written as `undefined`: the
 * stored graph is compared structurally after a Postgres `jsonb` round trip, and an explicit
 * `undefined` disappears through JSON while an absent key stays absent. **`notes` is written
 * only when there is one** (Phase 30), for the same reason: a workflow that never had a note,
 * or whose last note was deleted, is the graph it always was.
 */
export function fromFlow(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  notes: readonly CanvasNote[] = [],
): WorkflowGraph {
  return {
    version: GRAPH_VERSION,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      ...(node.data.label === undefined ? {} : { label: node.data.label }),
      position: { x: node.position.x, y: node.position.y },
      config: node.data.config ?? {},
      ...(node.data.policy === undefined ? {} : { policy: node.data.policy }),
      ...(node.data.disabled ? { disabled: true as const } : {}),
      ...(node.data.pinned === undefined ? {} : { pinned: node.data.pinned }),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
    ...(notes.length > 0 ? { notes: notes.map(fromFlowNote) } : {}),
  };
}

/**
 * A stored graph laid back over the canvas that is already on screen — what Undo and
 * Redo apply (Phase 29).
 *
 * `toFlow` would do, except that it builds every node from nothing: a node that survives
 * the step would lose its selection, and lose `measured`, which React Flow then has to
 * re-measure before an edge can find its handles. So every *persisted* field comes from
 * the graph — that is the step being applied — and everything React Flow keeps on a node
 * of the same id is carried over. A node the graph no longer has is gone; a node only the
 * graph has arrives fresh. `fromFlow` of the result is the graph, exactly.
 *
 * Two functions rather than one so each can be a functional state update of its own list.
 */
export function restoreNodes(nodes: CanvasNode[], graph: WorkflowGraph): CanvasNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return graph.nodes.map((stored) => {
    const fresh = toFlowNode(stored);
    const current = byId.get(stored.id);
    return current ? { ...current, position: fresh.position, data: fresh.data } : fresh;
  });
}

/** `restoreNodes` for notes: the stored fields from the graph, React Flow's own kept. */
export function restoreNotes(notes: CanvasNote[], graph: WorkflowGraph): CanvasNote[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  return (graph.notes ?? []).map((stored) => {
    const fresh = toFlowNote(stored);
    const current = byId.get(stored.id);
    return current
      ? { ...current, position: fresh.position, width: fresh.width, height: fresh.height, data: fresh.data }
      : fresh;
  });
}

export function restoreEdges(edges: CanvasEdge[], graph: WorkflowGraph): CanvasEdge[] {
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  return graph.edges.map((stored) => {
    const fresh = toFlowEdge(stored);
    const current = byId.get(stored.id);
    return current ? { ...current, ...fresh } : fresh;
  });
}

/**
 * The React Flow changes a canvas that cannot be edited still has to apply: selecting,
 * and the measurements React Flow writes back (Phase 29).
 *
 * The editor used to withhold `onNodesChange` from a viewer altogether, so nothing could
 * move. But a controlled React Flow reports a *selection* through that same callback
 * and does nothing with it itself — so a viewer's click selected nothing, and the
 * inspector Phase 20 kept open "because reading a node's configuration is a read" could
 * never be opened by clicking a node. Filtering keeps what the withholding was for: a
 * move, a removal or an addition never reaches the graph.
 */
export function readOnlyChanges<
  C extends NodeChange<CanvasNode | CanvasNote> | EdgeChange<CanvasEdge>,
>(changes: C[]): C[] {
  return changes.filter((change) => change.type === "select" || change.type === "dimensions");
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

/**
 * A note's id — `note_1`, `note_2` — minted against **every** id on the canvas, nodes
 * included, because React Flow draws both in one id space and the graph schema refuses a
 * collision (`workflowGraphSchema`). Callers pass node and note ids together.
 */
export function nextNoteId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const candidate = `note_${n}`;
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
