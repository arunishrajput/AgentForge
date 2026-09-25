import { describeRun, getRun } from "@/lib/engine/run";
import { handle, ok, requireOwnerId } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    const { run, steps } = await getRun(ownerId, id);
    return ok(describeRun(run, steps));
  });
}
