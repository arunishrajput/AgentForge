import { and, asc, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { runs, runSteps, workflows, workspaceMembers, type Run, type RunStep, type Workflow } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { ApprovalDecision } from "@/lib/approvals/rules";
import { closeRequests, decisionFor } from "@/lib/approvals/store";
import { stoppedStep } from "@/lib/generate/evidence";
import { recordFailure } from "@/lib/inbox/store";
import { getNode } from "@/lib/nodes";
import { required } from "@/lib/env";
import { addLogContext, logError, logInfo, logWarn, withLogContext } from "@/lib/logging";
import { NodeError, type AgentWorkflow } from "@/lib/nodes/types";
import {
  alertsFor,
  ERROR_TRIGGER_TYPE,
  failurePayload,
  MAX_ERROR_WORKFLOWS,
} from "@/lib/triggers/failure";
import { MAX_CALL_DEPTH } from "@/lib/workflow/calls";
import { readToolArgs, toolSpec, toolWireName, workflowAgentToolSchema } from "@/lib/workflow/tool";
import { canSeeWorkflow, visibleWorkflows } from "@/lib/workflow/visibility";
import { versionGraph } from "@/lib/workflow/versions";
import { systemScope, type WorkspaceScope } from "@/lib/workspace/scope";

import { readCursor, type RunCursor } from "./cursor";
import { executeWorkflow, GraphInvalidError, MAX_STEPS } from "./execute";
import {
  claimOwnRun,
  claimRun,
  closePausedStep,
  finishRun,
  finishUnclaimedRun,
  finishWaitingRun,
  mintDispatchToken,
  mintLeaseOwner,
  MAX_DELIVERIES,
  suspendRun,
  sweepAbandonedRuns,
  type SweptRun,
} from "./lease";
import { honouredPin, seedNode, upstreamOf, type RunTest } from "./partial";
import { enqueueRun, queueNamed } from "./queue";
import { dbRecorder } from "./recorder";
import type { RunOrigin } from "./retry";
import type { CallBudget, CallRequest, CallResult, CallRunner, Lineage, RunMode, RunOutcome, StepRecord, TriggerKind } from "./types";

/**
 * Starting, resuming and reading runs.
 *
 * Two modes, and the difference is only *who executes the run*
 * (ARCHITECTURE.md → "Execution engine design"):
 *
 *   sync     this request executes it, and does not answer until it is over. Chapter
 *            1's only path, and still the right one for a run somebody is watching:
 *            `POST /runs` returns the finished run, which is what the canvas's Run
 *            button, `DEMO.md` and every verification script read.
 *   durable  a Cloud Tasks delivery executes it. This request answers as soon as the
 *            task is on the queue. Survives a redeploy, an instance recycle and a
 *            crash, because the queue redelivers and the engine resumes from the
 *            cursor the previous attempt left.
 *
 * Both take a lease and both checkpoint, so cancellation and progress work identically
 * and there is exactly one engine driver below.
 */

/** Minted per attempt, so a lease can be checked against the process that holds it. */
export interface StartOptions {
  scope: WorkspaceScope;
  workflow: Workflow;
  trigger: TriggerKind;
  input?: unknown;
  signal?: AbortSignal;
  /**
   * **Phase 31 — test part of the workflow**: one node alone, or the way to it. Only a manual
   * run may carry one, and only synchronously (`CONTRACT.md` → *Partial runs*).
   */
  target?: { scope: "node" | "path"; nodeId: string };
  /** **Phase 33** — the run this one was started from, by a re-run or a retry. */
  origin?: RunOrigin;
  /**
   * **Phase 33 — a retry's head start**: the frontier to begin from and the steps it carries
   * over as `reused`. Written to the new run before anything executes it, so a synchronous retry
   * and a queued one resume from the same rows (`retry.ts` → `planRetry`).
   */
  carry?: { cursor: RunCursor; steps: StepRecord[] };
  /**
   * Whether the run is a test, decided by the caller — **Phase 33**: a retry keeps its
   * original's label. Left out, `testFor` decides, as it does for every other run.
   */
  test?: RunTest | null;
  /**
   * **Phase 39 — the run that is calling this one**, and the node that made the call. Set only by
   * `callWorkflow` below; nothing a request can carry reaches it.
   */
  parent?: { runId: string; nodeId: string };
}

/**
 * **Is this run a test, and of what — Phase 31 (D139).** Decided once, when the run is created,
 * and written to `run.test`, which is the only thing the engine reads to honour a pin.
 *
 *  - a webhook, schedule or agent run is **never** a test, whatever the graph holds — so a
 *    pinned node executes for real in every run nobody started by hand;
 *  - a manual run aimed at a node is a `node` or `path` test;
 *  - a manual run of a graph holding a pin a run would honour is a `workflow` test, whether or
 *    not it reaches the pinned node — the label says what the author ran, not what a branch
 *    then chose, so it is predictable before the button is pressed.
 */
export function testFor(options: Pick<StartOptions, "trigger" | "workflow" | "target">): RunTest | null {
  if (options.trigger !== "manual") return null;
  if (options.target) return { scope: options.target.scope, nodeId: options.target.nodeId };
  const pinned = options.workflow.graph.nodes.some((node) => honouredPin(node, getNode(node.type)));
  return pinned ? { scope: "workflow", nodeId: null } : null;
}

/** How many of a workflow's recent runs a node test looks through for upstream outputs. */
export const RECORDED_RUNS = 20;

/**
 * Create the run row. Always `queued` — including for a synchronous run, which claims
 * it to `running` a moment later.
 *
 * `queued` was the one status in `CONTRACT.md`'s state machine that Chapter 1 reserved
 * and never wrote. It is written now, and it means what it says: the run exists, and
 * nothing is executing it yet.
 */
async function createRun(
  options: StartOptions & { mode: RunMode; test: RunTest | null },
): Promise<Run> {
  const [created] = await db()
    .insert(runs)
    .values({
      workflowId: options.workflow.id,
      // The workspace comes from the workflow, never from the caller: a run of a
      // workflow belongs where the workflow does, whoever pressed the button.
      workspaceId: options.workflow.workspaceId,
      ownerId: options.scope.userId,
      status: "queued",
      trigger: options.trigger,
      input: options.input ?? null,
      mode: options.mode,
      dispatchToken: mintDispatchToken(),
      // Which graph this run is executing (Phase 18). Recorded at creation, never
      // updated — a resume three deliveries later must still say what it started on.
      workflowVersion: options.workflow.version,
      test: options.test,
      origin: options.origin ?? null,
      parentRunId: options.parent?.runId ?? null,
      parentNodeId: options.parent?.nodeId ?? null,
      // A retry starts where its original stopped (Phase 33): the frontier is on the row before
      // anything claims it, exactly as a durable run's is between two deliveries.
      cursor: options.carry?.cursor ?? null,
    })
    .returning();

  if (options.carry && options.carry.steps.length > 0) await insertSteps(created.id, options.carry.steps);

  /**
   * The run id joins the **context** rather than being passed as a field, so this entry
   * and every entry after it in this request carries it — `drive` sets the same keys a
   * moment later, and setting them here means `run.started` is findable by run id too.
   * Found by filtering a real log for one run and getting two entries instead of three.
   */
  addLogContext({
    runId: created.id,
    workflowId: created.workflowId,
    workspaceId: created.workspaceId,
  });
  logInfo("run.started", `Run ${created.id} created.`, {
    trigger: created.trigger,
    mode: created.mode,
    workflowVersion: created.workflowVersion,
    test: created.test?.scope ?? null,
    origin: created.origin?.kind ?? null,
    reused: options.carry?.steps.length ?? 0,
    parentRunId: created.parentRunId,
  });

  return created;
}

/**
 * A retry's carried-over steps, in **one statement** (D6: no transaction) — so the run either has
 * its whole head start or, if this fails, none of it and a frontier the sweeper will close.
 */
async function insertSteps(runId: string, steps: readonly StepRecord[]): Promise<void> {
  await db()
    .insert(runSteps)
    .values(
      steps.map((step) => ({
        runId,
        seq: step.seq,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        iteration: step.iteration,
        status: step.status,
        config: step.config ?? null,
        input: step.input ?? null,
        output: step.output ?? null,
        branch: step.branch,
        logs: [...step.logs],
        error: step.error,
        startedAt: step.startedAt ? new Date(step.startedAt) : null,
        finishedAt: step.finishedAt ? new Date(step.finishedAt) : null,
      })),
    );
}

/** A head start as the engine resumes from it. */
function resumeOf(options: StartOptions) {
  return options.carry ? { cursor: options.carry.cursor, steps: options.carry.steps } : undefined;
}

/**
 * Run the engine over a claimed run and write its outcome.
 *
 * The one place `executeWorkflow` is called from, so the rules about what a caller may
 * write after an interruption live here once rather than in each route:
 *
 *  - `preempted` writes **nothing**. Another worker holds this run and is executing it;
 *    stamping a status would report a lie about a run that is still going.
 *  - a terminal outcome is written through `finishRun`, which is itself guarded on the
 *    lease, so a worker that lost its lease between the last checkpoint and the final
 *    write still cannot overwrite the new owner's work.
 */
async function drive(options: {
  run: Run;
  workflow: Workflow;
  owner: string;
  signal?: AbortSignal;
  resume?: { cursor: NonNullable<ReturnType<typeof readCursor>>; steps: readonly StepRecord[] };
  /** A `node` test's seed — Phase 31. */
  seed?: NodeTestSeed;
  /** Phase 38 — the decision on the approval the run was waiting for, read when it was resumed. */
  decision?: ApprovalDecision;
  /**
   * Phase 39 — set on a run that another workflow called: where it sits in the tree, and what is
   * left of the clock. A called workflow runs inside its caller's attempt, so it neither waits nor
   * outlives the deadline.
   */
  called?: { lineage: Lineage; deadlineMs: number };
}): Promise<RunOutcome> {
  const { run, workflow, owner, signal, resume, seed, decision, called } = options;
  const test = run.test ?? null;

  /**
   * **Phase 22 — the one place a run's outcome is observable.**
   *
   * Every path that executes a run passes through here: the synchronous one, the
   * in-process fallback, and a Cloud Tasks delivery. So `run.finished` is emitted here
   * rather than at the three call sites, which is what makes the run-volume and
   * failure-rate metrics count the same thing however a run was started.
   *
   * The run id joins the context rather than being passed as a field, so every
   * `node.finished` and `model.call` below this frame carries it too.
   */
  addLogContext({ runId: run.id, workflowId: workflow.id, workspaceId: run.workspaceId });
  const startedAt = Date.now();
  const finished = (status: string, error: string | null) => {
    const fields = {
      status,
      trigger: run.trigger,
      mode: run.mode,
      attempt: run.attempt,
      resumed: resume !== undefined,
      workflowVersion: run.workflowVersion,
      test: test?.scope ?? null,
      /** This attempt, not the run's whole life — a resumed run has several. */
      durationMs: Date.now() - startedAt,
    };
    if (status === "failed") logError("run.finished", `Run ${run.id} failed.`, error, fields);
    else logInfo("run.finished", `Run ${run.id} ${status}.`, fields);
  };

  let outcome: RunOutcome;
  try {
    outcome = await executeWorkflow({
      runId: run.id,
      workflowId: workflow.id,
      // Derived from the workflow rather than passed in, so a resumed delivery — which
      // has no session and no caller — reaches exactly the same workspace's credentials
      // as the attempt that started it.
      scope: systemScope(workflow),
      graph: workflow.graph,
      input: run.input,
      // Phase 38: a request the run makes belongs to the run's workspace and workflow.
      recorder: dbRecorder(run.id, owner, { workspaceId: run.workspaceId, workflowId: workflow.id }),
      signal,
      resume,
      decision,
      // A run may pause only where something can wake it (Phase 26). Read synchronously
      // from the environment: a queue that is named but rejecting is the sweep's problem,
      // not a reason to refuse the wait. A test of part of a workflow never pauses
      // (Phase 31): it is somebody at the canvas waiting for one answer.
      allowWait: !called && queueNamed() && (test === null || test.scope === "workflow"),
      // Phase 39: a run that nothing called is the root of its own tree of calls.
      ...(called ? { lineage: called.lineage, deadlineMs: called.deadlineMs } : {}),
      calls: callRunner({ run, workflow }),
      // From the row, never from the request (D139): this is what makes a pin apply.
      test,
      seed,
    });
  } catch (error) {
    const message =
      error instanceof GraphInvalidError
        ? `This workflow cannot run: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);

    if (await finishRun({ runId: run.id, owner, status: "failed", error: message })) {
      // Phase 38: a run resumed while it waited for a decision, that could not carry on, closes it.
      if (resume?.cursor.approval) {
        await closePausedStep(run.id, "The run stopped before anybody decided.");
        await closeRequests(run.id);
      }
      await announceFailure({ run: { ...run, error: message }, workflow, steps: resume?.steps ?? [] });
    }
    finished("failed", message);
    throw error;
  }

  if (outcome.stop === "waiting") {
    await suspend({ run, owner, outcome, startedAt });
    return outcome;
  }

  if (outcome.stop === "interrupted") {
    /**
     * **Deliberately not a `run.finished`.** `stop: "interrupted"` is preemption and
     * only preemption — a cancelled run comes back `stop: "finished"` with a terminal
     * status, which the line below handles. A preempted run is still going, in another
     * worker, and *that* worker will emit its outcome.
     *
     * Emitting `run.finished` here would count the same run twice in the volume metric
     * and, having no status, would land it in neither the success nor the failure
     * bucket. It is worth seeing, so it is a warning rather than nothing.
     */
    logWarn("system.warning", `Run ${run.id} was preempted and handed to another worker.`, {
      reason: outcome.reason,
      trigger: run.trigger,
      mode: run.mode,
      durationMs: Date.now() - startedAt,
    });
    return outcome;
  }

  const landed = await finishRun({
    runId: run.id,
    owner,
    status: outcome.status!,
    output: outcome.output,
    error: outcome.error,
    cursor: outcome.cursor,
    // Across every delivery: a resumed engine's steps include the ones before it. A retry's
    // carried-over steps are `reused`, not `handled` — this run did not handle them.
    handled: outcome.steps.filter((step) => step.status === "handled").length,
  });

  // Phase 38: an approval the run was still waiting on when it stopped is closed with it.
  if (landed && outcome.unsettledApproval) await closeRequests(run.id);

  // Phase 37: only the worker whose finish landed tells anybody — one that lost its lease at the
  // last moment would announce a failure another worker is about to overwrite.
  if (landed && outcome.status === "failed") {
    await announceFailure({ run: { ...run, error: outcome.error }, workflow, steps: outcome.steps });
  }

  finished(outcome.status!, outcome.error);
  return outcome;
}

/**
 * Put a run down until its wake time and arrange for it to be picked up — **Phase 26**.
 *
 * Three outcomes, none of them a terminal status written by guesswork:
 *
 *   suspended   the run is `waiting`, holding no lease, and a Cloud Tasks delivery to the
 *               ordinary dispatch route is scheduled for `wakeAt`. The run's own
 *               `dispatchToken` is what that delivery carries, so a wake is exactly a
 *               redelivery and needs no route of its own.
 *   preempted   the suspend matched no row: another worker holds the lease. Nothing is
 *               written, as with any preemption.
 *   cancelled   a stop arrived while the delay step was running. Nobody would see it
 *               until the wake, so the run is finished as cancelled now.
 *
 * **A failed enqueue does not fail the run.** It is logged as `queue.degraded` — the
 * event the one alerting policy watches — and the run stays `waiting`; the daily sweep
 * re-enqueues any waiting run whose wake time has passed (`lib/triggers/tick.ts`). The
 * alternative, failing a run because the queue blinked, would lose work the sweep can save.
 */
async function suspend(options: {
  run: Run;
  owner: string;
  outcome: RunOutcome;
  startedAt: number;
}): Promise<void> {
  const { run, owner, outcome, startedAt } = options;
  const approvalId = outcome.cursor?.approval?.id;

  const suspension = await suspendRun({
    runId: run.id,
    owner,
    cursor: outcome.cursor!,
    wakeAt: outcome.wakeAt!,
    approvalId,
  });
  const { suspended, cancelRequested } = suspension;
  // What the database wrote — for an approval decided while the run was still sending its link, now.
  const wakeAt = suspension.wakeAt?.toISOString() ?? outcome.wakeAt!;

  if (!suspended) {
    logWarn("system.warning", `Run ${run.id} was preempted before it could be suspended.`, {
      trigger: run.trigger,
      mode: run.mode,
    });
    return;
  }

  if (cancelRequested) {
    await finishWaitingRun({ runId: run.id, status: "cancelled", error: "The run was cancelled." });
    logInfo("run.finished", `Run ${run.id} cancelled.`, {
      status: "cancelled",
      trigger: run.trigger,
      mode: "durable",
      attempt: run.attempt,
      resumed: false,
      workflowVersion: run.workflowVersion,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  logInfo("run.waiting", `Run ${run.id} is waiting until ${wakeAt}.`, {
    trigger: run.trigger,
    wakeAt,
    // Phase 38: what it waits for — a decision, or the end of a delay.
    for: approvalId ? "approval" : "delay",
    durationMs: Date.now() - startedAt,
  });

  const result = await enqueueRun({
    runId: run.id,
    token: run.dispatchToken!,
    baseUrl: required("APP_BASE_URL"),
    secret: required("CRON_SECRET"),
    at: new Date(wakeAt),
  });

  if (!result.enqueued) {
    logError("queue.degraded", `Run ${run.id} is waiting but its wake could not be scheduled.`, result.detail, {
      reason: result.reason,
    });
  }
}

/**
 * **Calling another workflow — Phase 39, tasks 1 and 2** (D185, D186, `CONTRACT.md` → *Calling a
 * workflow*). The only code that starts a run on behalf of a node, so every rule about when that is
 * allowed is here once:
 *
 *   workspace   the callee must be in the caller's workspace — a row from any other is "no such
 *               workflow", never a refusal that confirms it exists (D20)
 *   visibility  and visible to the caller's **author** (D101): a private workflow is callable by its
 *               own creator's workflows and by an admin's, and by nobody else's. A webhook or a
 *               schedule has no person, so the workflow's author is who is asked, as with an error
 *               workflow (D176)
 *   cycle       the callee must not be a workflow already above this call in the tree — checked at
 *               save over what the graph says (`workflow/calls.ts`), and here over what happened
 *   depth       the tree may not be more than `MAX_CALL_DEPTH` deep
 *   budget      the callee gets what is left of the caller's steps and clock (D16 extended)
 *
 * The callee runs **inside this call** — a sync run of its own, claimed by this process, that names
 * the caller (`run.parentRunId`) — so it has its own page and its own steps, and the caller's step
 * holds until it ends. It cannot pause (`drive`'s `called`): there is nothing to wake it into.
 *
 * At-least-once, like every node: a durable caller whose container dies during a call is redelivered
 * and calls again. The first call's run is left `running` with a lapsed lease and the sweeper fails
 * it, so history shows both.
 */
function callRunner(parent: { run: Run; workflow: Workflow }): CallRunner {
  return {
    tools: (ids) => callableTools(parent.workflow, ids),
    call: (request, budget) => callWorkflow(parent, request, budget),
  };
}

/**
 * The workflows among `candidates` that the author of `parent` may see — one membership lookup, and
 * only when some candidate is private to somebody else.
 */
async function visibleToAuthor(parent: Workflow, candidates: Workflow[]): Promise<Workflow[]> {
  const needsRole = candidates.some((candidate) => candidate.visibility === "private" && candidate.ownerId !== parent.ownerId);
  if (!needsRole) return candidates;

  const [member] = await db()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, parent.workspaceId), eq(workspaceMembers.userId, parent.ownerId)))
    .limit(1);
  // An author who has since left the workspace sees only what is shared with it.
  const viewer = { role: member?.role ?? ("viewer" as const), userId: parent.ownerId };
  return candidates.filter((candidate) => canSeeWorkflow(viewer, candidate));
}

async function callableTools(parent: Workflow, ids: string[]): Promise<AgentWorkflow[]> {
  const wanted = [...new Set(ids)].slice(0, 50);
  if (wanted.length === 0) return [];

  const rows = await db()
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.workspaceId, parent.workspaceId),
        inArray(workflows.id, wanted),
        sql`${workflows.agentTool} is not null`,
      ),
    );

  const tools: AgentWorkflow[] = [];
  for (const row of await visibleToAuthor(parent, rows)) {
    const tool = workflowAgentToolSchema.safeParse(row.agentTool);
    // A marking that no longer parses is not a tool; nothing is offered rather than half of one.
    if (tool.success) {
      tools.push({
        id: row.id,
        name: toolWireName(tool.data),
        spec: toolSpec(tool.data),
        read: (args) => readToolArgs(tool.data, args),
      });
    }
  }
  return tools;
}

async function callWorkflow(
  parent: { run: Run; workflow: Workflow },
  request: CallRequest,
  budget: CallBudget,
): Promise<CallResult> {
  const target = request.workflowId.trim();

  if (budget.depth > MAX_CALL_DEPTH) {
    throw new NodeError(
      `Workflows can call each other ${MAX_CALL_DEPTH} levels deep and no further, and this call would be the ${budget.depth}th. Flatten one of the calls.`,
    );
  }
  if (budget.ancestors.includes(target)) {
    throw new NodeError(
      target === parent.workflow.id
        ? "A workflow cannot call itself."
        : "This workflow is already running above this call, so calling it would go round in a circle.",
    );
  }
  if (budget.stepLimit <= 0) {
    throw new NodeError(`The ${MAX_STEPS} steps a call tree is allowed are used up, so there is nothing left to call with.`);
  }
  if (budget.signal.aborted) throw new NodeError("The run was stopped before this call could start.");

  const [row] = await db()
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, target), eq(workflows.workspaceId, parent.workflow.workspaceId)))
    .limit(1);
  if (!row) throw new NodeError(`There is no workflow with the id "${target}" in this workspace.`);

  const [child] = await visibleToAuthor(parent.workflow, [row]);
  if (!child) {
    throw new NodeError(
      `“${row.name}” is private to someone else, and the author of this workflow cannot see it, so it cannot be called from here.`,
    );
  }

  // The callee is a run in its own right: its own log context, so its lines carry its own run id and
  // the caller's go on carrying the caller's once this returns.
  return withLogContext({}, async () => {
    const created = await createRun({
      scope: systemScope(child),
      workflow: child,
      trigger: request.via === "agent" ? "agent" : "workflow",
      input: request.input ?? null,
      mode: "sync",
      test: null,
      parent: { runId: parent.run.id, nodeId: request.nodeId },
    });
    const owner = mintLeaseOwner();
    const claimed = await claimOwnRun(created.id, owner);
    if (!claimed) {
      await finishUnclaimedRun({ runId: created.id, status: "failed", error: "The run could not be started." });
      throw new NodeError(`“${child.name}” could not be started.`);
    }

    let outcome: RunOutcome;
    try {
      outcome = await drive({
        run: claimed,
        workflow: child,
        owner,
        signal: budget.signal,
        called: {
          lineage: { depth: budget.depth, ancestors: [...budget.ancestors, child.id], stepLimit: budget.stepLimit },
          deadlineMs: budget.deadlineMs,
        },
      });
    } catch (error) {
      // `drive` has already failed the callee's run and said why on it.
      throw new NodeError(`“${child.name}” cannot run: ${error instanceof Error ? error.message : String(error)} (run ${created.id})`);
    }

    if (outcome.status === "succeeded") {
      return {
        runId: created.id,
        workflowId: child.id,
        workflowName: child.name,
        output: outcome.output,
        steps: outcome.steps.length + (outcome.charged ?? 0),
      };
    }
    if (outcome.stop === "interrupted") {
      throw new NodeError(`“${child.name}” was interrupted before it finished (run ${created.id}).`);
    }
    throw new NodeError(
      `“${child.name}” ${outcome.status === "cancelled" ? "was cancelled" : "failed"}${outcome.error ? `: ${outcome.error}` : ""} (run ${created.id})`,
    );
  });
}

/**
 * Execute a run inside this request and return it finished — the synchronous path.
 *
 * Sweeps first, so a previous instance's abandoned run does not sit in `running` next
 * to this one. The sweep is mode-aware now: a durable run waiting for its next delivery
 * looks exactly like an abandoned one and must not be touched (`lease.ts`).
 */
export async function startRun(
  options: StartOptions,
): Promise<{ run: Run; steps: RunStep[] }> {
  await sweepRuns(options.scope);

  const test = options.test !== undefined ? options.test : testFor(options);
  // A node test is fed before its run exists, so a test that has nothing to feed it is
  // refused with a reason rather than recorded as a run that could not have meant anything.
  const seed = test?.scope === "node" ? await seedFor(options.workflow, test.nodeId!) : undefined;

  const created = await createRun({
    ...options,
    mode: "sync",
    test,
    // What `{{trigger.…}}` resolved against is what a node test was started with.
    ...(seed ? { input: seed.trigger } : {}),
  });
  const owner = mintLeaseOwner();
  const claimed = await claimOwnRun(created.id, owner);

  // Nothing else can hold a lease on a row created microseconds ago, so this is a
  // "cannot happen" that is nonetheless not worth an exception: report it as a failed
  // run rather than a 500, because the user's mental model is that their run failed.
  if (!claimed) {
    await finishUnclaimedRun({
      runId: created.id,
      status: "failed",
      error: "The run could not be started.",
    });
    return getRun(options.scope, created.id);
  }

  try {
    await drive({
      run: claimed,
      workflow: options.workflow,
      owner,
      signal: options.signal,
      seed,
      resume: resumeOf(options),
    });
  } catch (error) {
    if (error instanceof GraphInvalidError) {
      throw new ApiError(
        "invalid_graph",
        `This workflow cannot run: ${error.message}`,
        error.problems,
      );
    }
    // Any other failure is already recorded on the run by `drive`; returning the run
    // keeps the response shape identical to a run that failed in a node.
  }

  return getRun(options.scope, created.id);
}

export interface EnqueueOutcome {
  run: Run;
  /** False when the queue was unavailable and this process executed the run instead. */
  queued: boolean;
  detail?: string;
}

/**
 * Create a durable run and hand it to the queue. Returns as soon as the task exists —
 * the run is executed by the delivery, not by this request.
 *
 * **The fallback matters more than the happy path.** With no queue configured — a
 * developer machine, CI — this executes the run in-process instead, and *downgrades the
 * row to `sync`* so the sweeper tells the truth about it: a run nothing will redeliver
 * is a synchronous run, whatever it was asked to be. A rejection from a configured queue
 * is the same fallback plus a logged error, because a missing `cloudtasks.enqueuer`
 * binding should degrade to a working product and a loud log, not to a lost run.
 */
export async function startDurableRun(options: StartOptions): Promise<EnqueueOutcome> {
  if (options.target) {
    throw new ApiError(
      "invalid_request",
      "A test of part of a workflow runs straight away and cannot be queued. Leave out mode, or use \"sync\".",
    );
  }
  await sweepRuns(options.scope);

  // A manual run of a graph holding pins is a test here too, and survives a redeploy as one:
  // the resumed delivery reads `run.test` off the row, so it honours the same pins.
  const created = await createRun({
    ...options,
    mode: "durable",
    test: options.test !== undefined ? options.test : testFor(options),
  });

  const result = await enqueueRun({
    runId: created.id,
    token: created.dispatchToken!,
    baseUrl: required("APP_BASE_URL"),
    secret: required("CRON_SECRET"),
  });

  if (result.enqueued) return { run: created, queued: true };

  if (result.reason !== "unconfigured") {
    /**
     * **The event worth alerting on in this whole file.** A rejected enqueue does not
     * break anything a user can see — the run executes here instead and finishes
     * normally — so nothing else in the product reports it, and the only symptom is that
     * durable runs quietly stopped surviving a redeploy. `OPERATIONS.md` builds the one
     * alerting policy in this project on it.
     */
    logError("queue.degraded", `Run ${created.id} could not be enqueued; executing in-process.`, result.detail, {
      reason: result.reason,
    });
  }

  const [downgraded] = await db()
    .update(runs)
    .set({ mode: "sync" })
    .where(eq(runs.id, created.id))
    .returning();

  const owner = mintLeaseOwner();
  const claimed = await claimOwnRun(downgraded.id, owner);
  if (claimed) {
    try {
      await drive({
        run: claimed,
        workflow: options.workflow,
        owner,
        signal: options.signal,
        resume: resumeOf(options),
      });
    } catch {
      // Recorded on the run by `drive`. A durable start has no caller waiting on a
      // throw, so it becomes a failed run rather than an exception.
    }
  }

  const [final] = await db().select().from(runs).where(eq(runs.id, created.id)).limit(1);
  return { run: final ?? downgraded, queued: false, detail: result.reason };
}

export type ResumeOutcome =
  | { handled: true; status: string }
  | {
      handled: false;
      reason: "unknown" | "not_claimable" | "not_due" | "deliveries_exhausted" | "cancelled";
    };

/**
 * Execute a delivered run — the worker side of the queue.
 *
 * Every early return here is a case where the correct behaviour is to do nothing and
 * tell the queue the delivery succeeded, so it is not retried:
 *
 *   unknown               no run with this id and token. A replayed or forged task.
 *   not_claimable         terminal already, or another worker holds a live lease.
 *   not_due               a `waiting` run delivered before its wake time (Phase 26) — a
 *                         wait beyond the queue's 30-day horizon, or a clock. It is
 *                         re-armed for the real time and this delivery does nothing.
 *   deliveries_exhausted  the queue has tried enough. The run is failed here rather
 *                         than left for the sweeper, so it closes at a known moment.
 *   cancelled             somebody asked it to stop before a worker ever saw it.
 */
export async function resumeRun(options: {
  runId: string;
  token: string;
  signal?: AbortSignal;
}): Promise<ResumeOutcome> {
  // A delivery has no session and no caller, so the run id is the only correlation this
  // side of the queue has. Set before the claim, so a delivery for a run that cannot be
  // claimed still says which run it was for.
  addLogContext({ runId: options.runId });

  const owner = mintLeaseOwner();
  const claimed = await claimRun({ runId: options.runId, token: options.token, owner });

  logInfo("queue.delivered", `A delivery arrived for run ${options.runId}.`, {
    claimed: claimed !== undefined,
    attempt: claimed?.attempt,
  });

  if (!claimed) {
    const [existing] = await db()
      .select({ id: runs.id, status: runs.status, wakeAt: runs.wakeAt })
      .from(runs)
      .where(and(eq(runs.id, options.runId), eq(runs.dispatchToken, options.token)))
      .limit(1);
    if (!existing) return { handled: false, reason: "unknown" };

    // Early for a waiting run: arm it again for the real time. Duplicate wakes are
    // harmless — the claim above takes a waiting run exactly once.
    if (existing.status === "waiting" && existing.wakeAt) {
      await enqueueRun({
        runId: options.runId,
        token: options.token,
        baseUrl: required("APP_BASE_URL"),
        secret: required("CRON_SECRET"),
        at: existing.wakeAt,
      });
      return { handled: false, reason: "not_due" };
    }
    return { handled: false, reason: "not_claimable" };
  }

  if (claimed.cancelRequestedAt !== null) {
    await finishRun({
      runId: claimed.id,
      owner,
      status: "cancelled",
      error: "The run was cancelled.",
    });
    // A wake can claim a waiting run between a Stop's two writes — the cancel request and
    // the finish — and land here. Its delay step is still `running`; close it (Phase 26). An
    // approval's step likewise, and its request with it (Phase 38).
    const paused = readCursor(claimed.cursor);
    if (paused?.wait || paused?.approval) {
      await closePausedStep(claimed.id, "The run was cancelled while it was waiting.");
    }
    if (paused?.approval) await closeRequests(claimed.id);
    return { handled: false, reason: "cancelled" };
  }

  if (claimed.attempt > MAX_DELIVERIES) {
    const error = `The run was retried ${MAX_DELIVERIES} times without finishing and has been given up on.`;
    if (await finishRun({ runId: claimed.id, owner, status: "failed", error })) {
      if (readCursor(claimed.cursor)?.approval) {
        await closePausedStep(claimed.id, "The run stopped before anybody decided.");
        await closeRequests(claimed.id);
      }
      await announceFailure({ run: { ...claimed, error } });
    }
    return { handled: false, reason: "deliveries_exhausted" };
  }

  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.id, claimed.workflowId))
    .limit(1);

  if (!workflow) {
    await finishRun({
      runId: claimed.id,
      owner,
      status: "failed",
      error: "The workflow this run belongs to no longer exists.",
    });
    return { handled: true, status: "failed" };
  }

  /**
   * **A redelivered run executes the graph it started on, not the graph as it is now.**
   *
   * This is the defect Phase 18 made visible and then fixed. A durable run survives a
   * redeploy by design, which means it can also survive an *edit*: delivery 1 runs
   * three nodes of version 4, the author saves version 5 removing one of them, and
   * delivery 2 resumes from a cursor whose queue names nodes that no longer exist. The
   * result is a run that executed half of one workflow and half of another and reports
   * a version number for neither.
   *
   * The snapshot is what closes it. A run with no recorded version — every run from
   * before this phase — and a run whose version was pruned both fall back to the live
   * graph, which is exactly the old behaviour, so nothing in flight was broken by
   * adding this.
   */
  const snapshot = await versionGraph(workflow.id, claimed.workflowVersion);
  const executing = snapshot ? { ...workflow, graph: snapshot } : workflow;

  // A cursor is present from the second delivery onward. Reading the steps back is what
  // lets the cursor stay small — node outputs live in the step rows, not in the cursor
  // (`cursor.ts`).
  const cursor = readCursor(claimed.cursor);
  const resume = cursor
    ? { cursor, steps: (await readSteps(claimed.id)).map(toStepRecord) }
    : undefined;

  /**
   * **A run that asked a person — Phase 38.** Its decision, if it has one: a person's, or — the run
   * claimed at its timeout — the timeout's, decided here by the request's `onTimeout` unless a person
   * got there first. None yet means a redelivery mid-way through the Ask path: the engine carries on
   * and puts the run down again.
   */
  const decision = cursor?.approval ? await decisionFor(cursor.approval.id) : undefined;

  try {
    const outcome = await drive({
      run: claimed,
      workflow: executing,
      owner,
      signal: options.signal,
      resume,
      decision,
    });
    return {
      handled: true,
      status: outcome.stop === "interrupted" ? `interrupted:${outcome.reason}` : outcome.status!,
    };
  } catch {
    // `drive` has already failed the run. An invalid graph will still be invalid on the
    // next delivery, so this is answered as handled rather than retried.
    return { handled: true, status: "failed" };
  }
}

/**
 * **When a run nobody was watching fails, tell somebody — Phase 37** (D176, D177,
 * `CONTRACT.md` → *Failure alerts*).
 *
 * Called after the statement that finished the run `failed` landed, from every path that fails
 * one: a step that failed (`drive`), a graph that cannot run, a queue that gave up
 * (`resumeRun`), and the sweeper (`sweepRuns`). Which failures count, and what is handed on, are
 * `triggers/failure.ts`'s rules; this does the two writes:
 *
 *  1. **An inbox entry** for each member who may see the workflow — one statement
 *  2. **A queued run of each error workflow** in the workspace whose author may see the failed
 *     workflow (D101 — an error workflow must not be told what its author could not read), with
 *     the trigger kind `error`, which is what stops one from ever setting off another
 *
 * The database is awake already — the run's own finish just wrote to it — so neither is a new
 * reason to wake Neon. Error workflows are **queued**, never run in this request: the request may
 * be a webhook's caller waiting for its answer.
 *
 * **It never throws.** An alert that could not be sent is logged at error severity and the run's
 * own outcome stands — failing the request that recorded a failure would lose the record.
 */
export async function announceFailure(input: {
  run: Pick<Run, "id" | "workflowId" | "workspaceId" | "trigger" | "test" | "startedAt" | "error">;
  /** The workflow, when the caller already holds it. */
  workflow?: Workflow;
  /** The run's steps, when the caller already holds them. Read otherwise. */
  steps?: readonly Pick<StepRecord, "seq" | "nodeId" | "nodeType" | "status" | "error">[];
}): Promise<void> {
  const { run } = input;
  const alerts = alertsFor(run);
  if (!alerts.inbox && !alerts.errorWorkflows) return;

  try {
    const workflow =
      input.workflow ??
      (await db().select().from(workflows).where(eq(workflows.id, run.workflowId)).limit(1))[0];
    if (!workflow) return;

    // The step it stopped at, read the way a diagnosis reads it (`generate/evidence.ts`).
    const steps = input.steps ?? (await readSteps(run.id)).map(toStepRecord);
    const stopped = stoppedStep([...steps].sort((a, b) => a.seq - b.seq));
    const graphNode = stopped && workflow.graph.nodes.find((node) => node.id === stopped.nodeId);
    const label = stopped ? graphNode?.label || getNode(stopped.nodeType)?.label || stopped.nodeId : null;

    const told = alerts.inbox
      ? await recordFailure({
          workspaceId: run.workspaceId,
          workflowId: workflow.id,
          runId: run.id,
          error: stopped?.error ? `${label}: ${stopped.error}` : run.error,
        })
      : 0;

    let started = 0;
    let beyond = 0;
    if (alerts.errorWorkflows) {
      const payload = failurePayload({
        baseUrl: required("APP_BASE_URL"),
        workflow,
        run,
        step: stopped && { nodeId: stopped.nodeId, nodeType: stopped.nodeType, label: label!, error: stopped.error },
      });
      const targets = await errorWorkflowsFor(workflow);
      beyond = Math.max(0, targets.length - MAX_ERROR_WORKFLOWS);
      for (const target of targets.slice(0, MAX_ERROR_WORKFLOWS)) {
        try {
          await startDurableRun({ scope: systemScope(target), workflow: target, trigger: "error", input: payload });
          started += 1;
        } catch (error) {
          logError("run.alerted", `Error workflow ${target.id} could not be started for run ${run.id}.`, error, {
            errorWorkflowId: target.id,
          });
        }
      }
    }

    logInfo("run.alerted", `Run ${run.id} failed with nobody watching; ${told} told, ${started} error workflow(s) started.`, {
      failedRunId: run.id,
      trigger: run.trigger,
      inboxes: told,
      errorWorkflows: started,
      ...(beyond > 0 ? { errorWorkflowsNotStarted: beyond } : {}),
    });
  } catch (error) {
    logError("run.alerted", `Run ${run.id} failed and could not be announced.`, error, { failedRunId: run.id });
  }
}

/**
 * The workspace's error workflows that may hear about `failed`: active, holding the error trigger,
 * not `failed` itself, and authored by somebody who is still a member and may see `failed` (D101).
 * Oldest first, one past the cap so the caller can say how many it left out.
 *
 * The graph test is `jsonb` containment — a workspace has tens of workflows, and the statement opens
 * on `workflow_workspace_idx` — written as literal SQL because the column sits beside a join.
 */
async function errorWorkflowsFor(failed: Workflow): Promise<Workflow[]> {
  const rows = await db()
    .select({ workflow: workflows, role: workspaceMembers.role })
    .from(workflows)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workflows.workspaceId), eq(workspaceMembers.userId, workflows.ownerId)),
    )
    .where(
      and(
        eq(workflows.workspaceId, failed.workspaceId),
        eq(workflows.active, true),
        ne(workflows.id, failed.id),
        sql`"workflow"."graph" @> ${JSON.stringify({ nodes: [{ type: ERROR_TRIGGER_TYPE }] })}::jsonb`,
      ),
    )
    .orderBy(asc(workflows.createdAt))
    .limit(MAX_ERROR_WORKFLOWS + 1);

  return rows
    .filter((row) => canSeeWorkflow({ role: row.role, userId: row.workflow.ownerId }, failed))
    .map((row) => row.workflow);
}

/**
 * Fail the runs nothing is coming back for (`lease.ts` → `sweepAbandonedRuns`), and announce each
 * failure as any other is announced — an interrupted webhook run is still a failure nobody saw.
 * Every caller sweeps through here. Answers how many it failed.
 */
export async function sweepRuns(scope?: WorkspaceScope): Promise<number> {
  const swept: SweptRun[] = await sweepAbandonedRuns(scope);
  for (const run of swept) await announceFailure({ run });
  return swept.length;
}

/** What a `node` test's target is fed, with a line for its log saying where it came from. */
export interface NodeTestSeed {
  input: unknown;
  outputs: ReadonlyMap<string, unknown>;
  trigger: unknown;
  notes: string[];
}

/**
 * **Feed a node tested alone — Phase 31, `CONTRACT.md` → *Partial runs*.** Each upstream node's
 * value is its pin, or what it passed through switched off, or its most recent recorded
 * output among this workflow's last `RECORDED_RUNS` runs (`partial.ts` → `seedNode`). One
 * statement, opening on `run_workflow_idx`; a person pressing a button has already woken the
 * database, so it adds no wake.
 *
 * A target with something upstream and no value from any of it is refused: run with nothing
 * where its input should be, it would answer a question nobody asked.
 */
export async function seedFor(workflow: Workflow, target: string): Promise<NodeTestSeed> {
  const graph = workflow.graph;
  const node = graph.nodes.find((candidate) => candidate.id === target);
  if (!node) throw new ApiError("not_found", `There is no node "${target}" in this workflow.`);

  const name = (id: string) => {
    const found = graph.nodes.find((candidate) => candidate.id === id);
    return `"${found?.label || getNode(found?.type ?? "")?.label || id}"`;
  };

  const upstream = [...upstreamOf(graph, target)].filter((id) => id !== target);
  const recorded = await recordedOutputs(workflow, upstream);

  const seed = seedNode(
    graph,
    target,
    getNode,
    new Map([...recorded].map(([id, entry]) => [id, entry.output])),
  );

  const feeds = graph.edges.some((edge) => edge.target === target);
  if (feeds && !seed.from) {
    throw new ApiError(
      "invalid_request",
      `Nothing to feed ${name(target)} yet: the steps before it have not run and hold no pinned output. Test up to here instead, or pin the output of the step before it.`,
    );
  }

  const notes: string[] = [];
  if (seed.from) {
    const when = recorded.get(seed.from.nodeId)?.at;
    notes.push(
      seed.from.source === "pinned"
        ? `Tested alone. Its input is the pinned output of ${name(seed.from.nodeId)}.`
        : `Tested alone. Its input is what ${name(seed.from.nodeId)} produced in an earlier run${when ? ` (${formatUtcShort(when)})` : ""}.`,
    );
  } else {
    notes.push("Tested alone, with nothing upstream to feed it.");
  }
  if (seed.missing.length > 0) {
    notes.push(
      `Nothing on record for ${seed.missing.map(name).join(", ")} — a reference to ${seed.missing.length === 1 ? "it" : "them"} resolves empty.`,
    );
  }

  return { input: seed.input, outputs: seed.outputs, trigger: seed.trigger?.value ?? null, notes };
}

function formatUtcShort(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Each node's most recent succeeded output among the workflow's last `RECORDED_RUNS` runs. */
async function recordedOutputs(
  workflow: Workflow,
  nodeIds: readonly string[],
): Promise<Map<string, { output: unknown; at: Date }>> {
  if (nodeIds.length === 0) return new Map();

  const recent = db()
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.workspaceId, workflow.workspaceId), eq(runs.workflowId, workflow.id)))
    .orderBy(desc(runs.startedAt))
    .limit(RECORDED_RUNS);

  const rows = await db()
    .selectDistinctOn([runSteps.nodeId], {
      nodeId: runSteps.nodeId,
      output: runSteps.output,
      at: runs.startedAt,
    })
    .from(runSteps)
    .innerJoin(runs, eq(runs.id, runSteps.runId))
    .where(
      and(
        inArray(runSteps.runId, recent),
        eq(runSteps.status, "succeeded"),
        inArray(runSteps.nodeId, [...nodeIds]),
      ),
    )
    .orderBy(runSteps.nodeId, desc(runs.startedAt), desc(runSteps.seq));

  return new Map(rows.map((row) => [row.nodeId, { output: row.output, at: row.at }]));
}

/** A persisted step row as the engine's own record type, for resuming — and, since Phase 33, retrying. */
export function toStepRecord(step: RunStep): StepRecord {
  return {
    seq: step.seq,
    nodeId: step.nodeId,
    nodeType: step.nodeType,
    iteration: step.iteration,
    status: step.status,
    config: step.config,
    input: step.input,
    output: step.output,
    branch: step.branch,
    logs: step.logs ?? [],
    error: step.error,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
  };
}

/**
 * **Phase 20 — the run reads that do not go through `getWorkflow`.**
 *
 * Every other workflow-scoped route reaches its rows by calling `getWorkflow` first, so
 * the visibility filter in that one function covers versions, per-workflow run lists, the
 * SSE stream and execution without any of them knowing about it. The exceptions are the
 * reads addressed by *run* id or across the workspace — `getRun` here, and since Phase 33 the
 * history in `lib/runs/history.ts` — because a run carries the name of its workflow. Left
 * alone, a viewer would read the steps, inputs and outputs of a colleague's private workflow by
 * asking about its runs.
 *
 * So each joins `workflow` and applies the same predicate. The join is free — it is an
 * equality on a primary key — and it can never drop a row it should have kept, because
 * `run.workflowId` cascades on delete, so there is no run whose workflow is missing.
 */
export async function getRun(
  scope: WorkspaceScope,
  runId: string,
): Promise<{ run: Run; steps: RunStep[] }> {
  const [row] = await db()
    .select({ run: runs })
    .from(runs)
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(
      and(eq(runs.id, runId), eq(runs.workspaceId, scope.workspaceId), visibleWorkflows(scope)),
    )
    .limit(1);

  const run = row?.run;
  if (!run) throw new ApiError("not_found", "No such run.");

  const steps = await db()
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.seq));

  return { run, steps };
}

/**
 * The newest run of a workflow, row only. The SSE stream calls this every poll, so
 * it deliberately does not read steps and does not sweep: one statement, no writes.
 */
export async function latestRun(
  scope: WorkspaceScope,
  workflowId: string,
): Promise<Run | null> {
  const [run] = await db()
    .select()
    .from(runs)
    .where(and(eq(runs.workspaceId, scope.workspaceId), eq(runs.workflowId, workflowId)))
    .orderBy(desc(runs.startedAt))
    .limit(1);

  return run ?? null;
}

export async function readSteps(runId: string): Promise<RunStep[]> {
  return db()
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.seq));
}

/**
 * A run of this workflow that is genuinely still in flight, for a page load that lands
 * mid-run. A read, never a write: rendering a page must not sweep.
 *
 * **"In flight" is now the lease, not a heartbeat window.** Chapter 1 asked whether the
 * heartbeat was younger than five minutes, which was the best available proxy. The
 * lease answers the question exactly — a run with a live lease has a worker on it right
 * now — and it covers the case the proxy could not: a `queued` durable run, which has
 * no heartbeat to speak of because nothing has executed it yet, but is absolutely
 * about to run and must appear on the canvas.
 */
export async function liveRun(
  scope: WorkspaceScope,
  workflowId: string,
): Promise<{ run: Run; steps: RunStep[] } | null> {
  const [run] = await db()
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, scope.workspaceId),
        eq(runs.workflowId, workflowId),
        or(
          and(
            inArray(runs.status, ["queued", "running"]),
            gt(sql`coalesce(${runs.leaseExpiresAt}, ${runs.startedAt} + interval '2 minutes')`, sql`now()`),
          ),
          // Phase 26. A waiting run has no lease by design and is still this workflow's
          // story — a page opened during a two-day wait must show it, not an empty canvas.
          eq(runs.status, "waiting"),
        ),
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(1);

  if (!run) return null;
  return { run, steps: await readSteps(run.id) };
}

export function describeRun(run: Run, steps?: RunStep[]) {
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    trigger: run.trigger,
    mode: run.mode,
    /** How many deliveries this run has had. Above 1 means it resumed after a failure. */
    attempt: run.attempt,
    /** A stop was asked for. The engine acts on it at its next step boundary. */
    cancelRequested: run.cancelRequestedAt !== null,
    /** Phase 26: when a `waiting` run resumes. Null in every other status. */
    wakeAt: run.wakeAt?.toISOString() ?? null,
    /**
     * Phase 38: what a `waiting` run is waiting for — a person's decision, or the end of a delay —
     * read off its cursor. Null in every other status.
     */
    waitingFor: run.status === "waiting" ? (readCursor(run.cursor)?.approval ? ("approval" as const) : ("delay" as const)) : null,
    /** Phase 31: whether this run is a test, and of what. Null on a real run. */
    test: run.test ?? null,
    /** Phase 33: the run this one was re-run or retried from. Null on an ordinary run. */
    origin: run.origin ?? null,
    /** Phase 39: the run that called this one and the node that made the call. Null on a run nothing called. */
    parent: run.parentRunId ? { runId: run.parentRunId, nodeId: run.parentNodeId ?? "" } : null,
    /** Phase 37: how many failures its on-error policies handled. 0 on almost every run. */
    handled: run.handled,
    /**
     * The workflow version this run executed (Phase 18). Null for a run recorded
     * before versioning existed — it is not claimed to be v1, because it is unknown.
     */
    workflowVersion: run.workflowVersion,
    input: run.input,
    output: run.output,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    durationMs: run.finishedAt
      ? run.finishedAt.getTime() - run.startedAt.getTime()
      : null,
    ...(steps
      ? {
          steps: steps.map((step) => ({
            seq: step.seq,
            nodeId: step.nodeId,
            nodeType: step.nodeType,
            iteration: step.iteration,
            status: step.status,
            config: step.config,
            input: step.input,
            output: step.output,
            branch: step.branch,
            logs: step.logs,
            error: step.error,
            startedAt: step.startedAt?.toISOString() ?? null,
            finishedAt: step.finishedAt?.toISOString() ?? null,
          })),
        }
      : {}),
  };
}
