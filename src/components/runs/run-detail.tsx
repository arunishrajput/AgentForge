"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NodeIcon } from "@/components/canvas/node-icon";
import { ApprovalCard } from "@/components/runs/approval-card";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/notice";
import { APPROVAL_TYPE, askingOf } from "@/lib/approvals/rules";
import {
  api,
  ApiRequestError,
  type CallLink,
  type NodeSummary,
  type Run,
  type RunSummary,
  type StepBodies,
  type StepHeader,
} from "@/lib/canvas/client";
import { useRunStream } from "@/lib/canvas/run-stream";
import { nodeStatusLook, runStatusLook, stepErrorTone } from "@/lib/canvas/status";
import { testLabel } from "@/lib/canvas/test-run";
import { rerunnable } from "@/lib/engine/retry";
import { elapsedMs, formatDuration, formatOffset } from "@/lib/format/duration";
import { formatUtc } from "@/lib/format/date";
import { handledWords, originWords, retryTally, shortRunId, TRIGGER_WORDS } from "@/lib/runs/words";
import type { WorkflowGraph } from "@/lib/workflow/graph";

import { RunCanvas } from "./run-canvas";

/**
 * **One run, whole — Phase 33.** The graph it executed with its statuses painted on, every step it
 * took with its logs, and — when a step is opened — what that step was given, ran with and
 * produced. The page an analytics failure links to, and the one *re-run* and *retry* land on.
 *
 * **Bodies load when a step is opened** (`runs/history.ts`, rule 2), from
 * `GET /api/runs/:id/steps/:seq`. A run still going is followed live over the workflow's stream,
 * pinned to this run (D28) and stopping when it is over (`once`); the stream carries bodies, so a
 * step that streamed in needs no second request.
 *
 * Re-run and retry are **queued** (`durable`), and the page goes to the new run at once and
 * watches it there: the alternative — a button that holds a request open for the whole run — is a
 * page that looks frozen for two minutes.
 */

type DetailStep = StepHeader & { bodies?: StepBodies };

const RESTING = new Set(["succeeded", "failed", "cancelled", "waiting"]);

function fromStream(run: Run, workflowName: string): { run: RunSummary; steps: DetailStep[] } {
  return {
    run: {
      id: run.id,
      workflowId: run.workflowId,
      workflowName,
      status: run.status,
      trigger: run.trigger,
      mode: run.mode,
      attempt: run.attempt,
      cancelRequested: run.cancelRequested,
      wakeAt: run.wakeAt,
      test: run.test,
      origin: run.origin,
      parent: run.parent,
      handled: run.handled,
      workflowVersion: run.workflowVersion,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
    },
    steps: (run.steps ?? []).map((step) => ({
      seq: step.seq,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      iteration: step.iteration,
      status: step.status,
      branch: step.branch,
      logs: step.logs ?? [],
      error: step.error,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      bodies: { seq: step.seq, config: step.config, input: step.input, output: step.output },
    })),
  };
}

