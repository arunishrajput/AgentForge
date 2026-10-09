import type { WorkflowGraph } from "@/lib/workflow/graph";

import type { CursorItem, JoinState } from "./cursor";

/**
 * **Joining branches — Phase 39, task 3** (D187). `ARCHITECTURE.md` carried one row from Chapter 1:
 * "a node with several incoming edges runs once per arriving branch". `core.merge` is the node that
 * does not — it holds arrivals and runs **once**, either when every branch that can still reach it
 * has arrived (`all`) or on the first (`first`).
 *
 * This module is the work list's whole view of that, pure and shared. **The engine and the retry's
 * replay both take their next piece of work from `Frontier.next`** — the replay rebuilds a failed
 * run's frontier by taking work the way the run did (`retry.ts`), so a rule that lived only in the
 * engine would make every retry of a run with a merge in it refuse, or worse, resume somewhere the
 * run never was. One implementation cannot disagree with itself; `join.test.ts` and the
 * engine-against-replay cases guard the rest.
 *
 * **"Every branch that can still reach it" is read off the queue, not off the graph's shape.** A
 * diamond made by a Branch node sends the run down *one* side, and a merge that waited for both
 * would wait for ever. So a merge fires when nothing outstanding — no queued step, no approval
 * being waited on — has a path to it. Everything that could still have delivered has either
 * delivered or been left behind by a decision; the same test serves a parallel diamond (both sides
 * queued, so it waits for both) and a branching one (only one side queued, so it does not wait).
 */

export const MERGE_TYPE = "core.merge";

export const MERGE_MODES = ["all", "first"] as const;
export type MergeMode = (typeof MERGE_MODES)[number];

/** What a merge was handed when it fired: the steps whose outputs it joins, in arrival order. */
export interface Merged {
  mode: MergeMode;
  fromSeqs: number[];
}

/** The next piece of work. A merge firing carries `merged`; its item has no single source. */
export interface Taken {
  item: CursorItem;
  merged?: Merged;
}

/** The input a merge's step is handed: how many branches arrived, and what each carried. */
export interface MergeInput {
  count: number;
  /** In the order the branches arrived. */
  inputs: unknown[];
  /** The id of the node each input came from, in the same order. */
  from: string[];
}

export function modeOf(graph: WorkflowGraph, nodeId: string): MergeMode | null {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== MERGE_TYPE) return null;
  const mode = (node.config ?? {}).mode;
  return mode === "first" ? "first" : "all";
}

export class Frontier {
  /** The outstanding work. Shared with the caller, which pushes onto it as nodes finish. */
  readonly queue: CursorItem[];
  /** Per merge node: what is held, or whether `first` has already run. Shared with the caller. */
  readonly joins: Record<string, JoinState>;

  private readonly graph: WorkflowGraph;
  private readonly waiting: () => string | null;
  /** merge id → every node from which it can be reached, itself included. */
  private readonly reaching = new Map<string, Set<string>>();

  constructor(options: {
    graph: WorkflowGraph;
    queue: CursorItem[];
    joins?: Record<string, JoinState>;
    /** The node whose answer is still awaited — an approval's: it has delivered nothing yet. */
    waiting?: () => string | null;
  }) {
    this.graph = options.graph;
    this.queue = options.queue;
    this.joins = options.joins ?? {};
    this.waiting = options.waiting ?? (() => null);
  }

  /**
   * The next piece of work, or undefined when there is none. A queue entry for a merge is held (or
   * dropped, for `first` after it has run) and the loop looks again; a merge whose branches are all
   * accounted for comes out as one entry with every arrival it joins.
   *
   * An entry for a merge with **no source step** is a node tested on its own (Phase 31): it is fed
   * directly, and runs as the single-input merge it was handed.
   */
  next(): Taken | undefined {
    for (;;) {
      const ready = this.ready();
      if (ready) return ready;

      const item = this.queue.shift();
      if (!item) return undefined;

      const mode = modeOf(this.graph, item.nodeId);
      if (!mode || item.fromSeq === null) return { item };

      const join = (this.joins[item.nodeId] ??= { held: [], fired: false });
      if (mode === "first") {
        if (join.fired) continue;
        join.fired = true;
        return { item, merged: { mode, fromSeqs: [item.fromSeq] } };
      }
      join.held.push(item.fromSeq);
    }
  }

  /** A merge with nothing left that could arrive: fire it if it holds anything, forget it either way. */
  private ready(): Taken | undefined {
    for (const [nodeId, join] of Object.entries(this.joins)) {
      if (this.arriving(nodeId)) continue;
      delete this.joins[nodeId];
      if (join.held.length > 0) {
        return { item: { nodeId, fromSeq: null }, merged: { mode: "all", fromSeqs: join.held } };
      }
    }
    return undefined;
  }

  /** Whether anything outstanding can still reach `mergeId`. */
  private arriving(mergeId: string): boolean {
    const reach = this.reachers(mergeId);
    const awaited = this.waiting();
    if (awaited && reach.has(awaited)) return true;
    return this.queue.some((item) => reach.has(item.nodeId));
  }

  private reachers(mergeId: string): Set<string> {
    const known = this.reaching.get(mergeId);
    if (known) return known;

    const incoming = new Map<string, string[]>();
    for (const edge of this.graph.edges) {
      const list = incoming.get(edge.target) ?? [];
      list.push(edge.source);
      incoming.set(edge.target, list);
    }

    // Backwards from the merge, never through it: a loop that returns to a merge's own
    // successors must not count as the merge being reachable from where it already is.
    const seen = new Set<string>([mergeId]);
    const stack = [...(incoming.get(mergeId) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const source of incoming.get(id) ?? []) stack.push(source);
    }
    this.reaching.set(mergeId, seen);
    return seen;
  }
}

/** The merge step's input, built from the outputs of the steps it joined. */
export function mergeInput(
  merged: Merged,
  outputOf: (seq: number) => unknown,
  nodeOf: (seq: number) => string,
): MergeInput {
  return {
    count: merged.fromSeqs.length,
    inputs: merged.fromSeqs.map((seq) => outputOf(seq) ?? null),
    from: merged.fromSeqs.map(nodeOf),
  };
}
