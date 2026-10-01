import { handle, ok, requireScope } from "@/lib/api";
import { listModelsFor } from "@/lib/ai/settings";
import { NoProviderKeyError } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The models the workspace's key can use, live from the provider. Model names get
 * retired mid-project, so the settings UI asks rather than offering a baked-in list.
 *
 * **`admin`, although it is a GET** — the only route in the product where a read needs
 * more than `viewer`. It spends the workspace's provider quota on an outbound call with
 * the workspace's key, and the only thing it is useful for is filling a picker beside a
 * Save button that `viewer` and `editor` cannot press. Read access here would be the
 * ability to burn somebody else's rate limit for no reachable outcome.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const scope = await requireScope("admin");
    // **Phase 23D: `?provider=` lists from a named provider's own stored key.** Without it
    // the settings page could only ever fill the active provider's picker, so choosing a
    // model for the provider you are about to switch to would be impossible — you would have
    // to switch first, on a model you had not checked.
    const provider = new URL(request.url).searchParams.get("provider");
    try {
      return ok(await listModelsFor(scope, provider ?? undefined));
    } catch (error) {
      if (error instanceof NoProviderKeyError) {
        throw new ApiError("not_found", error.message);
      }
      throw error;
    }
  });
}
