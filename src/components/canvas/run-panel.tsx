"use client";

import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/notice";
import type { Run, RunStep } from "@/lib/canvas/client";
import { nodeStatusLook, runStatusLook } from "@/lib/canvas/status";
import { elapsedMs, formatDuration, formatOffset } from "@/lib/format/duration";

import { useCanvas } from "./context";
import { NodeIcon } from "./node-icon";

/**
 * The run panel: what happened, step by step.
 *
 * `BUILD_PLAN.md` Phase 16 asks for "a run panel where agent reasoning is pleasant
 * to read", and the agent's reasoning is its **log lines** — `ai.agent` emits
 * "Asking gemini-3-flash-preview…", "Decision: publish.", "[sheets] appended row 2".
 * In Chapter 1 those rendered as 11px muted text, indented inside the same button as
 * the step's title, with no indication of when any of it happened. Three things
 * changed, and each is why this file is not a restyle:
 *
 *  1. **A step is named, not identified.** The heading was the raw `nodeId` —
 *     `agent_2`. It is now the node's own label, with the id kept in mono beneath it,
 *     because a person reading a run is looking for "Decide the topic" and a person
 *     debugging one wants the id. Both, in that order of prominence.
 *  2. **Every log line carries its offset from the step's start** (`+3.4s`). This is
 *     what turns a column of sentences into a sequence: it shows which decision was
 *     instant and which one cost four seconds, which is the single most useful thing
 *     about watching an agent work.
 *  3. **The log block is not inside the button.** Only the step's header row selects
 *     the node. Reasoning you might want to copy should not be a click target, and a
 *     button wrapping eight lines of text has no honest accessible name.
 *
 * **No mascot here, deliberately.** `DESIGN.md` allows Sparky as a small thinking
 * indicator but forbids it in the quiet register, and names a log as the quiet
 * register. A running step gets the bobbing dots in its status chip, which is the
 * same `waiting` motion without putting a face in a log.
 */
export function RunPanel({
  run,
  live,
  names,
  onSelectNode,
}: {
  run: Run;
  /** A stream is open — the panel is watching, not showing history. */
  live: boolean;
  /** Node id → the label the canvas shows for it. */
  names: Map<string, string>;
  onSelectNode: (id: string) => void;
}) {
  const look = runStatusLook(run.status);
  const steps = run.steps ?? [];
  const unfinished = run.status === "queued" || run.status === "running";

  return (
    <section className="space-y-3">
      <div className="card flex flex-wrap items-center gap-x-2 gap-y-1.5 p-2.5">
        <span key={run.status} className={cn("chip shrink-0", look.tone, look.motion)}>
          {look.dots ? <BobbingDots /> : <span aria-hidden="true">{look.glyph}</span>}
          {/* A stop that has been asked for but not yet reached is neither "Running" nor
              "Cancelled", and saying "Running" is what makes a Stop button look ignored.
              The engine acts on it at the next step boundary, so this is literally true. */}
          {unfinished && run.cancelRequested ? "Stopping" : look.label}
        </span>

        {/* Durability is invisible otherwise, and it is the one property of a run that
            a person cannot infer from watching it — right up until the server restarts. */}
        {run.mode === "durable" && (
          <span className="chip text-muted shrink-0" title="Queued: survives a restart">
            <span aria-hidden="true">⇄</span>
            Durable
          </span>
        )}

        {/* Above one delivery means this run was interrupted and carried on. Worth stating
            plainly: a run that took 40 seconds because it resumed twice is a different
            story from one that took 40 seconds of work. */}
        {run.attempt > 1 && (
          <span className="chip text-muted shrink-0">
            <span aria-hidden="true">↻</span>
            Resumed {run.attempt - 1}×
          </span>
        )}

        <span className="text-muted ml-auto shrink-0 font-mono text-2xs">
          {run.durationMs !== null
            ? formatDuration(run.durationMs)
            : live
              ? "streaming"
              : run.status === "queued"
                ? "waiting"
                : "in flight"}
        </span>
      </div>

      {run.error &&
        (run.status === "cancelled" ? (
          <Notice tone="warn" title="The run was cancelled">{run.error}</Notice>
        ) : (
          <Notice tone="bad" title="The run failed">{run.error}</Notice>
        ))}

      {steps.length === 0 ? (
        <p className="text-muted text-xs leading-relaxed">
          {run.status === "queued"
            ? "On the queue. A worker will pick this up in a moment, and every step will appear here as it happens."
            : run.status === "running"
              ? "Waiting for the first node to report."
              : "This run recorded no steps."}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {steps.map((step) => (
            <Step
              key={step.seq}
              step={step}
              name={names.get(step.nodeId)}
              onSelect={() => onSelectNode(step.nodeId)}
            />
          ))}
        </ol>
      )}

      {run.output !== null && run.output !== undefined && (
        <section>
          <h3 className="eyebrow mb-1.5">Output</h3>
          <pre className="bg-sunken border-line overflow-x-auto rounded-lg border-2 p-2.5 font-mono text-2xs leading-relaxed">
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </section>
      )}
    </section>
  );
}

