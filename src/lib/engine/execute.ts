import { logError, logInfo } from "@/lib/logging";
import { getNode } from "@/lib/nodes";
import { describeDuration, MAX_WAIT_MS } from "@/lib/nodes/core/delay";
import { NodeError, type LogLevel, type StepLog } from "@/lib/nodes/types";
import { edgesFrom, type WorkflowGraph } from "@/lib/workflow/graph";
import { resolveConfig } from "@/lib/workflow/template";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import {
  initialCursor,
  rehydrate,
  snapshotCursor,
  type CursorItem,
  type RunCursor,
} from "./cursor";
import { attemptDelayMs, readPolicy, retryable, type NodePolicy } from "./policy";
import { validateGraph, type GraphProblem } from "./validate";
import {
  CHECKPOINT_OK,
  noopRecorder,
  type RunOutcome,
  type RunRecorder,
  type StepRecord,
} from "./types";

/**
 * The execution engine — sequential, resumable, and indifferent to which process is
 * running it (ARCHITECTURE.md → "Execution engine design").
 *
 * A work list rather than a static topological sort, because branch and loop outputs
 * mean the order is only known as it runs. Start at the trigger, execute, follow the
 * outgoing edges matching the handle the node left through, repeat.
 *
 * **Phase 17 made the work list persistent.** The loop is the same loop; what changed
 * is that the frontier is written to the run row after every step (`cursor.ts`), so a
 * container that dies mid-run leaves behind enough to carry on rather than a run to
 * throw away. Three consequences are visible here:
 *
 *  - `resume` seeds the queue, the execution counts and the step numbering from a
 *    previous attempt instead of from the trigger.
 *  - `recorder.checkpoint` replaced `recorder.heartbeat`, and its return value can
 *    stop the loop: a cancellation was requested, or this engine no longer holds the
 *    run's lease and another worker has taken it over.
 *  - A node may be retried and may carry its own timeout (`policy.ts`).
 *
 * Three independent caps bound every run, so a malformed or generated graph cannot
 * spin:
 *   MAX_NODE_EXECUTIONS  one node may not run more than this many times
 *   MAX_STEPS            total steps in a run
 *   deadlineMs           wall-clock ceiling, below Cloud Run's request timeout
 *
 * The deadline applies to **this attempt**, not to the run's whole life. A resumed run
 * gets a fresh budget for the work it has left, which is the only reading that makes
 * sense: the alternative is a run that can never finish because its first attempt
 * spent the clock.
 *
 * Known simplification: a node with several incoming edges runs when the first one
 * reaches it, with that edge's data. There is no join/merge semantics. Recorded in
 * ARCHITECTURE.md rather than discovered later.
 */
export const MAX_NODE_EXECUTIONS = 30;
export const MAX_STEPS = 200;
export const DEFAULT_DEADLINE_MS = 120_000;

export interface ExecuteOptions {
  runId: string;
  workflowId: string;
  scope: WorkspaceScope;
  graph: WorkflowGraph;
  /** Payload from the trigger; becomes the trigger node's input. */
  input?: unknown;
  recorder?: RunRecorder;
  signal?: AbortSignal;
  deadlineMs?: number;
  /**
   * Carry on from a previous attempt. `cursor` is the frontier it left; `steps` are
   * the step records already written, which is where resumed node outputs come from
   * (`cursor.ts` → `rehydrate`).
   */
  resume?: { cursor: RunCursor; steps: readonly StepRecord[] };
  /**
   * Whether a node may pause this run until a later time — Phase 26.
   *
   * True only where something can resume it: a configured Cloud Tasks queue. Without one
   * — a developer machine, CI — a long `core.delay` fails its step with a message saying
   * so, rather than a request held open for hours that the platform will cut off anyway.
   */
  allowWait?: boolean;
}

/**
 * Slack on `MAX_WAIT_MS` for the time between a node computing its wake time and the
 * engine checking it. The bound is the node's; this only stops a clock tick from failing
 * a 30-day delay that was exactly on it.
 */
const WAIT_SLACK_MS = 60_000;

/** Thrown when a graph cannot run at all. The run fails before any step exists. */
export class GraphInvalidError extends Error {
  readonly problems: GraphProblem[];

  constructor(problems: GraphProblem[]) {
    super(problems.map((problem) => problem.message).join(" "));
    this.name = "GraphInvalidError";
    this.problems = problems;
  }
}

function message(error: unknown): string {
  if (error instanceof NodeError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });

