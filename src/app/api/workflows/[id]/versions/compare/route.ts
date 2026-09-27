import { ApiError, handle, ok, requireOwnerId } from "@/lib/api";
import { getWorkflow } from "@/lib/workflow/store";
import { compareVersions } from "@/lib/workflow/versions";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `GET /api/workflows/:id/versions/compare?from=3&to=7`
 *
 * `to` defaults to the workflow's current version, because "what has changed since
 * v3?" is the question people actually have and the current version is always the
 * newest one — every save produces one, so there is no "current but unversioned"
 * state to special-case.
 *
 * The response carries **both graphs as well as the diff**, which looks redundant and
 * is not: the canvas draws removed nodes at their old positions and changed nodes with
 * their old configuration beside the new, so it needs the whole of both sides. One
 * response, one render, no follow-up fetches.
 */
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    const workflow = await getWorkflow(ownerId, id);

    const query = new URL(request.url).searchParams;
    const from = parse(query.get("from"), "from");
    const to = query.get("to") === null ? workflow.version : parse(query.get("to"), "to");

    return ok(await compareVersions(ownerId, id, from, to));
  });
}

function parse(raw: string | null, field: string): number {
  const parsed = Number(raw);
  if (raw === null || !Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError("invalid_request", `\`${field}\` must be a version number.`);
  }
  return parsed;
}
