import { nextEdgeId } from "@/lib/canvas/bridge";
import type { LanguageModel } from "@/lib/ai/types";
import { describeNodes, type NodeSummary } from "@/lib/nodes";
import { CLEAR_STEP, overlaps } from "@/lib/workflow/diff";
import type { Position, WorkflowEdge, WorkflowGraph, WorkflowNode } from "@/lib/workflow/graph";

import {
  chooseCatalogue,
  converse,
  toleratedIn,
  viableAgentConfig,
  type GenerationResult,
} from "./generate";
import { layout } from "./layout";
import { editPrompt, systemPrompt, type EditSubject } from "./prompt";
import type { GeneratedWorkflow } from "./schema";
import { withTypes, type CatalogueOption } from "./select";

/**
 * **The copilot's edit — `BUILD_PLAN.md` Phase 35.** "Also post the urgent ones to Slack" becomes a
 * *proposed* graph: the workflow on the canvas plus the instruction go to the model, which answers
 * with the whole workflow after the change, and that answer is held to everything a generated one
 * is held to — the same prompt rules, the same validation, the same reference check, the same one
 * retry (`converse` in `generate.ts`). Nothing here writes anything: a proposal reaches the canvas
 * as a diff, and only a person pressing Accept puts it there.
 *
 * Two things are new, and both are about the graph that already exists:
 *
 *  - **What the model owns, and what it does not** (D163). It owns which nodes, their type, label
 *    and config, and the connections — exactly what it owns when generating. The system carries
 *    everything else across **by id**: an existing node keeps its position, and — if its type did
 *    not change — its retry policy, its off switch and its pinned output; the sticky notes are
 *    untouched; a connection that survives keeps its edge id. Only a node the model *added* is
 *    placed, by `layout()`, beside whatever it connects to. That is what makes the diff read as the
 *    change asked for and not as remove-everything-add-everything (task 5)
 *  - **What a proposal is not blamed for** (D162). A problem the canvas already had — a node from
 *    the palette not yet configured — is carried, not counted: the proposal may not *add* one
 */

export interface EditWorkflowOptions {
  model: LanguageModel;
  modelId: string;
  /** The change, in the person's words. */
  instruction: string;
  /** The workflow as it is on the canvas — saved or not. */
  subject: EditSubject;
  /**
   * Earlier instructions in this conversation that `subject.graph` already includes — how
   * *refine* reads "no, to #alerts" (`editPrompt`).
   */
  earlier?: readonly string[];
  nodes?: NodeSummary[];
  catalogue?: CatalogueOption;
  signal?: AbortSignal;
}

/** One column of `layout()` — a new node with nothing placed beside it starts a column past the rest. */
const COLUMN = 300;

/**
 * Positions for the nodes the model added, among nodes that stay exactly where they are.
 *
 * `layout()` lays the proposed graph out from scratch, which says where a new node sits *relative
 * to its neighbours*: one column right of what feeds it, beside a sibling. So a new node is put at
 * that same offset from a neighbour **as the neighbour actually is on the canvas** — after the node
 * that feeds it, or before the one it feeds — and then moved down until it is clear of every card
 * already there, the rule `diffGraph` uses for a ghost. Nodes are placed neighbour-first, so a chain
 * of three new nodes hangs off the one that already existed. A new node connected to nothing that
 * exists starts a column right of the rightmost card.
 */
export function placeAdded(current: WorkflowGraph, generated: GeneratedWorkflow): Map<string, Position> {
  const proposed = new Set(generated.nodes.map((node) => node.id));
  const known = new Map<string, Position>(
    current.nodes.filter((node) => proposed.has(node.id)).map((node) => [node.id, node.position]),
  );
  const taken = [...known.values()];
  const ideal = layout(generated.nodes, generated.edges);
  const placed = new Map<string, Position>();

  const put = (id: string, wanted: Position) => {
    let position = wanted;
    for (let attempt = 0; attempt < 100 && taken.some((other) => overlaps(other, position)); attempt += 1) {
      position = { x: position.x, y: position.y + CLEAR_STEP };
    }
    taken.push(position);
    known.set(id, position);
    placed.set(id, position);
  };

  /** A neighbour that already has a position: what feeds this node first, then what it feeds. */
  const anchorOf = (id: string): string | undefined =>
    generated.edges.find((edge) => edge.target === id && known.has(edge.source))?.source ??
    generated.edges.find((edge) => edge.source === id && known.has(edge.target))?.target;

  let pending = generated.nodes.map((node) => node.id).filter((id) => !current.nodes.some((node) => node.id === id));
  while (pending.length > 0) {
    const waiting: string[] = [];
    for (const id of pending) {
      const anchor = anchorOf(id);
      const at = anchor === undefined ? undefined : known.get(anchor);
      if (anchor === undefined || at === undefined) {
        waiting.push(id);
        continue;
      }
      const from = ideal.get(anchor) ?? { x: 0, y: 0 };
      const to = ideal.get(id) ?? { x: 0, y: 0 };
      put(id, { x: at.x + (to.x - from.x), y: at.y + (to.y - from.y) });
    }
    if (waiting.length === pending.length) {
      // Nothing left touches a placed node: an island of new nodes. Its first node starts a new
      // column; the rest of it then hangs off that one on the next pass.
      const [first, ...rest] = waiting;
      const right = taken.reduce((max, position) => Math.max(max, position.x), Number.NEGATIVE_INFINITY);
      put(first, { x: Number.isFinite(right) ? right + COLUMN : 0, y: ideal.get(first)?.y ?? 0 });
      pending = rest;
    } else {
      pending = waiting;
    }
  }
  return placed;
}