/**
 * One node, with its retry policy applied.
 *
 * The step record is shared across attempts on purpose: a retried node is one step
 * that took several tries, not several steps. Its log carries the attempts, so a
 * person reading the run sees "Attempt 1 failed: 503 … retrying in 500ms" rather than
 * a silent delay.
 *
 * A per-attempt timeout is layered onto the run's signal rather than replacing it, so
 * the run's deadline and a cancellation still cut a node short even when its own
 * timeout is longer.
 */
async function runNode(options: {
  definition: NonNullable<ReturnType<typeof getNode>>;
  config: unknown;
  input: unknown;
  policy: NodePolicy;
  signal: AbortSignal;
  log: (message: string, level?: LogLevel) => void;
  context: Omit<Parameters<NonNullable<ReturnType<typeof getNode>>["execute"]>[0]["context"], "signal">;
}) {
  const { definition, config, input, policy, signal, log, context } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    if (attempt > 0) {
      const delay = attemptDelayMs(policy, attempt);
      log(
        `Attempt ${attempt} failed: ${message(lastError)} — retrying${delay > 0 ? ` in ${delay}ms` : ""}.`,
        "warn",
      );
      await wait(delay, signal);
      if (signal.aborted) break;
    }

    // `AbortSignal.timeout` is created per attempt: a retry gets its own budget, and
    // a timer created once outside the loop would expire for every later attempt.
    const attemptSignal =
      policy.timeoutMs === undefined
        ? signal
        : AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)]);

    try {
      return await definition.execute({
        config,
        input,
        context: { ...context, signal: attemptSignal },
      });
    } catch (error) {
      lastError = error;
      // A node that respects its signal throws an abort; one that ignores it returns
      // late. Either way, a timeout that was this node's own is worth naming, because
      // "took too long" and "the remote said no" are different problems.
      if (!signal.aborted && attemptSignal.aborted && policy.timeoutMs !== undefined) {
        lastError = new NodeError(
          `This node's ${policy.timeoutMs}ms timeout elapsed before it finished.`,
        );
      }
      if (signal.aborted || !retryable(lastError) || attempt === policy.retries) break;
    }
  }

  throw lastError;
}

