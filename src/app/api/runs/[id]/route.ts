import { describeRun, getRun } from "@/lib/engine/run";
import { handle, ok, requireScope } from "@/lib/api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id } = await params;
    const { run, steps } = await getRun(scope, id);
    return ok(describeRun(run, steps));
  });
}
