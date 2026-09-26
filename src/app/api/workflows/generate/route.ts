import { NoProviderKeyError, resolveProvider } from "@/lib/ai/provider";
import { ProviderError } from "@/lib/ai/types";
import { ApiError, handle, ok, readJson, requireOwnerId } from "@/lib/api";
import { generateWorkflow } from "@/lib/generate/generate";
import { generateRequestSchema } from "@/lib/generate/schema";
import { createWorkflow, describeWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

/**
 * `POST /api/workflows/generate` — CONTRACT.md → "Generation request/response".
 *
 * A plain-language request in, a real persisted workflow out. The order is the whole
 * point: generate, validate, and only then insert. A workflow that could not run is
 * never written (PRD.md → Generation), so a user cannot end up with a broken row and
 * no idea how it got there.
 *
 * Synchronous, like `POST /runs`: generation is one or two model calls, and the
 * response is the created workflow, so the client can navigate straight to it.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const body = await readJson(request, generateRequestSchema);

    const provider = await resolveProviderOr422(ownerId);

    let result;
    try {
      result = await generateWorkflow({
        model: provider.model,
        modelId: provider.selectedModel,
        prompt: body.prompt,
        name: body.name,
      });
    } catch (error) {
      // The provider's own words reach the user — a bad key or a busy model is
      // something they can act on, and hiding it behind "something went wrong"
      // wasted time in Phase 6.
      if (error instanceof ProviderError) {
        throw new ApiError("invalid_graph", error.message, {
          issues: [],
          attempts: error.attempts,
        });
      }
      throw error;
    }

    if (!result.ok) {
      // 422 `invalid_graph`: the request was well formed and the model answered, but
      // what it produced cannot run. `details` carries the issue list so the UI can
      // show exactly what was wrong.
      throw new ApiError("invalid_graph", result.message, {
        issues: result.issues,
        attempts: result.attempts,
      });
    }

    const workflow = await createWorkflow(ownerId, {
      name: result.name,
      description: result.description,
      graph: result.graph,
    });

    return ok(
      {
        workflow: describeWorkflow(workflow),
        generation: {
          model: result.model,
          source: provider.source,
          unsupported: result.unsupported,
          usage: result.usage,
          attempts: result.attempts,
        },
      },
      201,
    );
  });
}

/**
 * No key is a 404 on the settings route because the caller asked for a thing that is
 * not there. Here the caller asked to generate, and the fix is a different page, so
 * it is reported as an actionable failure with the message the provider module wrote.
 */
async function resolveProviderOr422(ownerId: string) {
  try {
    return await resolveProvider(ownerId);
  } catch (error) {
    if (error instanceof NoProviderKeyError) {
      throw new ApiError("invalid_request", error.message);
    }
    throw error;
  }
}