export async function executeWorkflow(options: ExecuteOptions): Promise<RunOutcome> {
  const {
    runId,
    workflowId,
    scope,
    graph,
    input = null,
    recorder = noopRecorder,
    deadlineMs = DEFAULT_DEADLINE_MS,
    resume,
    allowWait = false,
  } = options;

  const validation = validateGraph(graph);
  if (!validation.valid || !validation.triggerNodeId) {
    throw new GraphInvalidError(validation.problems);
  }

  // Held separately from the combined signal so an abort can be attributed. A run that
  // ran out of clock and a run whose caller went away are different events, and
  // Chapter 1 reported both as "exceeded its time limit".
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  const start = resume
    ? rehydrate(resume.cursor, resume.steps)
    : rehydrate(initialCursor(validation.triggerNodeId), []);

  /** Every step of the run, resumed ones first, so the outcome describes the whole run. */
  const steps: StepRecord[] = resume ? [...resume.steps] : [];
  const outputs = start.outputs;
  const executions = start.executions;
  const queue: CursorItem[] = start.queue;
  const bySeq = start.bySeq;

  let seq = start.seq;
  let lastOutput: unknown = start.lastOutput;
  let failure: string | null = null;
  /** Set when the engine put the work down rather than finishing it. */
  let interrupted: "cancelled" | "preempted" | null = null;
  /** Set when a node paused the run (Phase 26): the step it paused in, and until when. */
  let paused: { seq: number; until: string } | null = null;

  const cursor = (): RunCursor => snapshotCursor({ queue, executions, seq });

  /**
   * **Waking up — Phase 26.** A run resumed from `waiting` has one piece of unfinished
   * work the queue does not describe: the delay step it paused inside, still `running`,
   * whose successors are already queued. Finish it first, so its output is what they
   * read and its duration is the wait.
   *
   * Guarded on the step still being `running`, because a previous wake may have finished
   * it and then lost its container before the next checkpoint rewrote the cursor — in
   * which case `rehydrate` has already counted it as succeeded and there is nothing to do.
   */
  const waking = resume?.cursor.wait;
  if (waking) {
    const step = steps.find((candidate) => candidate.seq === waking.seq);
    if (step && step.status === "running") {
      step.status = "succeeded";
      step.finishedAt = new Date().toISOString();
      step.logs.push({ at: step.finishedAt, level: "info", message: "Done waiting." });
      outputs.set(step.nodeId, step.output);
      bySeq.set(step.seq, step.output);
      lastOutput = step.output;
      await recorder.stepFinished(step);
      logInfo("node.finished", `Node ${step.nodeId} succeeded.`, {
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        status: "succeeded",
        iteration: step.iteration,
        branch: step.branch,
        durationMs: Date.parse(step.finishedAt) - Date.parse(step.startedAt ?? step.finishedAt),
      });
    }
  }

  while (queue.length > 0) {
    const item = queue.shift()!;

    if (signal.aborted) {
      failure = deadline.aborted
        ? "Run exceeded its time limit."
        : "Run was stopped before it finished.";
      break;
    }
    if (seq >= MAX_STEPS) {
      failure = `Run exceeded the maximum of ${MAX_STEPS} steps.`;
      break;
    }

    const node = graph.nodes.find((candidate) => candidate.id === item.nodeId);
    if (!node) continue;

    const iteration = executions.get(node.id) ?? 0;
    if (iteration >= MAX_NODE_EXECUTIONS) {
      failure = `Node "${node.id}" ran ${iteration} times, exceeding the limit of ${MAX_NODE_EXECUTIONS}.`;
      break;
    }

    const definition = getNode(node.type)!;
    const logs: StepLog[] = [];
    // `fromSeq` is null only for the trigger, whose input is the run's own input. A
    // resumed queue entry resolves through the step rows rather than through memory,
    // which is what lets the cursor stay small (`cursor.ts`).
    const nodeInput = item.fromSeq === null ? input : bySeq.get(item.fromSeq);

    // Named `templateScope` rather than `scope`, because `scope` now means the
    // workspace one destructured above and this is a different thing entirely: the
    // values `{{ }}` references resolve against. They were briefly both called `scope`
    // while Phase 19A was being written, and the inner one shadowed the outer, which
    // would have handed every node the template bag in place of its workspace.
    const templateScope = {
      run: { id: runId, workflowId },
      trigger: input,
      input: nodeInput,
      steps: Object.fromEntries(
        [...outputs].map(([nodeId, output]) => [nodeId, { output }]),
      ),
      node: { id: node.id, iteration },
    };

    const step: StepRecord = {
      seq,
      nodeId: node.id,
      nodeType: node.type,
      iteration,
      status: "running",
      config: null,
      input: nodeInput,
      output: null,
      branch: null,
      logs,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    const mySeq = seq;
    steps.push(step);
    seq += 1;
    await recorder.stepStarted(step);

    const log = (text: string, level: LogLevel = "info") => {
      const entry: StepLog = { at: new Date().toISOString(), level, message: text };
      logs.push(entry);
      // Persisted as it is written, not when the node returns, so a slow node
      // streams its reasoning instead of dumping it at the end.
      recorder.stepLogged?.(step, entry);
    };

    try {
      const resolved = resolveConfig(node.config ?? {}, templateScope);
      step.config = resolved;

      const parsed = definition.configSchema.safeParse(resolved);
      if (!parsed.success) {
        throw new NodeError(
          `Invalid config: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
            .join("; ")}`,
        );
      }
      step.config = parsed.data;

      const outcome = await runNode({
        definition,
        config: parsed.data,
        input: nodeInput,
        policy: readPolicy(node.policy),
        signal,
        log,
        context: { runId, workflowId, scope, nodeId: node.id, nodeType: node.type, iteration, log },
      });

      /**
       * **A node asked to pause the run — Phase 26.** The step keeps `running` with its
       * output already recorded, its successors are queued as usual, and the loop stops
       * without a checkpoint: the caller writes the cursor as part of suspending the run,
       * under the same lease guard, so there is one write rather than two.
       *
       * Refused here rather than in the node, because only the engine's caller knows
       * whether anything can resume this run, and bounded here rather than trusted,
       * because a bound is a property of the engine (D16).
       */
      if (outcome.wait) {
        const until = Date.parse(outcome.wait.until);
        if (!allowWait) {
          throw new NodeError(
            `This step asks the run to wait ${describeDuration(Math.max(0, until - Date.now()))}, ` +
              "which needs the run queue to wake it again — and no queue is configured here " +
              "(TASKS_QUEUE). Waits of up to 10 seconds run in place.",
          );
        }
        if (!Number.isFinite(until) || until - Date.now() > MAX_WAIT_MS + WAIT_SLACK_MS) {
          throw new NodeError("A run can wait at most 30 days.");
        }

        step.output = outcome.output ?? null;
        step.branch = outcome.branch ?? null;
        executions.set(node.id, iteration + 1);
        await recorder.stepFinished(step);

        for (const edge of edgesFrom(graph, node.id, step.branch)) {
          queue.push({ nodeId: edge.target, fromSeq: mySeq });
        }
        paused = { seq: mySeq, until: new Date(until).toISOString() };
        break;
      }

      step.status = "succeeded";
      step.output = outcome.output ?? null;
      step.branch = outcome.branch ?? null;
      step.finishedAt = new Date().toISOString();

      /**
       * **The node-latency metric — Phase 22.** One entry per completed step, carrying
       * the registry type and the duration and *nothing the node was working on*: an
       * input or an output here would be a second, unauthorised copy of the user's data
       * in a place none of the workspace rules reach (`lib/logging/logger.ts`).
       *
       * The duration is measured from the step record's own timestamps rather than a
       * separate clock, so what the chart shows and what the run panel shows cannot
       * disagree.
       */
      logInfo("node.finished", `Node ${node.id} succeeded.`, {
        nodeId: node.id,
        nodeType: node.type,
        status: "succeeded",
        iteration,
        branch: step.branch,
        durationMs: Date.parse(step.finishedAt) - Date.parse(step.startedAt!),
      });

      outputs.set(node.id, step.output);
      bySeq.set(mySeq, step.output);
      executions.set(node.id, iteration + 1);
      lastOutput = step.output;

      await recorder.stepFinished(step);

      for (const edge of edgesFrom(graph, node.id, step.branch)) {
        queue.push({ nodeId: edge.target, fromSeq: mySeq });
      }
    } catch (error) {
      step.status = "failed";
      step.error = message(error);
      step.finishedAt = new Date().toISOString();
      executions.set(node.id, iteration + 1);
      await recorder.stepFinished(step);
      failure = `Node "${node.id}" (${node.type}) failed: ${step.error}`;
      // Severity ERROR, so this is the entry a `severity>=ERROR` filter finds and Error
      // Reporting groups. The message carries the node's own words, which is what makes
      // the group in the logs and the group on the analytics page the same group.
      logError("node.finished", `Node ${node.id} failed.`, error, {
        nodeId: node.id,
        nodeType: node.type,
        status: "failed",
        iteration,
        durationMs: Date.parse(step.finishedAt) - Date.parse(step.startedAt!),
      });
      break;
    }

    // The frontier is written here, after the step that produced it, so a redelivery
    // resumes at exactly the next piece of outstanding work. The same statement
    // answers "was this cancelled" and "do I still own this run".
    const checkpoint = (await recorder.checkpoint(cursor())) ?? CHECKPOINT_OK;
    if (!checkpoint.leaseHeld) {
      interrupted = "preempted";
      break;
    }
    if (checkpoint.cancelRequested) {
      interrupted = "cancelled";
      break;
    }
  }

  if (interrupted === "preempted") {
    // Deliberately no cursor and no status: another worker holds this run and has
    // been writing its own frontier. Returning one here would overwrite theirs.
    return { status: null, stop: "interrupted", reason: "preempted", error: null, output: null, steps, cursor: null };
  }

  if (paused) {
    return {
      status: null,
      stop: "waiting",
      reason: null,
      error: null,
      output: null,
      steps,
      cursor: { ...cursor(), wait: paused },
      wakeAt: paused.until,
    };
  }

  if (interrupted === "cancelled") {
    return {
      status: "cancelled",
      stop: "finished",
      reason: "cancelled",
      error: "The run was cancelled.",
      output: null,
      steps,
      cursor: cursor(),
    };
  }

  // Every node that never ran is recorded as skipped, so run history shows the
  // untaken side of a branch rather than an unexplained gap.
  for (const node of graph.nodes) {
    if (executions.has(node.id) || steps.some((step) => step.nodeId === node.id)) continue;
    const skipped: StepRecord = {
      seq: seq++,
      nodeId: node.id,
      nodeType: node.type,
      iteration: 0,
      status: "skipped",
      config: null,
      input: null,
      output: null,
      branch: null,
      logs: [],
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    steps.push(skipped);
    await recorder.stepFinished(skipped);
  }

  return {
    status: failure ? "failed" : "succeeded",
    stop: "finished",
    reason: null,
    error: failure,
    output: failure ? null : lastOutput,
    steps,
    cursor: cursor(),
  };
}
