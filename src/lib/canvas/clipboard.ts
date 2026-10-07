import { z } from "zod";

import {
  workflowEdgeSchema,
  workflowNodeSchema,
  type Position,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from "@/lib/workflow/graph";

import { nextEdgeId } from "./bridge";

/**
 * Copy, paste and duplicate on the canvas — `BUILD_PLAN.md` Phase 29, task 2, and
 * `CONTRACT.md` → *The canvas clipboard*.
 *
 * **The clipboard carries a recognisable JSON envelope, as plain text.** Plain text,
 * because that is the one format every browser lets a page write and read without a
 * permission prompt, and the one a second tab — or a second workflow — reads back. An
 * envelope, because the clipboard is shared with everything else on the machine: a
 * paste of somebody's shopping list must be recognised as *not ours* and ignored, and a
 * paste of something that looks like ours must be checked like any other input before a
 * single node reaches the canvas. Nodes and edges inside it are the stored graph's own
 * shapes (`workflowNodeSchema`), parsed with the same schemas the API parses a save
 * with — so a pasted node is held to exactly the rules a saved one is.
 *
 * Nothing here can execute anything: a node's `config` is data, and `{{ }}` is lookup
 * (D17). The worst a hostile clipboard can do is offer a graph, which the author sees,
 * can undo, and must still save and run.
 */

export const CLIPBOARD_FORMAT = "agentforge/nodes";
export const CLIPBOARD_VERSION = 1;

/** Workflow limits (`CONTRACT.md` → *Workflow / node / edge JSON*). */
const MAX_NODES = 100;
const MAX_EDGES = 200;

/** Larger than any legal envelope; anything bigger is not worth parsing. */
const MAX_TEXT = 2_000_000;

/** How far a paste lands from what it copied, and from the paste before it. */
export const PASTE_STEP = 40;

const envelopeSchema = z.object({
  format: z.literal(CLIPBOARD_FORMAT),
  version: z.literal(CLIPBOARD_VERSION),
  nodes: z.array(workflowNodeSchema).min(1).max(MAX_NODES),
  edges: z.array(workflowEdgeSchema).max(MAX_EDGES),
});

export type ClipboardEnvelope = z.infer<typeof envelopeSchema>;

/**
 * The selected nodes, and the edges *between* them — an edge to a node left behind
 * would arrive dangling. `null` when nothing is selected.
 */
export function copySelection(
  graph: WorkflowGraph,
  ids: Iterable<string>,
): ClipboardEnvelope | null {
  const wanted = new Set(ids);
  const nodes = graph.nodes.filter((node) => wanted.has(node.id));
  if (nodes.length === 0) return null;

  const kept = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
  return { format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, nodes, edges };
}

export function serialiseEnvelope(envelope: ClipboardEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

/**
 * Clipboard text back to an envelope, or `null` for anything that is not one. Never
 * throws: the text came from outside the product.
 */
export function parseEnvelope(text: string): ClipboardEnvelope | null {
  if (text.length > MAX_TEXT) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = envelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A rectangle in flow coordinates — the part of the canvas currently on screen. */
export interface FlowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PasteOptions {
  /** Whether a registry type starts a run. Validation allows exactly one (`CONTRACT.md`). */
  isTrigger: (type: string) => boolean;
  /** Whether the registry has this type at all. */
  isKnown: (type: string) => boolean;
  /**
   * The visible canvas. When the copied nodes are not inside it — a paste into another
   * workflow, or after scrolling away — they land in its middle instead of off-screen.
   * Omitted for duplicate, which always lands beside the original.
   */
  viewport?: FlowRect;
}

export type PasteResult =
  | {
      ok: true;
      nodes: WorkflowNode[];
      edges: WorkflowEdge[];
      /** Something was left out, and the author should be told what and why. */
      note: string | null;
    }
  | { ok: false; reason: string };

/**
 * Turn an envelope into nodes and edges ready to add to `graph`.
 *
 * - **New ids.** A node keeps its id when the target graph does not already use it, so
 *   a paste into another workflow keeps `agent` as `agent`; otherwise it takes the next
 *   free suffix (`agent_2`). Edges are re-pointed and get fresh `eN` ids.
 * - **References follow the ids.** A `{{steps.<id>…}}` in a pasted node's config that
 *   names another *pasted* node is rewritten to the new id, so a copied pair still
 *   talks to itself. A reference to a node that was not copied is left alone — a
 *   duplicated email node still reads the agent it read before.
 * - **One trigger.** A workflow runs from exactly one. A trigger the target cannot take
 *   is left out and the rest is pasted, with a note saying so; a clipboard holding
 *   nothing *but* that trigger is refused.
 * - **Positions offset**, so a paste never lands exactly on top of what is already there.
 */
export function planPaste(
  graph: WorkflowGraph,
  envelope: ClipboardEnvelope,
  options: PasteOptions,
): PasteResult {
  const unknown = envelope.nodes.find((node) => !options.isKnown(node.type));
  if (unknown) {
    return {
      ok: false,
      reason: `The clipboard holds a node this product does not have: ${unknown.type}.`,
    };
  }

  let triggerRoom = graph.nodes.some((node) => options.isTrigger(node.type)) ? 0 : 1;
  let droppedTrigger = false;
  const incoming = envelope.nodes.filter((node) => {
    if (!options.isTrigger(node.type)) return true;
    if (triggerRoom > 0) {
      triggerRoom -= 1;
      return true;
    }
    droppedTrigger = true;
    return false;
  });

  if (incoming.length === 0) {
    return {
      ok: false,
      reason: "This workflow already has a trigger, and a workflow runs from exactly one.",
    };
  }

  if (graph.nodes.length + incoming.length > MAX_NODES) {
    return {
      ok: false,
      reason: `That would make ${graph.nodes.length + incoming.length} nodes; a workflow holds at most ${MAX_NODES}.`,
    };
  }

  // New ids, minted against everything already on the canvas and everything minted so far.
  const taken = new Set(graph.nodes.map((node) => node.id));
  const ids = new Map<string, string>();
  for (const node of incoming) {
    const id = freshId(taken, node.id);
    taken.add(id);
    ids.set(node.id, id);
  }

  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  const edges: WorkflowEdge[] = [];
  for (const edge of envelope.edges) {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const id = nextEdgeId(edgeIds);
    edgeIds.add(id);
    edges.push({ id, source, target, sourceHandle: edge.sourceHandle ?? null });
  }

  if (graph.edges.length + edges.length > MAX_EDGES) {
    return {
      ok: false,
      reason: `That would make ${graph.edges.length + edges.length} connections; a workflow holds at most ${MAX_EDGES}.`,
    };
  }

  const shift = placement(
    incoming.map((node) => node.position),
    graph.nodes.map((node) => node.position),
    options.viewport,
  );

  const nodes = incoming.map((node) => ({
    ...node,
    id: ids.get(node.id)!,
    position: {
      x: Math.round(node.position.x + shift.x),
      y: Math.round(node.position.y + shift.y),
    },
    config: remapReferences(node.config, ids) as Record<string, unknown>,
  }));

  return {
    ok: true,
    nodes,
    edges,
    note: droppedTrigger
      ? "The trigger was left out — this workflow already has one, and a workflow runs from exactly one."
      : null,
  };
}

/**
 * The original id if it is free, otherwise the next free `<stem>_<n>`. A trailing `_2`
 * is the stem's own suffix, not part of the name, so a copy of `agent_2` is `agent_3`
 * rather than `agent_2_2`.
 */
export function freshId(taken: ReadonlySet<string>, original: string): string {
  if (!taken.has(original)) return original;
  const stem = original.replace(/_\d+$/, "") || "node";
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The template grammar's own reference pattern (`lib/workflow/template.ts`). */
const REFERENCE = /\{\{(\s*)([\w.[\]$-]+)(\s*)\}\}/g;

/**
 * Rewrite `{{steps.<old>…}}` to `{{steps.<new>…}}` for every id in `ids`, through every
 * string in a config however deeply nested. Lookup paths only — the grammar has no
 * expressions, so there is nothing else a reference could be (D17).
 */
export function remapReferences(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(REFERENCE, (whole, before: string, path: string, after: string) => {
      const match = /^steps\.([^.[\]]+)(.*)$/.exec(path);
      const renamed = match ? ids.get(match[1]) : undefined;
      return renamed === undefined ? whole : `{{${before}steps.${renamed}${match![2]}${after}}}`;
    });
  }
  if (Array.isArray(value)) return value.map((item) => remapReferences(item, ids));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapReferences(item, ids)]),
    );
  }
  return value;
}

