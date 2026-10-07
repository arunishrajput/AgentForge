import {
  valuesEqual,
  type Position,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNote,
} from "./graph";

/**
 * What changed between two versions of a graph.
 *
 * Pure, with no database and no React, because it is read three ways and each one
 * would otherwise grow its own copy: the history list prints a one-line summary per
 * version, the compare endpoint returns the whole thing, and the canvas paints it.
 *
 * **Nodes are matched by `id`, edges by what they connect.** That asymmetry is
 * deliberate and it is the only interesting decision in this file.
 *
 * A node id is the node's identity everywhere else in the system — every run step,
 * every SSE event and every `{{steps.x}}` reference names it — and `nextNodeId` mints
 * readable, stable ones (`set_2`). So matching on it is matching on the thing the rest
 * of the product already treats as the node. The one wrinkle is honest rather than
 * hidden: delete `set` and add a new `set`, and this reports *changed*, not
 * *removed + added* — which is also what a run history that still says `set` means.
 *
 * An edge id is **not** stable. `nextEdgeId` returns the lowest free `eN`, so deleting
 * `e1` and drawing an unrelated connection re-mints `e1`, and an id-matched diff would
 * call two completely different edges "unchanged". An edge carries no configuration —
 * it is entirely *what it connects* — so its triple is both its identity and its whole
 * content.
 */

export type NodeChange = "added" | "removed" | "changed" | "moved" | "unchanged";
export type EdgeChange = "added" | "removed" | "unchanged";

/**
 * The parts of a node whose change is a change of substance, not of layout. `disabled` is
 * Phase 30's: switching a node off changes what a run does, so it is never a mere move.
 */
export type NodeField = "type" | "label" | "config" | "policy" | "disabled";

/**
 * A sticky note's parts (Phase 30). Its size is here rather than with its position: a note's
 * size decides how much of its text a reader sees, which makes it the note's content in a way
 * a node's position never is.
 */
export type NoteField = "text" | "tone" | "size";

export interface NodeDiff {
  id: string;
  change: NodeChange;
  /**
   * The node as it is in the version compared **to** — or, for a removal, as it was in
   * the base, since that is the only place it exists. This is what the canvas draws.
   */
  node: WorkflowNode;
  /** The node as it was, for `changed` and `moved`. Absent otherwise. */
  before?: WorkflowNode;
  /** Which fields differ. Non-empty exactly when `change` is `changed`. */
  fields: NodeField[];
}

/** A note in a diff — `NodeDiff`'s shape, matched by id the same way. */
export interface NoteDiff {
  id: string;
  change: NodeChange;
  note: WorkflowNote;
  before?: WorkflowNote;
  fields: NoteField[];
}

export interface EdgeDiff {
  /** The edge's id in whichever version it came from. Not matched on — see above. */
  id: string;
  change: EdgeChange;
  source: string;
  target: string;
  sourceHandle: string | null;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  moved: number;
  unchanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  /** Phase 30: notes that are anything but `unchanged` — added, removed, edited or moved. */
  notes: number;
  /** False only when the two graphs are structurally identical, positions and notes included. */
  any: boolean;
}

export interface GraphDiff {
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  /** Phase 30. Empty when neither graph has a note. */
  notes: NoteDiff[];
  summary: DiffSummary;
}

/**
 * An edge is what it connects, as a key.
 *
 * `JSON.stringify` of the triple rather than joining on a separator character: a
 * separator has to be one no id can contain, and every candidate is either a character
 * somebody will eventually put in an id or a control character that is invisible in
 * the source file. JSON quoting is unambiguous by construction, and nothing here is
 * hot enough for the difference to matter.
 */
function edgeKey(edge: WorkflowEdge): string {
  return JSON.stringify([edge.source, edge.sourceHandle ?? null, edge.target]);
}

function positionsEqual(a: WorkflowNode, b: WorkflowNode): boolean {
  return a.position.x === b.position.x && a.position.y === b.position.y;
}

