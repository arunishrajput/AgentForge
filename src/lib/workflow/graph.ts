import { z } from "zod";

import { nodePolicySchema } from "@/lib/engine/policy";

/**
 * The workflow graph — CONTRACT.md → "Workflow / node / edge JSON".
 *
 * The whole graph is stored as one `jsonb` column on the workflow row rather than
 * in node and edge tables. Two reasons, both load-bearing:
 *
 *  - `drizzle-orm/neon-http` has no transactions (ARCHITECTURE.md, D6). A graph
 *    spread over three tables could not be saved atomically; a single-row update
 *    is atomic for free.
 *  - The canvas saves the whole graph at once anyway. There is no query that wants
 *    "all edges across all workflows", so relational storage would buy nothing.
 *
 * Positions are part of the contract. A workflow that reloads with a scrambled
 * layout is a broken round-trip, not a cosmetic bug.
 */

/**
 * Bumped only if a stored graph needs migrating. Readers must reject what they do not know.
 *
 * Phase 30 added `notes` and a node's `disabled` **without** a bump (D134): both are optional
 * and additive, so every graph stored before them is still a valid graph and nothing needs
 * migrating, which is the only thing this number is for.
 */
export const GRAPH_VERSION = 1;

/**
 * **Pinned output — Phase 31 (D138).** A node may carry a fixed output that a *test* run uses
 * in place of executing it, so an author can build the rest of a workflow without calling the
 * same API, model or mailbox every time.
 *
 * Capped, because the graph is snapshotted into every version (50 kept per workflow, Phase
 * 18): a pin is stored up to fifty times over in Neon's 0.5 GB. 32 KB a pin and 128 KB a
 * graph put the worst case at 6.4 MB per workflow, and a typical pin — a webhook body, a
 * model's answer, a page of an API — is a few kilobytes. Measured in UTF-8 bytes of its JSON,
 * which is what Postgres stores, not in characters.
 */
export const PIN_MAX_BYTES = 32 * 1024;
export const PINNED_TOTAL_MAX_BYTES = 128 * 1024;

/** The size of a value as stored: UTF-8 bytes of its JSON. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "null").length;
}

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/**
 * `id` is unique within its workflow and is the key every run step, every canvas
 * selection and every SSE event uses to refer to a node. `type` must name a
 * registry entry; that check needs the registry, so it lives in validateGraph()
 * rather than here.
 *
 * `config` is deliberately unknown at this layer: each node definition owns its
 * own config schema and parses it at execution time.
 *
 * `policy` is retry and timeout (Phase 17, `PRD.md` C4). It is a sibling of `config`
 * rather than part of it because it is a property of *running* a node, not of what
 * the node does — see `lib/engine/policy.ts`. Absent means the default: one attempt,
 * no timeout beyond the run's own deadline. Every graph saved before Phase 17 has no
 * `policy` on any node, which is why it must stay optional rather than gain a
 * default here: `fromFlow(toFlow(graph))` has to stay deeply equal to `graph`, and a
 * schema default would silently add a key the canvas never wrote.
 *
 * `disabled` switches the node off without deleting it — Phase 30, and what a run does with
 * one is `CONTRACT.md` → *Disabled nodes*. **`true` or absent, never `false`**, for the
 * reason `policy` is optional: a node that is on carries no key, so a graph that never used
 * the feature is exactly what it was, and a stored `disabled: false` can never make the dirty
 * check or the version debounce see a difference nobody made.
 *
 * `pinned` is a fixed output for testing — Phase 31, `CONTRACT.md` → *Pinned output*. Absent
 * stays absent, for the same reason.
 */
export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(128),
  label: z.string().max(200).optional(),
  position: positionSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  policy: nodePolicySchema.optional(),
  disabled: z.literal(true).optional(),
  pinned: z
    // `z.json()` refuses what JSON cannot carry; the value is still typed `unknown`, because
    // it arrives from step outputs and editors that hold it as exactly that.
    .object({ output: z.json().transform((value): unknown => value) })
    .refine((pin) => jsonBytes(pin.output) <= PIN_MAX_BYTES, {
      message: `A pinned output can be at most ${PIN_MAX_BYTES / 1024} KB.`,
      path: ["output"],
    })
    .optional(),
});

/**
 * `sourceHandle` is which output the edge leaves from — `"true"`/`"false"` on a
 * branch, `"loop"`/`"done"` on a loop. `null` or absent means the node's single
 * default output. This is what makes conditional routing expressible in the graph
 * instead of hidden inside node config.
 */
export const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  sourceHandle: z.string().max(64).nullish(),
});

