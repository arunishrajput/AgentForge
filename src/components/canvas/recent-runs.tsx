"use client";

import Link from "next/link";

import { Spinner } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RunSummary } from "@/lib/canvas/client";
import { runStatusLook } from "@/lib/canvas/status";
import { formatDuration } from "@/lib/format/duration";
import { formatUtcShort } from "@/lib/format/date";
import { TRIGGER_WORDS } from "@/lib/runs/words";

/**
 * **This workflow's recent runs, on its canvas — Phase 33, `BUILD_PLAN.md` task 1.** Status,
 * trigger, version and duration a row; choosing one paints that run's statuses onto the canvas
 * and opens it in the run panel below. Choosing paints, it does not run anything, and the canvas
 * stays editable: the run on screen is a projection over the graph (`runStates`), never part of it.
 *
 * The quiet register — it sits in the inspector — and a row's status is a word and a glyph as well
 * as a tone. The row on screen is marked `aria-current`, sunken, and with the word *Showing* — never
 * by its fill alone, which in Toybox Night read the same as its neighbours.
 */
export function RecentRuns({
  workflowId,
  runs,
  shownId,
  opening,
  onOpen,
}: {
  workflowId: string;
  runs: RunSummary[];
  /** The run the canvas is showing now, if it is one of these. */
  shownId: string | null;
  /** A run being fetched to be shown. */
  opening: string | null;
  onOpen: (runId: string) => void;
}) {
  if (runs.length === 0) return null;

  return (
    <section aria-labelledby="recent-runs" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="recent-runs" className="eyebrow">
          Recent runs
        </h3>
        <Link
          href={`/runs?workflow=${encodeURIComponent(workflowId)}`}
          className="text-muted hover:text-ink inline-flex min-h-6 items-center text-2xs font-semibold underline underline-offset-2"
        >
          All runs<span aria-hidden="true">&nbsp;→</span>
        </Link>
      </div>
      <ul className="space-y-1">
        {runs.map((run) => {
          const look = runStatusLook(run.status);
          const current = run.id === shownId;
          return (
            <li key={run.id}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                aria-busy={opening === run.id || undefined}
                onClick={() => onOpen(run.id)}
                className={cn(
                  "border-line flex min-h-8 w-full items-center gap-2 rounded-lg border-2 px-2 py-1 text-left transition-colors duration-100",
                  current ? "bg-sunken" : "bg-surface hover:bg-canvas",
                )}
              >
                <span className={cn("flex w-5 shrink-0 justify-center text-xs font-bold", look.tone)}>
                  {look.dots || opening === run.id ? (
                    <Spinner />
                  ) : (
                    <span aria-hidden="true">{look.glyph}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ui block truncate text-xs font-semibold">
                    <span className="sr-only">{look.label}, </span>
                    {formatUtcShort(run.startedAt)}
                  </span>
                  <span className="text-muted block truncate text-3xs">
                    {TRIGGER_WORDS[run.trigger]}
                    {run.workflowVersion !== null && ` · v${run.workflowVersion}`}
                    {run.test && " · test"}
                    {run.origin && ` · ${run.origin.kind === "retry" ? "retry" : "re-run"}`}
                  </span>
                </span>
                {/* The row on screen says so in a word: a sunken fill alone was the only mark, and in
                    Toybox Night it was indistinguishable from its neighbours (Phase 33's walk). The
                    duration it gives up is in the run panel below. */}
                {current ? (
                  <span className="chip text-ink shrink-0">Showing</span>
                ) : (
                  <span className="text-faint shrink-0 font-mono text-3xs tabular-nums">
                    {run.durationMs !== null ? formatDuration(run.durationMs) : run.status === "waiting" ? "paused" : ""}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
