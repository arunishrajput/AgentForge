import type { Metadata } from "next";
import Link from "next/link";

import { RunFilters } from "@/components/runs/run-filters";
import { RunList } from "@/components/runs/run-list";
import { AppHeader } from "@/components/shell/app-header";
import { Card } from "@/components/ui/card";
import { EmptyState, QuietArt } from "@/components/ui/illustration";
import { listRunPage, listWorkflowChoices } from "@/lib/runs/history";
import { isFiltered, parseRunQuery, runQuerySearch } from "@/lib/runs/query";
import { RUN_RETENTION_DAYS, RUNS_KEPT_PER_WORKFLOW } from "@/lib/runs/retention";
import { requirePageSession } from "@/lib/workspace/page";
import { describeWorkspace } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Runs" };

/**
 * **Every run in the workspace — Phase 33.** Filtered by status, trigger, workflow and day, and
 * paginated **on the server**, by keyset (D150): the workflow list can hand the browser every
 * card (D69), and run history grows without bound.
 *
 * The URL is the whole query — the filters and the cursor — so a page of failures from last
 * Tuesday is a link. It reads its own store directly, as `/workflows` and `/analytics` do, and
 * like them it does not poll: a new run shows on the next navigation somebody asks for.
 *
 * **Every role sees it, and each sees what their run list does**: a colleague's private
 * workflow's runs are not in it, by the same join as everywhere else (D101).
 */
export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { email, scope, membership, memberships } = await requirePageSession();
  const workspace = describeWorkspace(membership, scope.userId);
  const query = parseRunQuery(await searchParams);

  const [page, workflows] = await Promise.all([listRunPage(scope, query), listWorkflowChoices(scope)]);
  const filtered = isFiltered(query);
  const paged = query.before !== null || query.after !== null;

  return (
    <>
      <AppHeader
        email={email}
        workspace={workspace}
        workspaces={memberships.map((m) => describeWorkspace(m, scope.userId))}
        active="runs"
      />

      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-rise mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted mt-1 text-sm text-pretty">
            Every run in {workspace.own ? "your workspace" : workspace.name}, newest first. Open one to
            see each step it took, and to run it again or retry it from where it failed.
          </p>
        </div>

        <Card className="animate-rise mb-4 p-4">
          {/* Keyed on the query, so a link that changes it — *Clear filters*, Back — remounts the
              fields with the values it names rather than the ones last typed into them. */}
          <RunFilters key={runQuerySearch(query)} query={query} workflows={workflows} />
        </Card>

        <Card className="animate-rise">
          {page.runs.length === 0 ? (
            <EmptyState
              level={2}
              art={<QuietArt />}
              title={filtered ? "No runs match" : paged ? "Nothing on this page" : "No runs yet"}
              description={
                filtered
                  ? "Nothing in the history matches these filters. Widen the dates, or clear them."
                  : paged
                    ? "The runs that were here have gone — newer ones are on the first page."
                    : "When a workflow runs — by hand, from a webhook or on a schedule — it appears here with every step it took."
              }
              action={
                filtered || paged ? (
                  <Link href="/runs" className="btn btn-quiet">
                    {filtered ? "Clear filters" : "Newest runs"}
                  </Link>
                ) : (
                  <Link href="/workflows" className="btn btn-primary">
                    Open a workflow
                  </Link>
                )
              }
            />
          ) : (
            <>
              <h2 className="sr-only">
                {page.runs.length} run{page.runs.length === 1 ? "" : "s"}
              </h2>
              <RunList runs={page.runs} />
            </>
          )}
        </Card>

        {(page.prev || page.next) && (
          <nav aria-label="Pages of runs" className="mt-4 flex items-center justify-between gap-2">
            {page.prev ? (
              <Link href={`/runs${runQuerySearch(query, { after: page.prev })}`} className="btn btn-quiet" rel="prev">
                <span aria-hidden="true">←</span> Newer
              </Link>
            ) : (
              <span />
            )}
            {page.next ? (
              <Link href={`/runs${runQuerySearch(query, { before: page.next })}`} className="btn btn-quiet" rel="next">
                Older <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}

        {/* What is kept, said where the history is read — and the cost of the page, as
            `/analytics` prints its own. */}
        <p className="text-faint mt-6 text-center text-xs text-pretty">
          Runs are kept for {RUN_RETENTION_DAYS} days, and each workflow keeps its newest{" "}
          {RUNS_KEPT_PER_WORKFLOW}. Read in {page.queryMs} ms, on request.
        </p>
      </main>
    </>
  );
}
