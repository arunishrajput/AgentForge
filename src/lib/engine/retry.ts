import { APPROVAL_TYPE, APPROVED_HANDLE, ASK_HANDLE, REJECTED_HANDLE } from "@/lib/approvals/rules";
import { edgesFrom, type WorkflowGraph } from "@/lib/workflow/graph";

import type { CursorItem, RunCursor } from "./cursor";
import { Frontier, type Taken } from "./join";
import type { StepRecord } from "./types";

/**
 * **Re-run and retry — Phase 33, `CONTRACT.md` → *Re-runs and retries*.**
 *
 * Two ways to start a run from one that already happened:
 *
 *   rerun   the original's input, from the trigger, as a new run
 *   retry   from the step the original failed at — every step it finished is carried into the
 *           new run as `reused` and **not executed again**, and the frontier it stopped at is
 *           where the new run starts
 *
 * Both execute the workflow **as it is saved now** (D151): the reason to retry is almost always
 * that somebody fixed what failed. The new run records which version it executed, as every run
 * does, and `origin` names the run it came from.
 *
 * This module is pure — no database, no registry — so the part that can be subtly wrong, working
 * out where a run stopped, is asserted in a millisecond.
 */

export const ORIGIN_KINDS = ["rerun", "retry"] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

/** `run.origin` — null on a run nothing else started. */
export interface RunOrigin {
  /** The run this one was started from. It may since have been pruned (D86's reasoning). */
  runId: string;
  kind: OriginKind;
}

/** What a retry starts from: the steps it carries over and the frontier it carries on from. */
export interface RetryPlan {
  /** Every step before the frontier, as the new run records it. Never executed again. */
  reused: StepRecord[];
  /** The frontier, ready to be written to the new run's row and resumed from. */
  cursor: RunCursor;
  /** The node the retry starts with — the one the original failed at, or stopped before. */
  from: string;
}

export type RetryRefusal =
  | { refused: "history_mismatch"; message: string }
  | { refused: "node_gone"; message: string; nodeId: string }
  | { refused: "merge_stopped"; message: string }
  | { refused: "nothing_left"; message: string };

/**
 * **Where a run stopped, rebuilt by replaying it.**
 *
 * The cursor a failed run leaves behind cannot be used: the engine takes the failing node off
 * its queue before running it, and appends a `skipped` step for everything it never reached, so
 * the frontier at the moment of failure is gone from it. It is not lost, though — the engine is
 * a work list (D15) whose every move is recorded. Starting from the trigger and, for each step
 * in `seq` order, taking the next entry off a queue and following the edges out of the handle
 * the step left through, reproduces the queue exactly — including the `fromSeq` that says which
 * step's output fed each entry, which is what lets the new run read its inputs out of its own
 * copied steps (D79) rather than out of the original.
 *
 * The replay mirrors `execute.ts` rule for rule:
 *
 *  - a queue entry whose node is not in the graph is dropped without a step
 *  - a `succeeded`, `pinned`, `reused` or `handled` step follows its own branch — for a handled
 *    one (Phase 37) that is Error when its policy routed it and the default output when it
 *    continued, which is exactly what `branch` recorded
 *  - a `disabled` step follows its default output when it has one, and stops its path when it
 *    does not (`passesThrough`)
 *  - a `failed` step — or a `running` one, which is what a run the sweeper closed mid-step
 *    leaves — is where the run stopped; its queue entry goes back on the front
 *  - `skipped` steps are appended after the loop and never took an entry, so they are ignored
 *  - an **approval** that was decided (Phase 38) followed Ask the moment it asked, and its decision —
 *    Approved or Rejected — only once the run had nothing else to do, which is when the engine put
 *    it down to wait. So the replay follows Ask at once and holds the decision back until its queue
 *    runs dry, exactly as the run did
 *
 * - a **merge** (Phase 39) is a piece of work the run took once for all the branches it joined, so
 *   the replay takes its work from the same `Frontier` the engine does — holding arrivals and
 *   firing the merge exactly when the run did. That the two share one implementation is the
 *   guarantee; `join.test.ts` and `retry.test.ts` check it from both sides
 *
 * A run that stopped *between* steps — out of time, or at a cap — has no failed step; its
 * frontier is whatever the replay leaves queued, and retrying it carries on from there.
 *
 * **Every step is checked against the entry it took**, node and pass. A history that does not
 * replay on the graph it ran — a version snapshot pruned and the workflow changed since — is
 * refused rather than guessed at: a retry that resumed from a reconstructed-and-wrong frontier
 * would run the wrong nodes on the wrong inputs and call itself a retry.
 */