/** The fields whose change means the node *does* something different. */
function changedFields(before: WorkflowNode, after: WorkflowNode): NodeField[] {
  const fields: NodeField[] = [];
  if (before.type !== after.type) fields.push("type");
  // `?? ""` rather than a direct comparison: an empty label and an absent one are the
  // same node to a reader, and reporting that as a change would make a graph edited
  // before labels were optional look different from one that never had them.
  if ((before.label ?? "") !== (after.label ?? "")) fields.push("label");
  if (!valuesEqual(before.config ?? {}, after.config ?? {})) fields.push("config");
  if (!valuesEqual(before.policy, after.policy)) fields.push("policy");
  if (Boolean(before.disabled) !== Boolean(after.disabled)) fields.push("disabled");
  return fields;
}

function noteFields(before: WorkflowNote, after: WorkflowNote): NoteField[] {
  const fields: NoteField[] = [];
  if (before.text !== after.text) fields.push("text");
  if (before.tone !== after.tone) fields.push("tone");
  if (!valuesEqual(before.size, after.size)) fields.push("size");
  return fields;
}

/** Notes, matched by id exactly as nodes are, with the same rule that substance outranks a move. */
function diffNotes(base: readonly WorkflowNote[], target: readonly WorkflowNote[]): NoteDiff[] {
  const before = new Map(base.map((note) => [note.id, note]));
  const after = new Set(target.map((note) => note.id));

  const notes: NoteDiff[] = target.map((note) => {
    const previous = before.get(note.id);
    if (!previous) return { id: note.id, change: "added", note, fields: [] };
    const fields = noteFields(previous, note);
    if (fields.length > 0) return { id: note.id, change: "changed", note, before: previous, fields };
    const moved = previous.position.x !== note.position.x || previous.position.y !== note.position.y;
    return { id: note.id, change: moved ? "moved" : "unchanged", note, before: previous, fields: [] };
  });

  for (const note of base) {
    if (!after.has(note.id)) notes.push({ id: note.id, change: "removed", note, fields: [] });
  }
  return notes;
}

/**
 * `base` to `target`. Read it as "what would have to happen to base to make it target".
 *
 * Node order follows `target`, so the canvas draws a diff in the shape of the newer
 * graph, with removed nodes appended in their original order — they have nowhere else
 * to go, and putting them last keeps the surviving graph's reading order intact.
 */
export function diffGraphs(base: WorkflowGraph, target: WorkflowGraph): GraphDiff {
  const before = new Map(base.nodes.map((node) => [node.id, node]));
  const after = new Map(target.nodes.map((node) => [node.id, node]));

  const nodes: NodeDiff[] = target.nodes.map((node) => {
    const previous = before.get(node.id);
    if (!previous) return { id: node.id, change: "added", node, fields: [] };

    const fields = changedFields(previous, node);
    if (fields.length > 0) {
      // Substance outranks position. A node that was reconfigured *and* dragged is
      // reported as changed: "moved" would be true and useless.
      return { id: node.id, change: "changed", node, before: previous, fields };
    }
    if (!positionsEqual(previous, node)) {
      return { id: node.id, change: "moved", node, before: previous, fields: [] };
    }
    return { id: node.id, change: "unchanged", node, before: previous, fields: [] };
  });

  for (const node of base.nodes) {
    if (!after.has(node.id)) nodes.push({ id: node.id, change: "removed", node, fields: [] });
  }

  const beforeEdges = new Set(base.edges.map(edgeKey));
  const afterEdges = new Set(target.edges.map(edgeKey));

  const edges: EdgeDiff[] = target.edges.map((edge) => ({
    id: edge.id,
    change: beforeEdges.has(edgeKey(edge)) ? ("unchanged" as const) : ("added" as const),
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
  }));

  for (const edge of base.edges) {
    if (!afterEdges.has(edgeKey(edge))) {
      edges.push({
        id: edge.id,
        change: "removed",
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
      });
    }
  }

  const notes = diffNotes(base.notes ?? [], target.notes ?? []);

  const count = (change: NodeChange) => nodes.filter((node) => node.change === change).length;
  const added = count("added");
  const removed = count("removed");
  const changed = count("changed");
  const moved = count("moved");
  const edgesAdded = edges.filter((edge) => edge.change === "added").length;
  const edgesRemoved = edges.filter((edge) => edge.change === "removed").length;
  const notesChanged = notes.filter((note) => note.change !== "unchanged").length;

  return {
    nodes,
    edges,
    notes,
    summary: {
      added,
      removed,
      changed,
      moved,
      unchanged: count("unchanged"),
      edgesAdded,
      edgesRemoved,
      notes: notesChanged,
      any: added + removed + changed + moved + edgesAdded + edgesRemoved + notesChanged > 0,
    },
  };
}

