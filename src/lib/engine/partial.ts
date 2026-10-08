import type { NodeEffect } from "@/lib/nodes/types";
import type { WorkflowGraph, WorkflowNode } from "@/lib/workflow/graph";

export type { NodeEffect };

/**
 * **Test runs and partial runs — Phase 31, `CONTRACT.md` → *Pinned output* and *Partial runs*.**
 *
 * Pure, and free of the registry: the server plans a run with `getNode` and the canvas plans
 * the same run with the `NodeSummary` map it already holds, so the confirmation a person reads
 * before *test up to here* names exactly the nodes the engine will then execute. Two copies of
 * this arithmetic would eventually disagree, and the disagreement would be a Slack message
 * nobody was warned about.
 */

/**
 * What a test run covers.
 *
 *   workflow  the whole workflow, from its trigger — a manual run of a graph holding pins
 *   node      one node alone, fed from pins and recorded outputs — *test this node*
 *   path      the trigger and every node on a way to the target — *test up to here*
 */
export const TEST_SCOPES = ["workflow", "node", "path"] as const;
export type TestScope = (typeof TEST_SCOPES)[number];

/** `run.test` — null on a run that is not a test. */
export interface RunTest {
  scope: TestScope;
  /** The node a `node` or `path` test was aimed at; null for `workflow`. */
  nodeId: string | null;
}

/** The parts of a registry entry this module reads — `RegisteredNode` and `NodeSummary` both fit. */
export interface NodeFacts {
  kind: string;
  outputs: readonly { key: string | null }[];
  effect?: NodeEffect;
}

/** A node can hold a pin when it has a default output — a branch, a switch or a loop cannot. */
export function canPin(facts: NodeFacts | undefined): boolean {
  return facts?.outputs.some((output) => output.key === null) ?? false;
}

/** The pin a run honours: present, and on a node that can hold one. */
export function honouredPin(
  node: WorkflowNode,
  facts: NodeFacts | undefined,
): { output: unknown } | undefined {
  return node.pinned && !node.disabled && canPin(facts) ? node.pinned : undefined;
}

/** Every node from which `target` can be reached along edges, `target` included. */
export function upstreamOf(graph: WorkflowGraph, target: string): Set<string> {
  const into = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = into.get(edge.target) ?? [];
    sources.push(edge.source);
    into.set(edge.target, sources);
  }

  const seen = new Set<string>([target]);
  const queue = [target];
  while (queue.length > 0) {
    for (const source of into.get(queue.shift()!) ?? []) {
      if (seen.has(source)) continue;
      seen.add(source);
      queue.push(source);
    }
  }
  return seen;
}

/** The node a `node` or `path` test is aimed at — the one that always executes. */
export function aimedAt(test: RunTest | null): string | null {
  return test && test.scope !== "workflow" ? test.nodeId : null;
}

/** The set of nodes a run may reach: everything, one node, or the way to one. */
export function scopeOf(graph: WorkflowGraph, test: RunTest | null): Set<string> | null {
  if (!test || test.scope === "workflow" || test.nodeId === null) return null;
  return test.scope === "node" ? new Set([test.nodeId]) : upstreamOf(graph, test.nodeId);
}

export interface TestPlan {
  /** Nodes the run would actually execute, in graph order. */
  executes: WorkflowNode[];
  /** Nodes whose pinned output stands in for them, in graph order. */
  pinned: WorkflowNode[];
  /** Of `executes`, the ones that act outside the product, with what each would do. */
  effects: { node: WorkflowNode; does: string }[];
}

/**
 * Which nodes a run *could* execute — in scope, switched on, and not standing in for itself
 * with a pin. "Could", because a branch decides at run time which side runs; the plan covers
 * both sides, which is the right reading for a warning.
 */
export function planTest(
  graph: WorkflowGraph,
  test: RunTest,
  lookup: (type: string) => NodeFacts | undefined,
): TestPlan {
  const scope = scopeOf(graph, test);
  const plan: TestPlan = { executes: [], pinned: [], effects: [] };

  for (const node of graph.nodes) {
    if (scope && !scope.has(node.id)) continue;
    if (node.disabled) continue;
    const facts = lookup(node.type);
    // The node a test is aimed at always executes — it is the thing being tested, so its own
    // pin is not honoured. Everything else in scope stands in with its pin.
    if (node.id !== aimedAt(test) && honouredPin(node, facts)) {
      plan.pinned.push(node);
      continue;
    }
    plan.executes.push(node);
    const does = effectOf(node, facts?.effect);
    if (does) plan.effects.push({ node, does });
  }

  return plan;
}

