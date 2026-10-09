import { z } from "zod";

import type { StepRecord } from "./types";

/**
 * The resumable frontier — what a run needs to carry on from where it stopped.
 *
 * The engine's live state is a work list, a per-node execution count, and the
 * output of every node that has run (`execute.ts`). None of that was persisted in
 * Chapter 1, because a run that died was simply lost. Phase 17 makes a run
 * resumable, so the frontier has to survive the container.
 *
 * **What is stored, and what is deliberately not.** The queue and the execution
 * counts are stored; node *outputs* are not. Outputs are already persisted, one per
 * `run_step` row, so duplicating them here would put an HTTP node's whole response
 * body into the run row twice — and the cursor is written after every step. Instead
 * a queue entry names the `seq` of the step whose output feeds it, and `rehydrate`
 * reads the outputs back out of the step records it is given.
 *
 * The result is a cursor whose size depends on the *shape* of the graph and never on
 * the size of the data flowing through it: 100 nodes of frontier is a few kilobytes
 * whatever the payloads are. That matters twice over — it is a column written once
 * per step on a metered database, and Cloud Tasks bills per 32 KB of task payload,
 * which is why the task carries a run id and this never travels in it
 * (`DEPLOYMENT.md` → *Cloud Tasks*).
 */

/**
 * One piece of outstanding work: a node to run, and where its input comes from.
 *
 * `fromSeq` is the step whose output is this node's input, or `null` for the trigger,
 * whose input is the run's own `input`. A seq rather than the value itself is the
 * whole point of this module.
 */
export const cursorItemSchema = z.object({
  nodeId: z.string().min(1).max(128),
  fromSeq: z.number().int().min(0).nullable(),
});

/**
 * **What a `core.merge` is holding — Phase 39** (D187). `held` is the `seq` of the step each arrived
 * branch came from, in arrival order — a seq rather than the value, for this module's reason: the
 * output is already on a `run_step` row. `fired` is `first`'s: it has run, and arrivals that are
 * still on their way are dropped. A merge has an entry only while branches are outstanding.
 */
export const joinStateSchema = z.object({
  held: z.array(z.number().int().min(0)).max(500),
  fired: z.boolean(),
});

export const runCursorSchema = z.object({
  /** Outstanding work, in the order the engine will take it. */
  queue: z.array(cursorItemSchema).max(500),
  /** Node id → how many times it has completed. Drives the per-node execution cap. */
  executions: z.record(z.string(), z.number().int().min(0)),
  /** Steps already recorded. The next step's `seq` continues from here. */
  seq: z.number().int().min(0),
  /**
   * **Phase 26 — the step a waiting run is paused inside.** Present only while the run is
   * `waiting`: `seq` is the `core.delay` step that asked to wait, still `running`, and
   * `until` is when. A resumed engine finishes that step first — it is the one piece of
   * work the queue does not describe, because its successors are already in it — and the
   * cursor it writes afterwards no longer carries this.
   */
  wait: z
    .object({
      seq: z.number().int().min(0),
      until: z.iso.datetime(),
    })
    .optional(),
  /**
   * **Phase 38 — the approval this run is waiting on.** Present from the moment `core.approval`
   * records its request until the decision is applied: `seq` is its step, still `running`; `until` is
   * when its timeout decides; `id` is the request. Unlike `wait`, its successors are **not** in the
   * queue — which way the run goes is the decision — so a resumed engine either applies the decision
   * it was handed and follows Approved or Rejected, or, undecided, carries on with the rest of the
   * queue and is put down again when it runs out.
   */
  approval: z
    .object({
      seq: z.number().int().min(0),
      until: z.iso.datetime(),
      id: z.string().min(1).max(64),
    })
    .optional(),
  /**
   * **Phase 39 — what each `core.merge` is holding** (`join.ts`). Present only while some merge has
   * branches outstanding; an older revision does not know it, which is why `rollback_0018.sql`
   * counts the runs that carry one.
   */
  joins: z.record(z.string(), joinStateSchema).optional(),
});

export type JoinState = z.infer<typeof joinStateSchema>;
export type CursorItem = z.infer<typeof cursorItemSchema>;
export type RunCursor = z.infer<typeof runCursorSchema>;

/**
 * A cursor that has not run anything yet. The trigger is the only outstanding work
 * and its input is the run's input, which is why `fromSeq` is null.
 */