/**
 * How far to shift the pasted positions.
 *
 * If the copied nodes are on screen (or there is no screen to speak of — a duplicate),
 * they move one `PASTE_STEP` down and right of the originals. If they are off screen,
 * they are first moved to the middle of it. Either way the step repeats until nothing
 * pasted lands exactly on an existing node, so pasting three times staggers three copies
 * rather than stacking them.
 */
function placement(pasted: Position[], existing: Position[], viewport?: FlowRect): Position {
  const minX = Math.min(...pasted.map((p) => p.x));
  const maxX = Math.max(...pasted.map((p) => p.x));
  const minY = Math.min(...pasted.map((p) => p.y));
  const maxY = Math.max(...pasted.map((p) => p.y));

  const visible =
    viewport === undefined ||
    (maxX >= viewport.x &&
      minX <= viewport.x + viewport.width &&
      maxY >= viewport.y &&
      minY <= viewport.y + viewport.height);

  const base: Position = visible
    ? { x: 0, y: 0 }
    : {
        x: viewport.x + viewport.width / 2 - (minX + maxX) / 2,
        y: viewport.y + viewport.height / 2 - (minY + maxY) / 2,
      };

  const lands = (shift: Position) =>
    pasted.some((p) =>
      existing.some(
        (e) => Math.abs(e.x - (p.x + shift.x)) < 1 && Math.abs(e.y - (p.y + shift.y)) < 1,
      ),
    );

  for (let step = visible ? 1 : 0; step < 50; step += 1) {
    const shift = { x: base.x + step * PASTE_STEP, y: base.y + step * PASTE_STEP };
    if (!lands(shift)) return shift;
  }
  return { x: base.x + 50 * PASTE_STEP, y: base.y + 50 * PASTE_STEP };
}
