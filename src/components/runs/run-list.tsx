import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { runStatusLook } from "@/lib/canvas/status";
import { testLabel } from "@/lib/canvas/test-run";
import { formatDuration } from "@/lib/format/duration";
import { formatUtc } from "@/lib/format/date";
import type { RunSummary } from "@/lib/runs/history";
import { originWords, TRIGGER_WORDS } from "@/lib/runs/words";

/**
 * **The run history as a list — Phase 33.** One row a run: what happened, to which workflow,
 * what started it, which version ran, when and for how long — and the two labels a run can wear
 * that change how it should be read, *test* (D142) and *retry of* (D151).
 *
 * The quiet register (`DESIGN.md`): a dense list on paper, status carried by a word and a glyph
 * as well as a tone. **The whole row is the link**, by a stretched `::after` over the workflow's
 * name, so the name is what a screen reader announces and the row is what a pointer can hit —
 * and the one link per row keeps the tab order a list of runs rather than a list of fragments.
 */
export function RunList({ runs }: { runs: RunSummary[] }) {
  return (
    <ul className="divide-line-soft divide-y">
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </ul>
  );
}

function RunRow({ run }: { run: RunSummary }) {
  const look = runStatusLook(run.status);
  // A test's node is named by id here: the list does not carry the graph to name it with.
  const test = testLabel(run.test, new Map());
  const origin = originWords(run.origin);

  return (
    <li className="hover:bg-canvas relative flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3 transition-colors duration-100">
      <span className={cn("chip mt-0.5 w-28 shrink-0 justify-start", look.tone)}>
        {look.dots ? <Spinner className="text-live" /> : <span aria-hidden="true">{look.glyph}</span>}
        {look.label}
      </span>

      <div className="min-w-0 flex-1 basis-56">
        <Link
          href={`/runs/${run.id}`}
          className="text-ui block truncate font-bold after:absolute after:inset-0 after:content-['']"
        >
          {run.workflowName}
        </Link>
        <p className="text-muted mt-0.5 text-2xs">
          {TRIGGER_WORDS[run.trigger]}
          {run.workflowVersion !== null && (
            <>
              {" · "}
              <span className="font-mono">v{run.workflowVersion}</span>
            </>
          )}
          {" · "}
          {formatUtc(run.startedAt)}
        </p>
        {run.status === "failed" && run.error && (
          <p className="text-bad mt-1 line-clamp-2 text-2xs break-words">{run.error}</p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 max-sm:basis-full max-sm:justify-start">
        {test && (
          <Badge tone="outline" icon={<span aria-hidden="true">◇</span>}>
            {test}
          </Badge>
        )}
        {origin && (
          <Badge tone="outline" icon={<span aria-hidden="true">↺</span>}>
            {origin}
          </Badge>
        )}
        <span className="text-faint w-16 text-right font-mono text-2xs tabular-nums max-sm:text-left">
          {run.durationMs !== null ? formatDuration(run.durationMs) : run.status === "waiting" ? "paused" : "—"}
        </span>
      </div>
    </li>
  );
}