/**
 * **Sticky notes — Phase 30.** For people, and nothing else: they are not registry nodes, so
 * the engine never reads them, validation never sees them, no agent can call one and the
 * generator cannot write one (D112, D136).
 *
 * The tone is a fixed set rather than a colour, so a note can only ever be drawn in a fill
 * the contrast gates have already proved in both themes (`lib/canvas/notes.ts`). The text is
 * **plain text**: nothing renders it as HTML or Markdown, so there is no markup it can carry.
 */
export const NOTE_TONES = ["yellow", "pink", "blue", "green", "purple"] as const;
export const NOTE_TEXT_MAX = 2000;
export const NOTE_LIMIT = 50;
export const NOTE_SIZE = { minWidth: 120, maxWidth: 800, minHeight: 60, maxHeight: 800 } as const;

export const workflowNoteSchema = z.object({
  id: z.string().min(1).max(128),
  position: positionSchema,
  size: z.object({
    width: z.number().finite().min(NOTE_SIZE.minWidth).max(NOTE_SIZE.maxWidth),
    height: z.number().finite().min(NOTE_SIZE.minHeight).max(NOTE_SIZE.maxHeight),
  }),
  text: z.string().max(NOTE_TEXT_MAX),
  tone: z.enum(NOTE_TONES),
});

/**
 * `notes` follows `policy`'s rule: **absent stays absent**. The key is written only while
 * there is a note (`fromFlow`), so deleting the last one gives back the graph as it was
 * before the first.
 *
 * Note ids share one space with node ids, because the canvas draws both in one React Flow,
 * where an id names exactly one thing. A collision would put two objects on one id and lose
 * one of them, so it is refused here rather than reported later — unlike a duplicate *node*
 * id, which `validateGraph` reports so that a half-built canvas still saves. Nothing the
 * product mints can collide (`nextNodeId`, `nextNoteId` and the clipboard all mint against
 * both), so this is what keeps an API client to the same rule.
 */
export const workflowGraphSchema = z
  .object({
    version: z.literal(GRAPH_VERSION),
    nodes: z.array(workflowNodeSchema).max(100),
    edges: z.array(workflowEdgeSchema).max(200),
    notes: z.array(workflowNoteSchema).max(NOTE_LIMIT).optional(),
  })
  .superRefine((graph, context) => {
    const pinned = graph.nodes.reduce(
      (total, node) => total + (node.pinned ? jsonBytes(node.pinned.output) : 0),
      0,
    );
    if (pinned > PINNED_TOTAL_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: `This workflow's pinned outputs add up to ${Math.ceil(pinned / 1024)} KB; together they can be at most ${PINNED_TOTAL_MAX_BYTES / 1024} KB.`,
      });
    }

    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const seen = new Set<string>();
    for (const [index, note] of (graph.notes ?? []).entries()) {
      if (nodeIds.has(note.id) || seen.has(note.id)) {
        context.addIssue({
          code: "custom",
          path: ["notes", index, "id"],
          message: `The note id "${note.id}" is already used on this canvas.`,
        });
      }
      seen.add(note.id);
    }
  });

export type Position = z.infer<typeof positionSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowNote = z.infer<typeof workflowNoteSchema>;
export type NoteTone = (typeof NOTE_TONES)[number];
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const emptyGraph = (): WorkflowGraph => ({
  version: GRAPH_VERSION,
  nodes: [],
  edges: [],
});

/** Outgoing edges of a node, in declaration order, filtered to one output handle. */
export function edgesFrom(
  graph: WorkflowGraph,
  nodeId: string,
  handle: string | null,
): WorkflowEdge[] {
  return graph.edges.filter(
    (edge) => edge.source === nodeId && (edge.sourceHandle ?? null) === handle,
  );
}

/**
 * Structural graph comparison — the question "is this the same graph?", asked in two
 * places that must answer it identically.
 *
 * It must not be a string comparison. Postgres `jsonb` normalises object key order,
 * so a graph read back is deeply equal to what was written but not byte-identical
 * (PROGRESS.md, Phase 3). Comparing the raw JSON would mark a freshly loaded workflow
 * as dirty, and — since Phase 18 — would write a new version on every save that
 * changed nothing.
 *
 * It lives here rather than in `lib/canvas/bridge.ts`, where Phase 4 first wrote it,
 * because it is a property of the graph shape and not of the canvas. The canvas asks
 * it to decide whether there is unsaved work; `lib/workflow/versions.ts` asks it to
 * decide whether a save is worth a version. Two copies of this function would
 * eventually disagree, and the failure would be silent in both directions: a canvas
 * that never looks saved, or a history that quietly drops an edit.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]);
  }
  return value;
}

export function graphsEqual(a: WorkflowGraph, b: WorkflowGraph): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** The same question about one node's substance — `diff.ts` asks it per node. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
