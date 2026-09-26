import { z } from "zod";

/**
 * What a model is allowed to emit — CONTRACT.md → "Generation request/response".
 *
 * This is deliberately *not* `workflowGraphSchema`. A model is asked for the two
 * things only it can know — which nodes, and how they connect — and for nothing
 * that the system can derive better than it can:
 *
 *  - **No positions.** Positions are contract (CONTRACT.md → "Positions are
 *    contract"), and a language model cannot lay out a graph: asking for x/y gets
 *    overlapping nodes, which reads as broken on stage. `layout()` computes them
 *    from the edges, which is where that information actually lives.
 *  - **No edge ids.** They must be unique and nothing but the graph reads them, so
 *    minting `e1…eN` is strictly more reliable than asking and then having to
 *    de-duplicate what comes back.
 *  - **No `version`.** `GRAPH_VERSION` is ours to set, and a model that guessed it
 *    wrong would produce a graph the reader must reject.
 *
 * Every field the model *does* own is bounded here, so oversized output fails
 * parsing rather than failing a Postgres insert. The bounds mirror
 * `workflowNodeSchema` so anything that passes here can still pass the real graph
 * schema afterwards.
 */

export const generatedNodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(128),
  label: z.string().max(200).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

/**
 * `sourceHandle` names which output the edge leaves from. It is `nullish` for the
 * same reason the graph schema allows it: a single-output node has no handle name,
 * and a model that writes `null` and a model that omits the key mean the same thing.
 */
export const generatedEdgeSchema = z.object({
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  sourceHandle: z.string().max(64).nullish(),
});

export const generatedWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  nodes: z.array(generatedNodeSchema).min(1).max(100),
  edges: z.array(generatedEdgeSchema).max(200),
  /**
   * Parts of the request no registered node can do.
   *
   * Without this the model's only honest option is to build something inert and say
   * nothing: asked to "SSH into production and delete the database" it emitted a
   * valid `trigger → assert → log` — safe, because the registry is the entire
   * vocabulary and there is no node that could express either verb, but silently
   * wrong from the user's point of view. Measured, not hypothesised.
   *
   * It is also the honest answer to a request that is merely *early*: "post it to
   * Discord" has no node until Phase 9, and the user should be told that rather than
   * left to wonder which node does it.
   */
  unsupported: z.array(z.string().min(1).max(300)).max(10).default([]),
});

export type GeneratedNode = z.infer<typeof generatedNodeSchema>;
export type GeneratedEdge = z.infer<typeof generatedEdgeSchema>;
export type GeneratedWorkflow = z.infer<typeof generatedWorkflowSchema>;

/**
 * The request a client sends. `name` overrides whatever the model titles it.
 *
 * `.trim()` comes **before** `.min(1)` deliberately, and the order is load-bearing:
 * `min(1).trim()` accepts "   " because the length check runs on the untrimmed string,
 * and a whitespace-only prompt then reaches the provider and spends a real call on
 * nothing. Found by the deployed verification, not by reading the schema.
 */
export const generateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  name: z.string().trim().min(1).max(200).optional(),
});

export type GenerateWorkflowRequest = z.infer<typeof generateRequestSchema>;