/** What a node would do outside the product with its stored config, or null. */
export function effectOf(node: WorkflowNode, effect: NodeEffect | undefined): string | null {
  if (!effect) return null;
  if (!effect.when) return effect.does;

  const value = node.config?.[effect.when.field] ?? effect.when.default;
  if (typeof value === "string" && value.includes("{{")) return effect.does;
  if (effect.when.is) {
    return typeof value === "string" && effect.when.is.includes(value) ? effect.does : null;
  }
  const empty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
  return empty ? null : effect.does;
}

/** Where a node test's input and references come from — a pin, or an earlier run. */
export type SeedSource = "pinned" | "recorded";

export interface NodeSeed {
  /** What arrives at the target. */
  input: unknown;
  /** Which upstream node it came from, and how; null when the target has nothing upstream. */
  from: { nodeId: string; source: SeedSource } | null;
  /** Every upstream node with a value, for `{{steps.<id>.output}}`. */
  outputs: Map<string, unknown>;
  /** The value `{{trigger.…}}` resolves against. */
  trigger: { value: unknown; source: SeedSource } | null;
  /** Upstream nodes with no value at all — references to them resolve empty. */
  missing: string[];
}

/**
 * **Feeding a node tested alone.** Each upstream node's value is, in order:
 *
 *  1. its **pin**, when it holds one a run would honour;
 *  2. passed through, when it is **switched off** and has a default output — what the run
 *     would have done (`CONTRACT.md` → *Disabled nodes*);
 *  3. its **most recent recorded output**, from a recent run of this workflow (`recorded`).
 *
 * The target's input is the value of the first incoming edge's source that has one — the
 * engine's own rule for a node with several inputs is "the first to arrive", and in a test
 * there is no arrival order, so the graph's edge order stands in for it.
 */
export function seedNode(
  graph: WorkflowGraph,
  target: string,
  lookup: (type: string) => NodeFacts | undefined,
  recorded: ReadonlyMap<string, unknown>,
): NodeSeed {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  // Recursion only ever passes through switched-off nodes, so it is short; `visiting` stops a
  // loop of switched-off nodes from going round for ever.
  const valueOf = (id: string, visiting: Set<string>): { value: unknown; source: SeedSource } | null => {
    if (visiting.has(id)) return null;
    visiting.add(id);

    const node = byId.get(id);
    let found: { value: unknown; source: SeedSource } | null = null;
    if (node) {
      const facts = lookup(node.type);
      const pin = honouredPin(node, facts);
      if (pin) found = { value: pin.output, source: "pinned" };
      else if (node.disabled) {
        found = canPin(facts) ? firstInput(id, visiting)?.seed ?? null : null;
      } else if (recorded.has(id)) found = { value: recorded.get(id), source: "recorded" };
    }

    visiting.delete(id);
    return found;
  };

  const firstInput = (id: string, visiting: Set<string>) => {
    for (const edge of graph.edges) {
      if (edge.target !== id) continue;
      const seed = valueOf(edge.source, visiting);
      if (seed) return { nodeId: edge.source, seed };
    }
    return null;
  };

  const outputs = new Map<string, unknown>();
  const missing: string[] = [];
  let trigger: NodeSeed["trigger"] = null;

  for (const id of upstreamOf(graph, target)) {
    if (id === target) continue;
    const seed = valueOf(id, new Set());
    if (seed) outputs.set(id, seed.value);
    else missing.push(id);
    const node = byId.get(id);
    if (node && lookup(node.type)?.kind === "trigger") trigger = seed;
  }

  const first = firstInput(target, new Set());
  return {
    input: first?.seed.value ?? null,
    from: first ? { nodeId: first.nodeId, source: first.seed.source } : null,
    outputs,
    trigger,
    missing: graph.nodes.filter((node) => missing.includes(node.id)).map((node) => node.id),
  };
}
