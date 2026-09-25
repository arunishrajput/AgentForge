import { z } from "zod";

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

/** Bumped only if a stored graph needs migrating. Readers must reject what they do not know. */
export const GRAPH_VERSION = 1;

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
 */
export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(128),
  label: z.string().max(200).optional(),
  position: positionSchema,
  config: z.record(z.string(), z.unknown()).default({}),
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

export const workflowGraphSchema = z.object({
  version: z.literal(GRAPH_VERSION),
  nodes: z.array(workflowNodeSchema).max(100),
  edges: z.array(workflowEdgeSchema).max(200),
});

export type Position = z.infer<typeof positionSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
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
