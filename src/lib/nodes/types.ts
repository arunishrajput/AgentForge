import type { z } from "zod";

import type { WorkspaceScope } from "@/lib/workspace/scope";

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
  /**
   * The workspace this run belongs to, and who triggered it — Phase 19A.
   *
   * It replaced a bare `ownerId`, and it is the only thing a node uses to reach a
   * credential. That is the whole of a node's authority: it can read the credentials of
   * the workspace whose workflow is running, and nothing else. There is no ambient
   * access to any other workspace's, and nothing here can be widened by a node's own
   * config, which is what keeps an agent's tool-calling inside the tenant it started in.
   */
  scope: WorkspaceScope;
  nodeId: string;
  /**
   * This node's registry type — **Phase 21**, and the engine already had it.
   *
   * Added so a node attributing a credential use does not have to repeat its own `type`
   * string inside its own definition, where a self-reference would be a temporal dead zone
   * and a copied literal would be the thing that drifts when a type is renamed.
   */
  nodeType: string;
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
  /**
   * **Phase 26 — ask the run to pause until a time, rather than holding a container.**
   *
   * Only `core.delay` returns this. `output` is already final (a delay passes its input
   * through), so the engine records it now, leaves the step `running`, and stops; the run
   * is suspended as `waiting` and a Cloud Tasks delivery resumes it at `until`. The step
   * finishes when the run wakes, so its duration is the wait — which is what it was.
   *
   * The engine refuses it where nothing could resume the run (no queue configured), and
   * bounds `until` itself rather than trusting the node (`MAX_WAIT_MS`).
   */
  wait?: { until: string };
}

/**
 * Long-form documentation for **a person**, shown in the inspector — Phase 23A.
 *
 * Deliberately not `description`. That field is read verbatim by the model and is
 * tuned for it: terse, imperative, about *when to call this*. A user opening the
 * panel wants different sentences — what the node expects to be handed, what it
 * gives back, and a worked example they can copy. Writing one string for both
 * audiences produced a description that served neither, which is why this is a
 * second field rather than a longer first one.
 *
 * Optional, and its absence is not a defect: the inspector falls back to
 * `description` plus `outputShape`, which is what every node had before this
 * existed.
 */
export interface NodeDocs {
  /** What it does and when to reach for it, for a human. Two or three sentences. */
  summary: string;
  /**
   * What the node reads as its input when its config does not supply one. Say
   * "an array" or "the object from the previous node"; say nothing if it ignores
   * its input entirely.
   */
  accepts?: string;
  /** Worked examples. `body` is a short config sketch or a `{{ }}` reference. */
  examples?: { title: string; body: string }[];
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
  /** Per-node documentation for the inspector. See `NodeDocs`. */
  docs?: NodeDocs;
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