/**
 * The card's footprint on the canvas. 224px is `NODE_WIDTH` in `workflow-node.tsx`;
 * the height is a deliberate under-estimate of the tallest card, because two cards a
 * little too close read fine and two cards on top of each other do not.
 */
const NODE_WIDTH = 224;
const NODE_HEIGHT = 150;
/** How far a displaced ghost drops per attempt. Card height plus a clear gutter. */
const CLEAR_STEP = 180;

function overlaps(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;
}

/**
 * The union of both graphs, as one renderable graph.
 *
 * A removed node keeps its base position **where that position is still free**, and
 * this is the part that is not obvious until you look at one.
 *
 * Delete the last node of a chain and add a new one, and the canvas puts the new node
 * exactly where the old one was — `addNode` places to the right of the rightmost node,
 * which is the slot that just came free. The union then holds two nodes at identical
 * coordinates, React Flow stacks them, and the diff renders with the *added* node
 * invisible underneath the removed one. Every API check passes; the feature is broken.
 * (Found in a browser, which is the only place it is visible — `CLAUDE.md`.)
 *
 * So the live graph keeps its layout exactly, and a removed node that would land on
 * something drops until it is clear. A ghost moving is honest — it is not in the newer
 * workflow, so it has no position there — and moving a *surviving* node would be a lie
 * about where the workflow actually is.
 */
export function diffGraph(diff: GraphDiff, version: WorkflowGraph["version"]): WorkflowGraph {
  const placed: Position[] = diff.nodes
    .filter((entry) => entry.change !== "removed")
    .map((entry) => entry.node.position);

  const nodes = diff.nodes.map((entry) => {
    if (entry.change !== "removed") return entry.node;

    let position = entry.node.position;
    // Bounded: a graph is capped at 100 nodes, so a ghost cannot need more than that
    // many drops to find air, and the loop can never run away.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!placed.some((taken) => overlaps(taken, position))) break;
      position = { x: position.x, y: position.y + CLEAR_STEP };
    }

    placed.push(position);
    return position === entry.node.position ? entry.node : { ...entry.node, position };
  });

  // Notes may overlap anything, so a removed one is simply drawn where it was. Written only
  // when there are any, so a diff of two note-free versions is the graph shape it always was.
  const notes = diff.notes.map((entry) => entry.note);

  return {
    version,
    nodes,
    ...(notes.length > 0 ? { notes } : {}),
    // An edge id must be unique within the graph React Flow renders, and a removed
    // edge can collide with a surviving one — `e1` deleted and `e1` re-minted is
    // exactly the case the edge matching above exists for. Prefixing the removed ones
    // keeps both drawable.
    edges: diff.edges.map((edge) => ({
      id:
        edge.change === "removed"
          ? `removed:${edge.id}:${edge.source}->${edge.target}`
          : edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
    })),
  };
}

/**
 * The one-line summary a history row prints. Symbols **and** a written form, because
 * `DESIGN.md` → *Never colour alone* applies to glyphs too: the returned tuples carry
 * the word a screen reader gets.
 */
export function summaryParts(summary: DiffSummary): { symbol: string; words: string }[] {
  const parts: { symbol: string; words: string }[] = [];
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  if (summary.added > 0) parts.push({ symbol: `+${summary.added}`, words: `${plural(summary.added, "node")} added` });
  if (summary.removed > 0) parts.push({ symbol: `-${summary.removed}`, words: `${plural(summary.removed, "node")} removed` });
  if (summary.changed > 0) parts.push({ symbol: `~${summary.changed}`, words: `${plural(summary.changed, "node")} changed` });
  if (summary.moved > 0) parts.push({ symbol: `>${summary.moved}`, words: `${plural(summary.moved, "node")} moved` });

  const edges = summary.edgesAdded + summary.edgesRemoved;
  if (edges > 0) parts.push({ symbol: `${edges}e`, words: `${plural(edges, "connection")} rewired` });

  if (summary.notes > 0) {
    parts.push({ symbol: `${summary.notes}n`, words: `${plural(summary.notes, "note")} edited` });
  }

  return parts;
}