function Step({
  step,
  name,
  onSelect,
}: {
  step: RunStep;
  name: string | undefined;
  onSelect: () => void;
}) {
  const { registry } = useCanvas();
  const definition = registry.get(step.nodeType);
  const look = nodeStatusLook(step.status, definition?.category === "agent");
  const duration = elapsedMs(step.startedAt, step.finishedAt);
  const logs = step.logs ?? [];

  return (
    <li className="card overflow-hidden p-0">
      <button
        type="button"
        onClick={onSelect}
        className="hover:bg-canvas flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors duration-100"
      >
        <span className="text-faint w-4 shrink-0 pt-0.5 font-mono text-2xs tabular-nums">
          {step.seq}
        </span>
        <NodeIcon
          type={step.nodeType}
          category={definition?.category}
          className="text-muted mt-0.5 size-4"
        />

        <span className="min-w-0 flex-1">
          <span className="text-ui block truncate font-bold">
            {name ?? definition?.label ?? step.nodeType}
          </span>
          <span className="text-muted block truncate font-mono text-3xs">
            {step.nodeId}
            {step.iteration > 0 && ` · pass ${step.iteration + 1}`}
            {step.branch !== null && ` · → ${step.branch}`}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <span key={step.status} className={cn("chip", look.tone, look.motion)}>
            {look.dots ? <BobbingDots /> : <span aria-hidden="true">{look.glyph}</span>}
            {look.label}
          </span>
          {duration !== null && (
            <span className="text-faint font-mono text-3xs tabular-nums">
              {formatDuration(duration)}
            </span>
          )}
        </span>
      </button>

      {step.error && (
        <p className="text-bad border-line-soft border-t px-2.5 py-2 text-2xs leading-relaxed">
          {step.error}
        </p>
      )}

      {logs.length > 0 && (
        // Outside the button on purpose: this is the reasoning, and it should be
        // selectable text rather than part of a click target.
        <ul className="bg-sunken border-line-soft space-y-1 border-t px-2.5 py-2">
          {logs.map((log, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-faint w-11 shrink-0 font-mono text-3xs tabular-nums">
                {formatOffset(step.startedAt, log.at)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 text-xs leading-relaxed break-words",
                  log.level === "error"
                    ? "text-bad"
                    : log.level === "warn"
                      ? "text-warn"
                      : "text-ink",
                )}
              >
                {/* The level in words as well as in tone — a warning that is only
                    amber is a warning a colourblind reader does not get. */}
                {log.level !== "info" && (
                  <span className="font-bold">{log.level === "warn" ? "Warning: " : "Error: "}</span>
                )}
                {log.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The `waiting` state from the motion vocabulary. Never a spinner — `DESIGN.md`. */
function BobbingDots() {
  return (
    <span aria-hidden="true" className="flex items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 140}ms` }}
          className="animate-think bg-live size-1 rounded-full"
        />
      ))}
    </span>
  );
}
