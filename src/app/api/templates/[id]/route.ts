import { ApiError, handle, ok, requireScope } from "@/lib/api";
import { getTemplate } from "@/lib/templates/catalogue";
import { createWorkflow, describeWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `POST /api/templates/:id` — clone a template into the caller's workspace.
 *
 * **It creates an ordinary workflow, by the ordinary path.** `createWorkflow` is the
 * same function `POST /api/workflows` calls, so a cloned template gets its workspace
 * scoping, its owner, its version 1 and its webhook token from one place. A second way
 * for a workflow to come into existence is a second place for any of those to be
 * forgotten, and Phase 19A's scoping and Phase 18's versioning would both be easy to
 * miss here.
 *
 * `editor`, because this writes. A viewer may read the gallery and may not use it —
 * the same line Phase 20 draws everywhere else.
 *
 * The graph is deep-copied on the way out of the catalogue. `TEMPLATES` is a
 * module-level constant living for the lifetime of the container, so handing its own
 * object to a store that might later mutate it would let one user's edit leak into the
 * next user's clone. Nothing does that today; the copy is what keeps it true.
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id } = await params;

    const template = getTemplate(id);
    if (!template) {
      throw new ApiError("not_found", `There is no template called "${id}".`, 404);
    }

    const workflow = await createWorkflow(
      scope,
      {
        name: template.name,
        description: template.description,
        graph: structuredClone(template.graph),
      },
      `Created from the "${template.name}" template`,
    );

    return ok(describeWorkflow(workflow), 201);
  });
}