export function RunDetail({
  initial,
  workflow,
  graph,
  graphSource,
  registry,
  calls,
  canEdit,
}: {
  initial: { run: RunSummary; steps: StepHeader[] };
  workflow: { id: string; name: string; version: number };
  graph: WorkflowGraph;
  /** Whether `graph` is the version this run executed, or — that version gone — the current one. */
  graphSource: "version" | "current";
  registry: NodeSummary[];
  /** Phase 39: the run that called this one, and the runs it called. */
  calls: { calledBy: CallLink | null; called: CallLink[] };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [base, setBase] = useState(initial);
  const stream = useRunStream(workflow.id, null);
  const { watch } = stream;

  // Follow a run that is still going, pinned to it. Once, on arrival: a finished run has nothing
  // to stream, and a run that finishes while this page is open stops its own stream.
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current || RESTING.has(initial.run.status)) return;
    attached.current = true;
    watch({ runId: initial.run.id, once: true });
  }, [initial.run.id, initial.run.status, watch]);

  const streamed = useMemo(
    () => (stream.run?.id === initial.run.id ? fromStream(stream.run, workflow.name) : null),
    [initial.run.id, stream.run, workflow.name],
  );
  const { run, steps } = streamed ?? base;

  // Phase 39: the runs this one called are read with the page, and a run that was going when the page
  // opened calls them as it goes. When it comes to rest, read them again — once.
  const wasUnfinished = useRef(!RESTING.has(initial.run.status));
  useEffect(() => {
    if (wasUnfinished.current && RESTING.has(run.status)) {
      wasUnfinished.current = false;
      router.refresh();
    }
  }, [router, run.status]);
  // One object per change of what is painted, so the canvas's memos hold between renders.
  const canvasRun = useMemo(() => ({ status: run.status, steps }), [run.status, steps]);

  const lookup = useMemo(() => new Map(registry.map((node) => [node.type, node])), [registry]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of graph.nodes) map.set(node.id, node.label || lookup.get(node.type)?.label || node.type);
    return map;
  }, [graph, lookup]);

  /** Steps opened by a click on the canvas — the list opens and scrolls to them. */
  const [opened, setOpened] = useState<{ seq: number; at: number } | null>(null);
  const selectNode = useCallback(
    (nodeId: string) => {
      const step = steps.find((candidate) => candidate.nodeId === nodeId);
      if (step) setOpened({ seq: step.seq, at: Date.now() });
    },
    [steps],
  );

  const look = runStatusLook(run.status);
  const test = testLabel(run.test, names);
  const origin = originWords(run.origin);
  const partialTest = run.test !== null && run.test.scope !== "workflow";
  const unfinished = run.status === "queued" || run.status === "running" || run.status === "waiting";
  const tally = run.origin?.kind === "retry" ? retryTally(steps) : null;
  // Phase 38: what a waiting run waits on — a person, when one of its steps is an approval still asking.
  const awaitsDecision = steps.some((step) => step.nodeType === APPROVAL_TYPE && step.status === "running");

  const [busy, setBusy] = useState<"rerun" | "retry" | "stop" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const restart = async (kind: "rerun" | "retry") => {
    setBusy(kind);
    setFailure(null);
    try {
      const started = await api.restartRun(run.id, kind, "durable");
      router.push(`/runs/${started.id}`);
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error.message : "The run could not be started.");
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    setFailure(null);
    try {
      const after = await api.cancelRun(run.id);
      setBase((current) => ({ ...current, run: fromStream(after, workflow.name).run }));
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error.message : "The run could not be stopped.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <nav aria-label="Breadcrumb" className="animate-rise text-muted mb-3 text-xs">
        <Link href="/runs" className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
          Runs
        </Link>
        <span aria-hidden="true"> / </span>
        <Link
          href={`/runs?workflow=${encodeURIComponent(workflow.id)}`}
          className="inline-flex min-h-6 items-center underline underline-offset-2"
        >
          {workflow.name}
        </Link>
      </nav>

      <div className="animate-rise mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow">
            Run <span className="font-mono normal-case">{shortRunId(run.id)}</span>
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-pretty break-words">{workflow.name}</h1>
          <p className="text-muted mt-1 text-sm">
            {TRIGGER_WORDS[run.trigger]} · started {formatUtc(run.startedAt)}
            {run.durationMs !== null && <> · took {formatDuration(run.durationMs)}</>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && rerunnable(run.status) && (
            <>
              {run.status === "failed" && !partialTest && (
                <Button
                  tone="primary"
                  loading={busy === "retry"}
                  disabled={busy !== null && busy !== "retry"}
                  onClick={() => void restart("retry")}
                >
                  Retry from failed step
                </Button>
              )}
              <Button
                loading={busy === "rerun"}
                disabled={busy !== null && busy !== "rerun"}
                onClick={() => void restart("rerun")}
              >
                {partialTest ? "Test again" : "Re-run"}
              </Button>
            </>
          )}
          {canEdit && unfinished && !run.cancelRequested && (
            <Button tone="danger" loading={busy === "stop"} onClick={() => void stop()}>
              Stop
            </Button>
          )}
          {/* Phase 36 (D170). On the canvas, not here: the answer can be a fix, and a fix is a
              proposal — it needs the canvas to be shown as a diff and accepted on. */}
          {canEdit && run.status === "failed" && (
            <Link
              href={`/workflows/${workflow.id}?diagnose=${encodeURIComponent(run.id)}`}
              className="btn btn-quiet"
              title="Opens the workflow with the copilot diagnosing this run"
            >
              <span aria-hidden="true">✦</span>
              Why did this fail?
            </Link>
          )}
          <Link href={`/workflows/${workflow.id}`} className="btn btn-quiet">
            Open workflow
          </Link>
        </div>
      </div>

      <div className="animate-rise mb-4 flex flex-wrap items-center gap-1.5">
        <span key={run.status} className={cn("chip", look.tone, look.motion)}>
          {look.dots ? <Spinner className="text-live" /> : <span aria-hidden="true">{look.glyph}</span>}
          {unfinished && run.cancelRequested ? "Stopping" : look.label}
        </span>
        {run.mode === "durable" && (
          <Badge icon={<span aria-hidden="true">⇄</span>} title="Queued: survives a restart">
            Durable
          </Badge>
        )}
        {run.workflowVersion !== null && (
          <Badge className="font-mono" title="The workflow version this run executed">
            v{run.workflowVersion}
          </Badge>
        )}
        {test && (
          <Badge tone="outline" icon={<span aria-hidden="true">◇</span>} title="A test run — left out of analytics">
            {test}
          </Badge>
        )}
        {run.origin && (
          <Link
            href={`/runs/${run.origin.runId}`}
            className="chip text-ink min-h-6 bg-transparent underline-offset-2 hover:underline"
          >
            <span aria-hidden="true">↺</span>
            {origin}
          </Link>
        )}
        {run.parent &&
          (calls.calledBy ? (
            <Link
              href={`/runs/${calls.calledBy.id}`}
              className="chip text-ink min-h-6 bg-transparent underline-offset-2 hover:underline"
              title={`Run ${calls.calledBy.id}`}
            >
              <span aria-hidden="true">⤴</span>
              Called by {calls.calledBy.workflowName} · run {shortRunId(calls.calledBy.id)}
            </Link>
          ) : (
            <Badge icon={<span aria-hidden="true">⤴</span>} title="Retention removed it, or it belongs to a workflow you cannot see">
              Called by run {shortRunId(run.parent.runId)}
            </Badge>
          ))}
        {run.attempt > 1 && (
          <Badge icon={<span aria-hidden="true">↻</span>}>Resumed {run.attempt - 1}×</Badge>
        )}
        {/* Phase 37 (D175): what its on-error policies handled on the way. */}
        {handledWords(run.handled) && (
          <span className="chip text-warn">
            <span aria-hidden="true">↪</span>
            {handledWords(run.handled)}
          </span>
        )}
        {stream.live && <span className="text-live text-2xs font-semibold">Live</span>}
      </div>

      <div className="mb-4 space-y-2" aria-live="polite">
        {failure && <Notice tone="bad" title={failure} />}
        {run.status === "waiting" && run.wakeAt && (awaitsDecision ? (
          // Phase 38. Paused on a person; the clock is only the timeout.
          <Notice tone="info" title="Waiting for a decision">
            The run asked a person and is paused until they decide, or until {formatUtc(run.wakeAt)}, when its
            timeout decides. Nothing is running or held open in the meantime.
          </Notice>
        ) : (
          <Notice tone="info" title={`Waiting until ${formatUtc(run.wakeAt)}`}>
            The run is paused at a delay and resumes on its own then. Nothing is running or held open
            in the meantime.
          </Notice>
        ))}
        {run.error &&
          (run.status === "cancelled" ? (
            <Notice tone="warn" title="The run was cancelled">{run.error}</Notice>
          ) : (
            <Notice tone="bad" title="The run failed">{run.error}</Notice>
          ))}
        {tally && (
          <Notice tone="info" title={`${tally.reused} step${tally.reused === 1 ? "" : "s"} reused, not run again`}>
            This run retried{" "}
            <Link href={`/runs/${run.origin!.runId}`} className="font-semibold underline underline-offset-2">
              run {shortRunId(run.origin!.runId)}
            </Link>{" "}
            from the step it failed at. The steps marked <strong>Reused</strong> carry that run&rsquo;s results;{" "}
            {tally.ran} step{tally.ran === 1 ? " was" : "s were"} executed here.
          </Notice>
        )}
        <VersionNote run={run} workflow={workflow} graphSource={graphSource} />
      </div>

      <section aria-label="The graph this run executed" className="card animate-rise mb-6 h-80 overflow-hidden p-0 sm:h-96">
        <RunCanvas graph={graph} registry={registry} run={canvasRun} onSelectNode={selectNode} />
      </section>

      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="eyebrow mb-2">
          Steps <span className="text-faint normal-case">· {steps.length}</span>
        </h2>
        {steps.length === 0 ? (
          <p className="text-muted text-sm">
            {run.status === "queued"
              ? "On the queue. A worker will pick this up in a moment, and every step will appear here as it happens."
              : run.status === "running"
                ? "Waiting for the first node to report."
                : "This run recorded no steps."}
          </p>
        ) : (
          <ol className="space-y-2">
            {steps.map((step) => (
              <StepCard
                key={step.seq}
                runId={run.id}
                step={step}
                name={names.get(step.nodeId)}
                definition={lookup.get(step.nodeType)}
                called={calls.called.filter((link) => link.nodeId === step.nodeId)}
                paused={run.status === "waiting" && step.status === "running"}
                opened={opened?.seq === step.seq ? opened.at : null}
                // Phase 38: a decision made here wakes the run — follow it as it resumes.
                onDecided={() => watch({ runId: run.id, once: true })}
              />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

/**
 * Which graph is on screen, said when it matters: the version the run executed when that is not
 * the workflow's current one — a re-run or retry runs the current one (D151) — and the current
 * graph standing in when the run's version is no longer kept.
 */
function VersionNote({
  run,
  workflow,
  graphSource,
}: {
  run: RunSummary;
  workflow: { version: number };
  graphSource: "version" | "current";
}) {
  if (run.workflowVersion === null) {
    return (
      <Notice tone="info" title="Shown on the current graph">
        This run is older than version history, so which version it executed is not recorded.
      </Notice>
    );
  }
  if (graphSource === "current" && run.workflowVersion !== workflow.version) {
    return (
      <Notice tone="info" title={`Shown on v${workflow.version}, not v${run.workflowVersion}`}>
        The version this run executed is no longer kept, so the graph below is the current one and may
        not match the steps exactly.
      </Notice>
    );
  }
  if (run.workflowVersion !== workflow.version) {
    return (
      <Notice tone="info" title={`This run executed v${run.workflowVersion}`}>
        The workflow is v{workflow.version} now. The graph below is the one this run executed; a re-run
        or a retry runs v{workflow.version}.
      </Notice>
    );
  }
  return null;
}

function StepCard({
  runId,
  step,
  name,
  definition,
  called,
  paused,
  opened,
  onDecided,
}: {
  runId: string;
  step: DetailStep;
  name: string | undefined;
  definition: NodeSummary | undefined;
  /** The runs this step started — a Call workflow step's, or an agent's tool calls (Phase 39). */
  called: CallLink[];
  paused: boolean;
  /** When a click on the canvas opened this step — a new value scrolls to it again. */
  opened: number | null;
  onDecided?: () => void;
}) {
  const look = nodeStatusLook(step.status, definition?.category === "agent", paused);
  const duration = elapsedMs(step.startedAt, step.finishedAt);
  const item = useRef<HTMLLIElement>(null);
  const details = useRef<HTMLDetailsElement>(null);

  const [bodies, setBodies] = useState<StepBodies | null>(step.bodies ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = step.bodies ?? bodies;
  // A step that never ran has nothing to open: no config was resolved and nothing arrived.
  const hasBodies = step.status !== "skipped";

  const load = useCallback(async () => {
    if (shown || loading) return;
    setLoading(true);
    setError(null);
    try {
      setBodies(await api.getStepBodies(runId, step.seq));
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "This step's details could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [loading, runId, shown, step.seq]);

  // Phase 38: an approval still waiting needs its request's id, which is on its output — read it now,
  // once, rather than when somebody opens the step's details.
  const waitingApproval = step.nodeType === APPROVAL_TYPE && step.status === "running";
  useEffect(() => {
    if (waitingApproval) void load();
    // `load` changes identity as it loads; the step's own waiting state is what this follows.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingApproval]);
  const asking = waitingApproval && shown ? askingOf({ nodeType: step.nodeType, status: step.status, output: shown.output }) : null;

  useEffect(() => {
    if (opened === null || !item.current) return;
    item.current.scrollIntoView({ block: "center", behavior: "smooth" });
    item.current.focus({ preventScroll: true });
    if (details.current && hasBodies) details.current.open = true;
  }, [hasBodies, opened]);

  const logs = step.logs ?? [];

  return (
    <li
      ref={item}
      id={`step-${step.seq}`}
      tabIndex={-1}
      className={cn("card overflow-hidden p-0", opened !== null && "ring-ink ring-2")}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span className="text-faint w-5 shrink-0 pt-0.5 font-mono text-2xs tabular-nums">{step.seq}</span>
        <NodeIcon type={step.nodeType} category={definition?.category} className="text-muted mt-0.5 size-4" />
        <span className="min-w-0 flex-1">
          <span className="text-ui block truncate font-bold">{name ?? definition?.label ?? step.nodeType}</span>
          <span className="text-muted block truncate font-mono text-3xs">
            {step.nodeId}
            {step.iteration > 0 && ` · pass ${step.iteration + 1}`}
            {step.branch !== null && ` · → ${step.branch}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("chip", look.tone, look.motion)}>
            {look.dots ? <Spinner className="text-live" /> : <span aria-hidden="true">{look.glyph}</span>}
            {look.label}
          </span>
          {duration !== null && (
            <span className="text-faint font-mono text-3xs tabular-nums">{formatDuration(duration)}</span>
          )}
        </span>
      </div>

      {step.error && (
        <p className={cn(stepErrorTone(step.status), "border-line-soft border-t px-3 py-2 text-2xs leading-relaxed break-words")}>{step.error}</p>
      )}

      {called.length > 0 && (
        <ul className="border-line-soft space-y-1 border-t px-3 py-2" aria-label="Runs this step started">
          {called.map((link) => {
            const linkLook = runStatusLook(link.status);
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span aria-hidden="true" className="text-muted">⤵</span>
                <Link
                  href={`/runs/${link.id}`}
                  className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2"
                >
                  {link.workflowName}
                </Link>
                <span className="text-faint font-mono text-3xs">run {shortRunId(link.id)}</span>
                <span className={cn("chip", linkLook.tone)}>
                  <span aria-hidden="true">{linkLook.glyph}</span>
                  {linkLook.label}
                </span>
                {link.trigger === "agent" && <span className="text-muted text-2xs">as an agent tool</span>}
                {link.durationMs !== null && (
                  <span className="text-faint font-mono text-3xs tabular-nums">{formatDuration(link.durationMs)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {asking && <ApprovalCard approvalId={asking.approvalId} asked={asking} onDecided={onDecided} />}

      {logs.length > 0 && (
        <ul className="bg-sunken border-line-soft space-y-1 border-t px-3 py-2">
          {logs.map((log, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-faint w-11 shrink-0 font-mono text-3xs tabular-nums">
                {formatOffset(step.startedAt, log.at)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 text-xs leading-relaxed break-words",
                  log.level === "error" ? "text-bad" : log.level === "warn" ? "text-warn" : "text-ink",
                )}
              >
                {log.level !== "info" && (
                  <span className="font-bold">{log.level === "warn" ? "Warning: " : "Error: "}</span>
                )}
                {log.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasBodies && (
        <details
          ref={details}
          className="border-line-soft group border-t"
          onToggle={(event) => {
            if ((event.currentTarget as HTMLDetailsElement).open) void load();
          }}
        >
          <summary className="text-muted hover:text-ink cursor-pointer px-3 py-2 text-2xs font-semibold select-none">
            Config, input and output
          </summary>
          <div className="space-y-2 px-3 pb-3">
            {loading && (
              <p className="text-muted flex items-center gap-2 text-2xs">
                <Spinner /> Loading this step&rsquo;s details…
              </p>
            )}
            {error && <Notice tone="bad" title={error} />}
            {shown && (
              <>
                <Body title="Input" value={shown.input} />
                <Body title="Config, as it ran" value={shown.config} />
                <Body title="Output" value={shown.output} />
              </>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

function Body({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="eyebrow mb-1">{title}</h3>
      {value === null || value === undefined ? (
        <p className="text-faint text-2xs">Nothing.</p>
      ) : (
        <pre className="relative bg-sunken border-line max-h-80 overflow-auto rounded-lg border-2 p-2.5 font-mono text-2xs leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </section>
  );
}