export function initialCursor(triggerNodeId: string): RunCursor {
  return { queue: [{ nodeId: triggerNodeId, fromSeq: null }], executions: {}, seq: 0 };
}

/**
 * Read a cursor off a run row. Anything that does not parse is treated as absent
 * rather than as an error: a run whose cursor is unreadable starts again from its
 * trigger, which is correct-but-repeated work, where trusting a malformed frontier
 * would be a run that executes an arbitrary node with arbitrary input.
 */
export function readCursor(value: unknown): RunCursor | null {
  const parsed = runCursorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The statuses whose step handed a value on to what follows it: it ran and succeeded, passed its
 * input through switched off (Phase 30), stood in with its pin (Phase 31), was carried over by
 * a retry (Phase 33), or failed and handed its error on under its on-error policy (Phase 37).
 */
const HANDED_ON: ReadonlySet<string> = new Set(["succeeded", "disabled", "pinned", "reused", "handled"]);

/**
 * What a resumed engine needs in memory, rebuilt from the cursor plus the step rows.
 *
 * `outputs` is reconstructed from the steps rather than stored: for each node, the
 * output of its highest-`seq` succeeded step, which is exactly what
 * `{{steps.x.output}}` resolved to when the run stopped. `lastOutput` is the output
 * of the highest-seq succeeded step overall, which is what the run's own output is
 * taken from.
 *
 * Steps that never ran (`skipped`) are ignored: they have no output, and a resumed
 * run re-derives the skipped set when it finishes. A **`disabled`** step (Phase 30) is read
 * exactly like a succeeded one: it never ran either, but it handed its input on, and the
 * node after it — perhaps queued in the cursor with this step's `seq` — reads that value. A
 * **`pinned`** step (Phase 31) is read the same way, for the same reason: what it handed on
 * is its pinned output. So is a **`reused`** one (Phase 33): a retry's copy of a step the run it
 * retries finished, whose output is exactly what the steps after it read there.
 */
export function rehydrate(
  cursor: RunCursor,
  steps: readonly StepRecord[],
): {
  outputs: Map<string, unknown>;
  executions: Map<string, number>;
  queue: CursorItem[];
  /** Phase 39: what the merges were holding. A copy — the engine mutates it as it runs. */
  joins: Record<string, JoinState>;
  seq: number;
  lastOutput: unknown;
  /** Output by step seq, so a queue entry's `fromSeq` resolves to the value it carried. */
  bySeq: Map<number, unknown>;
} {
  const ordered = [...steps]
    .filter((step) => HANDED_ON.has(step.status))
    .sort((a, b) => a.seq - b.seq);

  const outputs = new Map<string, unknown>();
  const bySeq = new Map<number, unknown>();
  let lastOutput: unknown = null;

  for (const step of ordered) {
    outputs.set(step.nodeId, step.output);
    bySeq.set(step.seq, step.output);
    lastOutput = step.output;
  }

  return {
    outputs,
    executions: new Map(Object.entries(cursor.executions)),
    queue: [...cursor.queue],
    joins: Object.fromEntries(
      Object.entries(cursor.joins ?? {}).map(([id, join]) => [id, { held: [...join.held], fired: join.fired }]),
    ),
    // The cursor's own seq is authoritative, but never below what the rows already
    // hold: a cursor write that was lost while its step row landed would otherwise
    // reuse a seq, and `(runId, seq)` is unique.
    seq: Math.max(cursor.seq, ...steps.map((step) => step.seq + 1), 0),
    lastOutput,
    bySeq,
  };
}

/** The frontier as it stands now, ready to be written to the run row. */
export function snapshotCursor(state: {
  queue: readonly CursorItem[];
  executions: ReadonlyMap<string, number>;
  seq: number;
  /** Phase 38 — the approval outstanding, written only while there is one. */
  approval?: RunCursor["approval"] | null;
  /** Phase 39 — what the merges are holding, written only while one holds anything. */
  joins?: Record<string, JoinState>;
}): RunCursor {
  return {
    queue: [...state.queue],
    executions: Object.fromEntries(state.executions),
    seq: state.seq,
    ...(state.approval ? { approval: state.approval } : {}),
    ...(state.joins && Object.keys(state.joins).length > 0
      ? {
          joins: Object.fromEntries(
            Object.entries(state.joins).map(([id, join]) => [id, { held: [...join.held], fired: join.fired }]),
          ),
        }
      : {}),
  };
}
