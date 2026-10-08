import type { Run, RunStep } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { getNode } from "@/lib/nodes";
import { versionGraph } from "@/lib/workflow/versions";
import { getWorkflow } from "@/lib/workflow/store";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { getRun, startDurableRun, startRun, toStepRecord, type StartOptions } from "./run";
import { planRetry, rerunnable } from "./retry";
import type { RunMode } from "./types";
import { validateGraph } from "./validate";

/**
 * **Starting a run from one that already happened — Phase 33, `CONTRACT.md` → *Re-runs and
 * retries*.** The routes' half: find the original the asker may see, decide whether it can be
 * started again and how, and hand an ordinary start to `run.ts`. The new run is a run like any
 * other — created, claimed, executed, streamed — with `origin` naming where it came from.
 *
 * Both start a **manual** run: a person pressed the button, and `trigger` has always said what
 * started a run, not what started the one before it. Both execute the workflow **as saved now**
 * (D151).
 */

export type RestartOutcome =
  | { kind: "finished"; run: Run; steps: RunStep[] }
  | { kind: "queued"; run: Run }
  /** A durable start the queue could not take, executed here instead (`startDurableRun`). */
  | { kind: "ran_here"; run: Run };

async function start(options: StartOptions, mode: RunMode): Promise<RestartOutcome> {
  if (mode === "durable") {
    const outcome = await startDurableRun(options);
    return outcome.queued ? { kind: "queued", run: outcome.run } : { kind: "ran_here", run: outcome.run };
  }
  const { run, steps } = await startRun(options);
  return { kind: "finished", run, steps };
}

function stillGoing(run: Run): ApiError {
  return new ApiError(
    "conflict",
    run.status === "waiting"
      ? "This run is waiting at a delay and will carry on by itself. Stop it first if you want to start it again."
      : "This run is still going. Wait for it to finish, or stop it, before starting it again.",
  );
}

/**
 * **Re-run** — the original's input, from the trigger. Any finished run may be re-run.
 *
 * A test of one node or of the way to it is re-run as that same test (Phase 31, D141): the
 * button on a test should test again, not run the whole workflow somebody meant to try a piece
 * of. A test is synchronous by design, so a re-run of one is too, whatever was asked.
 */
export async function rerunRun(options: {
  scope: WorkspaceScope;
  runId: string;
  mode: RunMode;
  signal?: AbortSignal;
}): Promise<RestartOutcome> {
  const { run: original } = await getRun(options.scope, options.runId);
  if (!rerunnable(original.status)) throw stillGoing(original);

  const workflow = await getWorkflow(options.scope, original.workflowId);
  const partial = original.test && original.test.scope !== "workflow" && original.test.nodeId
    ? { scope: original.test.scope, nodeId: original.test.nodeId }
    : undefined;

  return start(
    {
      scope: options.scope,
      workflow,
      trigger: "manual",
      input: original.input,
      signal: options.signal,
      origin: { runId: original.id, kind: "rerun" },
      ...(partial ? { target: partial } : {}),
    },
    partial ? "sync" : options.mode,
  );
}

/**
 * **Retry from the failed step** — the steps the original finished are carried over as `reused`
 * and not executed again; the run starts at the step it failed at (`retry.ts` → `planRetry`).
 *
 * Only a **failed** run is retried: a succeeded one has nothing to retry, and a cancelled one was
 * stopped on purpose — re-run it if it was wanted after all. A test of part of a workflow is not
 * retried either; it is re-run, which tests it again.
 *
 * The original's history is replayed over **the graph it ran** — its version snapshot (D86), or
 * the live graph when that version is no longer kept — and the retry executes the workflow as it
 * is saved now. That is the point: the failed step's config has usually just been fixed.
 */
export async function retryRun(options: {
  scope: WorkspaceScope;
  runId: string;
  mode: RunMode;
  signal?: AbortSignal;
}): Promise<RestartOutcome> {
  const { run: original, steps } = await getRun(options.scope, options.runId);
  if (!rerunnable(original.status)) throw stillGoing(original);
  if (original.status !== "failed") {
    throw new ApiError(
      "conflict",
      original.status === "succeeded"
        ? "This run succeeded, so there is nothing to retry. Re-run it to run it again."
        : "This run was cancelled, so it did not fail anywhere to retry from. Re-run it to start it again.",
    );
  }
  if (original.test && original.test.scope !== "workflow") {
    throw new ApiError(
      "invalid_request",
      "A test of part of a workflow is not retried from where it failed. Re-run it to test it again.",
    );
  }

  const workflow = await getWorkflow(options.scope, original.workflowId);
  const ran = (await versionGraph(workflow.id, original.workflowVersion)) ?? workflow.graph;
  const triggerNodeId = validateGraph(ran).triggerNodeId ?? steps[0]?.nodeId;
  if (!triggerNodeId) {
    throw new ApiError("conflict", "This run cannot be retried: the workflow it ran has no trigger. Re-run it instead.");
  }

  const label = (nodeId: string) => {
    const node = workflow.graph.nodes.find((candidate) => candidate.id === nodeId)
      ?? ran.nodes.find((candidate) => candidate.id === nodeId);
    return `"${node?.label || getNode(node?.type ?? "")?.label || nodeId}"`;
  };

  const plan = planRetry({
    original: ran,
    current: workflow.graph,
    triggerNodeId,
    steps: steps.map(toStepRecord),
    passesThrough: (type) => getNode(type)?.outputs.some((output) => output.key === null) ?? false,
    name: label,
  });
  if ("refused" in plan) throw new ApiError("conflict", plan.message);

  return start(
    {
      scope: options.scope,
      workflow,
      trigger: "manual",
      input: original.input,
      signal: options.signal,
      origin: { runId: original.id, kind: "retry" },
      carry: { cursor: plan.cursor, steps: plan.reused },
      // A retry of a test is a test. Otherwise D139's rule decides, as for any manual run: a
      // workflow that holds a pin now makes the retry a test that honours it.
      ...(original.test ? { test: original.test } : {}),
    },
    options.mode,
  );
}
