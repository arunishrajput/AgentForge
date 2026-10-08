import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { formatUtc } from "@/lib/format/date";
import { formatDuration } from "@/lib/format/duration";
import type { DayBucket, FailureGroup, ModelStat, NodeStat } from "@/lib/analytics";

/**
 * The three tables under the chart, plus the chart's own accessible equivalent.
 *
 * All four are the quiet register — paper and cream, no illustration, no pop fill across
 * a wide area. `DESIGN.md` puts dense lists there, and a dashboard is the densest list
 * this product has.
 */

/**
 * **Error grouping, as a reader sees it.** One row per distinct failure, most frequent
 * first, keyed by the fingerprint `lib/logging/fingerprint.ts` computes — the same one
 * the logs carry, so the id on a row can be pasted into the Logs Explorer and find its
 * own lines. `OPERATIONS.md` → *Chasing one failure group* has that query.
 *
 * The normalised template is the title and the real message is underneath it, because
 * the normaliser deliberately over-groups: two problems landing in one row is a nuisance
 * somebody notices on reading the sample, and one problem scattered over forty rows is
 * invisible. **Since Phase 33 each row opens its newest run**, which is where the steps,
 * the failed one and a retry live.
 */
export function FailureList({ failures }: { failures: FailureGroup[] }) {
  if (failures.length === 0) {
    return (
      <Card className="animate-rise">
        <CardHeader title="Failures" />
        <p className="text-muted p-4 text-sm">
          Nothing failed in this window.
        </p>
      </Card>
    );
  }

  return (
    <Card className="animate-rise">
      <CardHeader
        title="Failures"
        aside={<Badge>{failures.length} group{failures.length === 1 ? "" : "s"}</Badge>}
      />
      <ul className="divide-line-soft divide-y">
        {failures.map((group) => (
          <li key={group.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-ui min-w-0 font-semibold break-words">{group.template}</p>
              <Badge className="text-bad shrink-0">×{group.count}</Badge>
            </div>
            <p className="text-muted mt-1.5 font-mono text-xs break-words">{group.sample}</p>
            <p className="text-faint mt-1.5 text-xs">
              Last seen {formatUtc(group.lastSeen)} ·{" "}
              <code className="font-mono">{group.id}</code>
            </p>
            {/* Phase 33: the newest occurrence, opened on its own page — every step it took, the
                one that failed, and a retry from there. */}
            <Link
              href={`/runs/${group.sampleRunId}`}
              className="text-ink mt-2 inline-flex min-h-6 items-center gap-1 text-xs font-semibold underline underline-offset-2"
            >
              Open the latest run<span aria-hidden="true"> →</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Slowest nodes, by p95 rather than by mean — a mean over eleven runs is moved more by
 * one cold start than by a node that is genuinely slow every time, and the p95 here is a
 * duration that actually occurred (`analytics/shape.ts`).
 */
export function NodeTable({ nodes }: { nodes: NodeStat[] }) {
  if (nodes.length === 0) return null;

  const slowest = [...nodes].sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));

  return (
    <Card className="animate-rise">
      <CardHeader title="Slowest nodes" aside={<Badge>p95</Badge>} />
      {/* A table cannot shrink below its own content, so on a phone it would be clipped
          by the card and its right-hand columns would be unreachable — found at 375 px in
          a browser, which is the only place it is visible. Scrolling the table rather
          than the page keeps the card's outline where it is. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm">
        <caption className="sr-only">
          Every node type that ran in this window, slowest 95th percentile first.
        </caption>
        <thead>
          <tr className="text-faint border-line border-b-2 text-left text-xs">
            <th scope="col" className="px-4 py-2 font-bold">Node</th>
            <th scope="col" className="px-4 py-2 text-right font-bold">Steps</th>
            <th scope="col" className="px-4 py-2 text-right font-bold">Median</th>
            <th scope="col" className="px-4 py-2 text-right font-bold">p95</th>
          </tr>
        </thead>
        <tbody className="divide-line-soft divide-y">
          {slowest.map((node) => (
            <tr key={node.nodeType}>
              <th scope="row" className="px-4 py-2 text-left font-medium">
                {node.label ?? node.nodeType}
                {node.label === null && (
                  // A run is a historical record and outlives a node being renamed, so
                  // the recorded type is shown and nothing is claimed about it.
                  <span className="text-faint ml-1.5 text-xs">no longer registered</span>
                )}
                {node.failures > 0 && (
                  <span className="text-bad ml-1.5 text-xs font-semibold">
                    {node.failures} failed
                  </span>
                )}
              </th>
              <td className="px-4 py-2 text-right tabular-nums">{node.runs}</td>
              <td className="text-muted px-4 py-2 text-right tabular-nums">
                {node.medianMs === null ? "—" : formatDuration(node.medianMs)}
              </td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">
                {node.p95Ms === null ? "—" : formatDuration(node.p95Ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

/**
 * Model usage, **by the model that answered rather than the one that was asked for**.
 *
 * That is the distinction worth drawing on this page: after a fallback those are two
 * different models, and a workspace seeing a name here it never selected is seeing the
 * fallback chain doing its job — and, if it persists, the signal that the head of the
 * chain is degrading. `OPERATIONS.md` → *Model fallbacks* is the same fact as a metric.
 */
export function ModelTable({ models }: { models: ModelStat[] }) {
  if (models.length === 0) return null;

  return (
    <Card className="animate-rise">
      <CardHeader title="Model usage" aside={<Badge>answered</Badge>} />
      <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm">
        <caption className="sr-only">
          Model calls in this window, counted by the model that answered rather than the
          model that was requested.
        </caption>
        <thead>
          <tr className="text-faint border-line border-b-2 text-left text-xs">
            <th scope="col" className="px-4 py-2 font-bold">Model</th>
            <th scope="col" className="px-4 py-2 text-right font-bold">Calls</th>
            <th scope="col" className="px-4 py-2 text-right font-bold">In</th>
            <th scope="col" className="px-4 py-2 text-right font-bold">Out</th>
          </tr>
        </thead>
        <tbody className="divide-line-soft divide-y">
          {models.map((model) => (
            <tr key={model.model}>
              <th scope="row" className="px-4 py-2 text-left font-mono text-xs font-medium">
                {model.model}
              </th>
              <td className="px-4 py-2 text-right tabular-nums">{model.calls}</td>
              <td className="text-muted px-4 py-2 text-right tabular-nums">
                {model.inputTokens.toLocaleString("en-GB")}
              </td>
              <td className="text-muted px-4 py-2 text-right tabular-nums">
                {model.outputTokens.toLocaleString("en-GB")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

/**
 * The chart's figures as a table, collapsed by default.
 *
 * An SVG of `<rect>`s is one image to a screen reader however well it is labelled, so
 * the numbers behind it are here in a `<details>` — visible to everybody, in the DOM
 * rather than in a `sr-only` duplicate, and rendered on the server so the chart and the
 * table can never disagree. Days with no runs are omitted from the table because a
 * hundred empty rows is not an accessible equivalent of anything; the total says what
 * the window held.
 */
export function DayTable({ days }: { days: DayBucket[] }) {
  const active = days.filter((day) => day.total > 0);
  if (active.length === 0) return null;

  return (
    <details className="border-line bg-surface animate-rise rounded-xl border-2">
      <summary className="text-ui cursor-pointer px-4 py-2.5 font-bold">
        Runs by day, as a table ({active.length} day{active.length === 1 ? "" : "s"} with runs)
      </summary>
      <div className="overflow-x-auto border-t-2 border-(--color-line)">
      <table className="w-full min-w-[20rem] text-sm">
        <thead>
          <tr className="text-faint border-line border-b-2 text-left text-xs">
            <th scope="col" className="px-3 py-2 font-bold">Day</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">Succeeded</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">Failed</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">Other</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-line-soft divide-y">
          {active.map((day) => (
            <tr key={day.day}>
              <th scope="row" className="px-3 py-2 text-left font-medium">{day.day}</th>
              <td className="px-3 py-2 text-right tabular-nums">{day.succeeded}</td>
              <td className="px-3 py-2 text-right tabular-nums">{day.failed}</td>
              <td className="text-muted px-3 py-2 text-right tabular-nums">
                {day.cancelled + day.other}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{day.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </details>
  );
}

/**
 * The window selector — **three links, not a control that fetches.**
 *
 * A `<select>` with an `onChange` would make this a client component and would make
 * changing the window a background request; a link makes it a navigation the reader
 * asked for, which is the difference the note at the top of `analytics/queries.ts`
 * turns on: nothing here may become a new reason to wake an idle database.
 */
export function RangePicker({ current, ranges }: { current: number; ranges: readonly number[] }) {
  return (
    <nav aria-label="Window" className="flex items-center gap-1">
      {ranges.map((range) => (
        <Link
          key={range}
          href={`/analytics?range=${range}`}
          aria-current={range === current ? "page" : undefined}
          className={`btn ${
            range === current
              ? "btn-quiet translate-x-[2px] translate-y-[2px] shadow-(--shadow-press)"
              : "btn-ghost"
          }`}
        >
          {range}d
        </Link>
      ))}
    </nav>
  );
}
