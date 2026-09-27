import { ApiError, handle, ok, readJson, requireScope } from "@/lib/api";
import { getWorkflow } from "@/lib/workflow/store";
import {
  describeVersion,
  getVersion,
  labelVersion,
  versionLabelSchema,
} from "@/lib/workflow/versions";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; number: string }> };

/**
 * A version number arrives as a path segment, so it is a string until proved
 * otherwise. `Number()` alone accepts `"3.5"`, `" 3"` and `""` — all of which would
 * reach the query as something Postgres either rejects or, worse, coerces.
 */
function versionNumber(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError("not_found", "No such version of this workflow.");
  }
  return parsed;
}

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id, number } = await params;
    const workflow = await getWorkflow(scope, id);
    const version = await getVersion(scope, id, versionNumber(number));
    return ok(
      describeVersion(version, { graph: true, current: version.number === workflow.version }),
    );
  });
}

/**
 * Name a version, or clear its name.
 *
 * A label is the only thing about a version that can be changed after the fact, and
 * that is deliberate: the graph and the name are what happened, and history that can
 * be edited is not history. The label is the user's annotation *on* it — and it is
 * also what exempts a version from the retention cap, so naming one is how you keep
 * it.
 */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id, number } = await params;
    const workflow = await getWorkflow(scope, id);
    const body = await readJson(request, versionLabelSchema);
    const version = await labelVersion(scope, id, versionNumber(number), body.label);
    return ok(describeVersion(version, { current: version.number === workflow.version }));
  });
}
