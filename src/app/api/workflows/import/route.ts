import { ApiError, handle, ok, requireScope } from "@/lib/api";
import { importWorkflow } from "@/lib/workflow/library";
import { describeWorkflow } from "@/lib/workflow/store";
import { IMPORT_MAX_BYTES, readImport } from "@/lib/workflow/transfer";

export const dynamic = "force-dynamic";

/**
 * Create a workflow from an export — Phase 32. `editor`. The body is the export envelope
 * itself, exactly as `GET /api/workflows/:id/export` answered it in `data`.
 *
 * Read as text first and measured, so a body larger than any legal export is refused before it
 * is parsed — the clipboard's ceiling, 2 MB. Then `readImport` (format, version, shape) and
 * `importWorkflow` (the registry). Each refusal says which of those it was:
 *
 *   400 `invalid_request`   not JSON, not an export, a newer format, or the wrong shape
 *   422 `invalid_graph`     a node type this AgentForge does not have, named
 *
 * 201 with the workflow, which may be `runnable: false` with its problems — a half-built
 * workflow exported comes back half-built.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const scope = await requireScope("editor");

    const text = await request.text();
    if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
      throw new ApiError(
        "invalid_request",
        `That file is larger than any workflow export can be (${IMPORT_MAX_BYTES / 1_000_000} MB).`,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError("invalid_request", "That is not valid JSON, so it cannot be a workflow export.");
    }

    const reading = readImport(value);
    if (!reading.ok) {
      const { reason, message, ...rest } = reading.refusal;
      throw new ApiError("invalid_request", message, { reason, ...rest });
    }

    return ok(describeWorkflow(await importWorkflow(scope, reading.workflow)), 201);
  });
}
