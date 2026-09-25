import { getNode } from "@/lib/nodes";
import { NodeError, type LogLevel, type StepLog } from "@/lib/nodes/types";
import { edgesFrom, type WorkflowGraph } from "@/lib/workflow/graph";
import { resolveConfig } from "@/lib/workflow/template";

import { validateGraph, type GraphProblem } from "./validate";
import {
  noopRecorder,
  type RunOutcome,
  type RunRecorder,
  type StepRecord,
} from "./types";

/**
 * The execution engine — in-process, sequential, no queue
 * (ARCHITECTURE.md → "Execution engine design").
 *
 * A work list rather than a static topological sort, because branch and loop
 * outputs mean the order is only known as it runs. Start at the trigger, execute,
 * follow the outgoing edges matching the handle the node left through, repeat.
 *
 * Three independent caps bound every run, so a malformed or generated graph cannot
 * spin:
 *   MAX_NODE_EXECUTIONS  one node may not run more than this many times
 *   MAX_STEPS            total steps in a run
 *   deadlineMs           wall-clock ceiling, below Cloud Run's request timeout
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
  ownerId: string;
  graph: WorkflowGraph;
  /** Payload from the trigger; becomes the trigger node's input. */
  input?: unknown;
  recorder?: RunRecorder;
  signal?: AbortSignal;
  deadlineMs?: number;
}

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

export async function executeWorkflow(options: ExecuteOptions): Promise<RunOutcome> {
  const {
    runId,
    workflowId,
    ownerId,
    graph,
    input = null,
    recorder = noopRecorder,
    deadlineMs = DEFAULT_DEADLINE_MS,
  } = options;

  const validation = validateGraph(graph);
  if (!validation.valid || !validation.triggerNodeId) {
    throw new GraphInvalidError(validation.problems);
  }

  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;

  const steps: StepRecord[] = [];
  /** Output of each node's most recent completed execution, for {{steps.x.output}}. */
  const outputs = new Map<string, unknown>();
  const executions = new Map<string, number>();
  const queue: Array<{ nodeId: string; input: unknown }> = [
    { nodeId: validation.triggerNodeId, input },
  ];

  let seq = 0;
  let lastOutput: unknown = null;
  let failure: string | null = null;

  while (queue.length > 0) {
    const item = queue.shift()!;

    if (signal.aborted) {
      failure = "Run exceeded its time limit.";
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

    const scope = {
      run: { id: runId, workflowId },
      trigger: input,
      input: item.input,
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
      input: item.input,
      output: null,
      branch: null,
      logs,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    steps.push(step);
    seq += 1;
    await recorder.stepStarted(step);

    try {
      const resolved = resolveConfig(node.config ?? {}, scope);
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

      const outcome = await definition.execute({
        config: parsed.data,
        input: item.input,
        context: {
          runId,
          workflowId,
          ownerId,
          nodeId: node.id,
          iteration,
          log: (text: string, level: LogLevel = "info") => {
            const entry: StepLog = { at: new Date().toISOString(), level, message: text };
            logs.push(entry);
            // Persisted as it is written, not when the node returns, so a slow node
            // streams its reasoning instead of dumping it at the end.
            recorder.stepLogged?.(step, entry);
          },
          signal,
        },
      });

      step.status = "succeeded";
      step.output = outcome.output ?? null;
      step.branch = outcome.branch ?? null;
      step.finishedAt = new Date().toISOString();

      outputs.set(node.id, step.output);
      executions.set(node.id, iteration + 1);
      lastOutput = step.output;

      await recorder.stepFinished(step);

      for (const edge of edgesFrom(graph, node.id, step.branch)) {
        queue.push({ nodeId: edge.target, input: step.output });
      }
    } catch (error) {
      step.status = "failed";
      step.error = message(error);
      step.finishedAt = new Date().toISOString();
      executions.set(node.id, iteration + 1);
      await recorder.stepFinished(step);
      failure = `Node "${node.id}" (${node.type}) failed: ${step.error}`;
      break;
    }

    await recorder.heartbeat();
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
    error: failure,
    output: failure ? null : lastOutput,
    steps,
  };
}
