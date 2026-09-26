import type { z } from "zod";

/**
 * The node definition interface — CONTRACT.md → "Node definition interface".
 *
 * One definition serves three consumers (ARCHITECTURE.md → "The node registry is
 * the spine"):
 *
 *   engine dispatch   → `kind`, `configSchema`, `execute`
 *   canvas palette    → `label`, `category`, `outputs`, `configSchema`
 *   agent tool set    → `description`, `configSchema`, `agentCallable`
 *
 * Because the agent reads `description` verbatim to decide what to call, the
 * description is contract, not decoration. Write it for a model, not for a
 * tooltip.
 */

/** Drives engine behaviour. A `trigger` starts a run; nothing may edge into one. */
export type NodeKind = "trigger" | "action" | "branch" | "loop";

/** Palette grouping only. Has no runtime meaning. */
export type NodeCategory = "trigger" | "logic" | "transform" | "integration" | "agent";

/** A named output. `key` is the edge's `sourceHandle`; `null` is the default output. */
export interface NodeOutput {
  key: string | null;
  label: string;
}

export type LogLevel = "info" | "warn" | "error";

export interface StepLog {
  at: string;
  level: LogLevel;
  message: string;
}

/**
 * What a node's `execute` is handed. Everything it may touch is in here — there is
 * no ambient access to the database, the filesystem, or the network beyond what a
 * node's own implementation imports.
 */
export interface NodeContext {
  runId: string;
  workflowId: string;
  ownerId: string;
  nodeId: string;
  /**
   * How many times this node has already *completed* in this run. 0 on first
   * execution. This is what makes a loop node a plain node: it reads its own
   * iteration count instead of the engine holding loop state.
   */
  iteration: number;
  /** Appended to the step record, and streamed to the client from Phase 5. */
  log: (message: string, level?: LogLevel) => void;
  /** Aborted when the run is cancelled or hits its deadline. */
  signal: AbortSignal;
}

export interface NodeInvocation<Config> {
  config: Config;
  /** Output of the upstream node that reached this one; the trigger payload at the start. */
  input: unknown;
  context: NodeContext;
}

/**
 * `branch` names the output the run leaves from — it must be one of the
 * definition's `outputs` keys. Omitting it means the default output.
 */
export interface NodeOutcome {
  output: unknown;
  branch?: string | null;
}

export interface NodeDefinition<Config = Record<string, unknown>> {
  /** Stable identifier, namespaced. Persisted in every graph — renaming one breaks saved workflows. */
  type: string;
  label: string;
  /** Read verbatim by the agent. Say what it does and when to use it. */
  description: string;
  kind: NodeKind;
  category: NodeCategory;
  outputs: NodeOutput[];
  /**
   * The shape of `output`, in one line, for whoever has to write a `{{ }}` reference
   * to it. Optional: a node that passes its input straight through has nothing to say.
   *
   * Added in Phase 7 because the generator needs it and nothing else supplied it. A
   * model asked to route on an LLM node's answer wrote `{{steps.x.output}}` — the
   * whole object — and the branch compared "[object Object]" and took the wrong path.
   * The graph was valid and ran; it just did the wrong thing, which is the worst kind
   * of generation bug because nothing reports it. Documented here rather than in the
   * prompt so a node added later describes itself, the way `description` already does.
   */
  outputShape?: string;
  configSchema: z.ZodType<Config>;
  /**
   * Whether the agent may call this node as a tool. Defaults to false: widening
   * the agent's reach has to be a deliberate act per node, never a side effect of
   * adding one.
   */
  agentCallable?: boolean;
  execute: (invocation: NodeInvocation<Config>) => Promise<NodeOutcome>;
}

/**
 * What the registry actually stores: the same definition with its config type
 * erased to `unknown`. `defineNode` performs the one cast, so every consumer
 * downstream stays honest and no `any` leaks into the engine.
 */
export type RegisteredNode = NodeDefinition<unknown>;

export function defineNode<Config>(definition: NodeDefinition<Config>): RegisteredNode {
  return definition as RegisteredNode;
}

/**
 * Thrown by a node to fail its step with a clean message. Anything else thrown is
 * still recorded, but this is the way to say "this failed for a reason the user
 * should read" rather than leaking an internal stack.
 */
export class NodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeError";
  }
}
