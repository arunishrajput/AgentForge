import { sweepRuns } from "@/lib/engine/run";
import { handle, okPage, requireScope } from "@/lib/api";
import { listRunPage } from "@/lib/runs/history";
import { pageCursors, readRunRequest } from "@/lib/runs/query";

export const dynamic = "force-dynamic";

/**
 * The workspace's runs, newest first, **a page at a time** — Phase 33, `CONTRACT.md` → *Run
 * history*. Filters by `status`, `trigger`, `workflowId` (or `workflow`), `from` and `to` (UTC
 * days, inclusive), and pages by `before` / `after` cursors, which `page.next` and `page.prev`
 * hand back. Each run is a summary — no input, output or steps; `GET /api/runs/:id` has those.
 *
 * It sweeps abandoned runs first, as it has since Chapter 1: a run nothing is coming back for is
 * closed before it is listed as running.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const scope = await requireScope();
    const { query, limit } = readRunRequest(new URL(request.url));
    await sweepRuns(scope);
    const page = await listRunPage(scope, query, { limit });
    return okPage(page.runs, pageCursors(page));
  });
}
