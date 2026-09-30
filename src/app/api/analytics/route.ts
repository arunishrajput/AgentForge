import { handle, ok, requireScope } from "@/lib/api";
import { parseRange, readAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * The analytics for the caller's active workspace — Phase 22.
 *
 * **`viewer`**, the default, and deliberately the lowest role: this is a read of run
 * history, and a viewer can already open every run it aggregates. It adds no authority,
 * and `readAnalytics` applies `visibleWorkflows` on every query, so a viewer's numbers
 * cover exactly the workflows their run list already covers and a private workflow's
 * failure rate does not leak through a chart.
 *
 * **The page does not call this.** `/analytics` is a server component and reads
 * `readAnalytics` directly — a page fetching its own API over HTTP would be a second
 * round trip for data the server already has. The route exists because the deployed
 * verification has to assert these numbers over HTTP against the real database, which is
 * the only way this phase's completion criterion — *analytics correct against a
 * hand-checked sample* — can be checked from outside the container.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const scope = await requireScope();
    const range = parseRange(new URL(request.url).searchParams.get("range"));
    return ok(await readAnalytics(scope, range));
  });
}