export function planRetry(options: {
  /** The graph the original executed: its version snapshot, or the live graph if pruned. */
  original: WorkflowGraph;
  /** The graph the retry will execute — the workflow as saved now. */
  current: WorkflowGraph;
  /** The original's trigger node, where its replay starts. */
  triggerNodeId: string;
  steps: readonly StepRecord[];
  /** Whether a node type has a default output — what a switched-off node passes its input on through. */
  passesThrough: (nodeType: string) => boolean;
  /** Names a node for a refusal. */
  name?: (nodeId: string) => string;
}): RetryPlan | RetryRefusal {
  const { original, current, steps, passesThrough } = options;
  const name = options.name ?? ((nodeId: string) => `"${nodeId}"`);

  const inGraph = new Set(original.nodes.map((node) => node.id));
  const queue: CursorItem[] = [{ nodeId: options.triggerNodeId, fromSeq: null }];
  /** A decided approval whose decision the run applied when it had nothing else to do (Phase 38). */
  let awaiting: { nodeId: string; branch: string; seq: number } | null = null;
  const frontier = new Frontier({ graph: original, queue, waiting: () => awaiting?.nodeId ?? null });
  const executions = new Map<string, number>();
  const reused: StepRecord[] = [];
  let next = 0;

  const mismatch = (): RetryRefusal => ({
    refused: "history_mismatch",
    message:
      "This run cannot be retried from where it failed: its steps no longer line up with the workflow it ran, " +
      "because that version is no longer kept and the workflow has changed since. Re-run it from the start instead.",
  });

  const follow = (nodeId: string, handle: string | null, fromSeq: number) => {
    for (const edge of edgesFrom(original, nodeId, handle)) queue.push({ nodeId: edge.target, fromSeq });
  };

  const ordered = [...steps].filter((step) => step.status !== "skipped").sort((a, b) => a.seq - b.seq);
  let stopped: CursorItem | null = null;
  let stoppedSeq = 0;

  /**
   * The next piece of work the engine took, after the entries it dropped — releasing a held decision
   * when the work list runs dry, which is when the engine put the run down to wait.
   */
  const take = (): Taken | undefined => {
    for (;;) {
      const taken = frontier.next();
      if (taken) {
        if (inGraph.has(taken.item.nodeId)) return taken;
        continue;
      }
      if (!awaiting) return undefined;
      follow(awaiting.nodeId, awaiting.branch, awaiting.seq);
      awaiting = null;
    }
  };

  for (const step of ordered) {
    const taken = take();
    const item = taken?.item;
    if (!taken || !item || item.nodeId !== step.nodeId) return mismatch();
    if (step.seq !== next || step.iteration !== (executions.get(step.nodeId) ?? 0)) return mismatch();

    if (step.status === "failed" || step.status === "running") {
      // A merge takes its arrivals off the work list when it fires, so a retry cannot put them back
      // without remembering them; a merge has nothing of its own to fail, so this is the sweeper
      // closing a run in the instant between its start and its finish.
      if (taken.merged) {
        return {
          refused: "merge_stopped",
          message:
            "This run stopped at a merge, and a merge's branches cannot be put back. Re-run it from the start instead.",
        };
      }
      stopped = item;
      stoppedSeq = step.seq;
      break;
    }

    executions.set(step.nodeId, (executions.get(step.nodeId) ?? 0) + 1);
    reused.push(carried(step));
    next += 1;

    if (step.status === "disabled") {
      if (passesThrough(step.nodeType)) follow(step.nodeId, null, step.seq);
    } else if (decidedApproval(step)) {
      follow(step.nodeId, ASK_HANDLE, step.seq);
      awaiting = { nodeId: step.nodeId, branch: step.branch!, seq: step.seq };
    } else {
      follow(step.nodeId, step.branch, step.seq);
    }
  }

  // A decision the replay is still holding was applied by the run all the same — it is why the step
  // succeeded — so what it queued is part of the frontier, behind whatever was still ahead of it.
  if (awaiting) {
    const { nodeId, branch, seq } = awaiting as { nodeId: string; branch: string; seq: number };
    follow(nodeId, branch, seq);
  }

  const outstanding = stopped ? [stopped, ...queue] : queue;
  // Entries for nodes the workflow no longer has are dropped exactly as the engine drops them,
  // so the first one left is the node the retry really starts with.
  const first = outstanding.find((item) => inGraph.has(item.nodeId));
  if (!first) {
    return {
      refused: "nothing_left",
      message: "This run has nothing left to retry: every step it reached finished. Re-run it from the start instead.",
    };
  }

  if (!current.nodes.some((node) => node.id === first.nodeId)) {
    return {
      refused: "node_gone",
      nodeId: first.nodeId,
      message: `This run cannot be retried from where it failed: ${name(first.nodeId)} is no longer in the workflow. Re-run it from the start instead.`,
    };
  }

  return {
    reused,
    cursor: {
      queue: outstanding,
      executions: Object.fromEntries(executions),
      seq: stopped ? stoppedSeq : next,
      ...(Object.keys(frontier.joins).length > 0 ? { joins: frontier.joins } : {}),
    },
    from: first.nodeId,
  };
}

/**
 * A finished step as a retry records it. **`reused`, not `succeeded`** (D152): it did not run in
 * this run, and saying it did would claim a request was sent twice — the same reason D140 made
 * `pinned` a status. A step that never ran in the original either — switched off, pinned, or
 * already reused by an earlier retry — keeps the status that says so.
 *
 * Its config, input, output, branch and logs come across, so the new run reads as a whole story
 * and a later redelivery resumes from its own rows. Its timestamps do not: no time was spent on
 * it in this run, and analytics measures a node's latency only from steps that ran.
 */
function carried(step: StepRecord): StepRecord {
  return {
    ...step,
    // A handled step ran there too (Phase 37): what it handed on was its error, and that is what
    // the retry carries — the node is not run again, so it cannot fail differently this time.
    status: step.status === "succeeded" || step.status === "handled" ? "reused" : step.status,
    logs: [...step.logs],
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * An approval that was decided — its branch is the decision (Phase 38). One that failed or was
 * closed is where a run stopped and never gets here; one that failed *before* asking (its config, no
 * queue) and was handled by its on-error policy left by Error or its path stopped, never by a
 * decision, and replays like any handled step.
 */
function decidedApproval(step: StepRecord): boolean {
  return step.nodeType === APPROVAL_TYPE && (step.branch === APPROVED_HANDLE || step.branch === REJECTED_HANDLE);
}

/** Whether a run in this state may be re-run. Anything finished may; a run still going may not. */
export function rerunnable(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
