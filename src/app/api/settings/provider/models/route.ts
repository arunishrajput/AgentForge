import { handle, ok, requireOwnerId } from "@/lib/api";
import { listModelsFor } from "@/lib/ai/settings";
import { NoProviderKeyError } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The models the caller's own key can use, live from the provider. Model names get
 * retired mid-project, so the settings UI asks rather than offering a baked-in list.
 */
export async function GET() {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    try {
      return ok(await listModelsFor(ownerId));
    } catch (error) {
      if (error instanceof NoProviderKeyError) {
        throw new ApiError("not_found", error.message);
      }
      throw error;
    }
  });
}