/**
 * The model's answer → the proposed graph, with everything the model does not own carried over
 * from `current` by id (D163). The counterpart of `assembleGraph` for an edit.
 */
export function assembleEdit(current: WorkflowGraph, generated: GeneratedWorkflow): WorkflowGraph {
  const before = new Map(current.nodes.map((node) => [node.id, node]));
  const placed = placeAdded(current, generated);

  const nodes = generated.nodes.map((node): WorkflowNode => {
    const previous = before.get(node.id);
    const same = previous !== undefined && previous.type === node.type;
    // An omitted label is the model forgetting to copy it, not a request to remove it: removing a
    // name is not something anybody asks a copilot for, and losing one silently is a diff the
    // person did not ask for. An empty string still clears it.
    const label = node.label ?? previous?.label;
    // The agent-budget guard (`viableAgentConfig`) is for what the *model* chose: a
    // node it added, or a budget it changed. A budget the person set and the model copied is theirs.
    const config =
      same && previous.config?.maxIterations === node.config.maxIterations ? node.config : viableAgentConfig(node);
    return {
      id: node.id,
      type: node.type,
      ...(label === undefined ? {} : { label }),
      position: previous?.position ?? placed.get(node.id) ?? { x: 0, y: 0 },
      config,
      // A node whose type changed is a different node under the same id: its policy may not fit
      // its new kind and its pin is the old node's output, so neither is carried.
      ...(same && previous.policy !== undefined ? { policy: previous.policy } : {}),
      ...(same && previous.disabled ? { disabled: true as const } : {}),
      ...(same && previous.pinned !== undefined ? { pinned: previous.pinned } : {}),
    };
  });

  // A connection that survives keeps its id — the diff matches edges by what they connect, but the
  // canvas keeps its own state for an edge by id (`restoreEdges`). New ones take the lowest free id.
  const key = (edge: { source: string; target: string; sourceHandle?: string | null }) =>
    JSON.stringify([edge.source, edge.sourceHandle ?? null, edge.target]);
  const existing = new Map<string, string[]>();
  for (const edge of current.edges) existing.set(key(edge), [...(existing.get(key(edge)) ?? []), edge.id]);

  const kept = generated.edges.map((edge) => existing.get(key(edge))?.shift() ?? null);
  const used = new Set(kept.filter((id): id is string => id !== null));
  const edges = generated.edges.map((edge, index): WorkflowEdge => {
    let id = kept[index];
    if (id === null) {
      id = nextEdgeId(used);
      used.add(id);
    }
    return { id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null };
  });

  return {
    version: current.version,
    nodes,
    edges,
    ...(current.notes === undefined ? {} : { notes: current.notes }),
  };
}

/**
 * Propose an edit. Returns a `GenerationResult` — the same shape generation returns, scored by the
 * same eval scorer — whose graph is the proposal and whose `name` is the subject's own, unchanged.
 * A provider failure propagates, as it does from `generateWorkflow`.
 */
export async function editWorkflow(options: EditWorkflowOptions): Promise<GenerationResult> {
  const nodes = options.nodes ?? describeNodes();
  const { graph } = options.subject;
  const chosen = await chooseCatalogue(options, options.instruction, nodes);
  // A replayed recording is held to exactly the selection it was made with.
  const selection =
    chosen.strategy === "fixed" ? chosen : withTypes(chosen, graph.nodes.map((node) => node.type), nodes);

  return converse({
    model: options.model,
    modelId: options.modelId,
    nodes,
    selection,
    system: systemPrompt(nodes, selection.types, "edit"),
    request: editPrompt(options.subject, options.instruction, options.earlier),
    assemble: (generated) => assembleEdit(graph, generated),
    tolerated: toleratedIn(graph, nodes),
    name: options.subject.name,
    signal: options.signal,
  });
}
