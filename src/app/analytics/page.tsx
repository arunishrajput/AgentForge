import type { Metadata } from "next";

import {
  DayTable,
  FailureList,
  ModelTable,
  NodeTable,
  RangePicker,
} from "@/components/analytics/breakdowns";
import { RunChart } from "@/components/analytics/run-chart";
import { StatTiles } from "@/components/analytics/stat-tiles";
import { AppHeader } from "@/components/shell/app-header";
import { parseRange, RANGES, readAnalytics } from "@/lib/analytics";
import { requirePageSession } from "@/lib/workspace/page";
import { describeWorkspace } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Analytics" };

/**
 * **The analytics view — Phase 22.** What this workspace has been doing, and what broke.
 *
 * A server component that calls `readAnalytics` directly rather than fetching its own API
 * over HTTP, exactly as `/workflows` calls `listWorkflows`: the server already has a
 * database connection open for the session, and a page fetching itself is a second round
 * trip for data it is holding.
 *
 * **It does not poll, does not stream and does not refresh.** That is the phase's binding
 * constraint rather than a simplification — `BUILD_PLAN.md` names an analytics page that
 * polls as *exactly the pattern that pins the database awake*, and Neon's free plan meters
 * time awake. The window selector is three links, so a new window is a navigation somebody
 * asked for. The full reasoning, and what it measured, is at the top of
 * `lib/analytics/queries.ts`.
 *
 * **Every role sees it, and each sees only their own workflows.** `readAnalytics` applies
 * `visibleWorkflows` to all three queries, so a viewer's chart covers exactly the runs
 * their run list covers and a colleague's private workflow does not leak its failure rate
 * through an aggregate.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { email, scope, membership, memberships } = await requirePageSession();
  const workspace = describeWorkspace(membership, scope.userId);
  const range = parseRange((await searchParams).range);
  const analytics = await readAnalytics(scope, range);

  return (
    <>
      <AppHeader
        email={email}
        workspace={workspace}
        workspaces={memberships.map((m) => describeWorkspace(m, scope.userId))}
        scope={scope}
        active="analytics"
      />

      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-rise mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="text-muted mt-1 text-sm">
              {analytics.totals.runs === 0
                ? `Nothing has run in ${workspace.own ? "your workspace" : workspace.name} in the last ${range} days.`
                : `${analytics.totals.runs} run${analytics.totals.runs === 1 ? "" : "s"} in the last ${range} days, computed from run history.`}
            </p>
          </div>
          <RangePicker current={range} ranges={RANGES} />
        </div>

        <StatTiles totals={analytics.totals} />

        <section aria-labelledby="over-time" className="mb-6">
          <h2 id="over-time" className="eyebrow mb-2">
            Runs over time
          </h2>
          <RunChart days={analytics.days} />
        </section>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <NodeTable nodes={analytics.nodes} />
          <ModelTable models={analytics.models} />
        </div>

        <div className="mb-6">
          <FailureList failures={analytics.failures} />
        </div>

        <DayTable days={analytics.days} />

        {/*
          The cost of the page, on the page. `BUILD_PLAN.md` makes measuring this
          feature's database spend a completion criterion, and a number printed where the
          feature is used is the only version of that measurement that stays true after
          the phase that took it — a figure in a document is a claim about the past.
        */}
        <p className="text-faint mt-6 text-center text-xs">
          Computed from {analytics.totals.runs} run
          {analytics.totals.runs === 1 ? "" : "s"} in {analytics.queryMs} ms, on request.
          Nothing here runs on a schedule.
          {/* Phase 31: test runs are in no figure above, and saying how many keeps the page
              honest about the runs a person can see on their canvas. */}
          {analytics.testRuns > 0 &&
            ` ${analytics.testRuns} test run${analytics.testRuns === 1 ? " is" : "s are"} not counted.`}
        </p>
      </main>
    </>
  );
}
