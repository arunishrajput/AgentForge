import { ApiError, handle, ok, requireApiScope } from "@/lib/api";
import { getStepBodies } from "@/lib/runs/history";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; seq: string }> };

/**
 * One step's bodies — the config it ran with, what arrived and what it produced. **Phase 33.**
 *
 * A route of its own because a run's detail page loads its steps without them (`runs/history.ts`,
 * rule 2): an HTTP step's output can be 256 KB, and a page that read every body of a forty-step
 * run to render a list of names would be reading megabytes nobody opened. Behind the same
 * visibility join as the run, so a private workflow's step is 404 to whoever its run is.
 */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireApiScope();
    const { id, seq } = await params;
    const number = Number(seq);
    if (!/^\d{1,6}$/.test(seq) || !Number.isSafeInteger(number)) {
      throw new ApiError("not_found", "No such step.");
    }
    return ok(await getStepBodies(scope, id, number));
  });
}
