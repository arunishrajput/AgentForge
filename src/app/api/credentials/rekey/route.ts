import { handle, ok, requireScope } from "@/lib/api";
import { rekeyCredentials } from "@/lib/credentials/rekey";
import { readVault } from "@/lib/credentials/vault";

export const dynamic = "force-dynamic";

/**
 * Re-wrap this workspace's credentials under the current root key — **Phase 21**.
 *
 * **`owner`, the only route in the product that needs it besides ownership itself.** Rotating
 * one credential is `admin`, because its blast radius is one integration. This touches how
 * *every* secret in the workspace is stored, and although it is designed so that a failure
 * leaves every row still readable (`lib/credentials/rekey.ts`), "designed so" is exactly the
 * claim a permission bar should not depend on.
 *
 * **Scoped to the caller's workspace, and that is a real limitation stated rather than
 * hidden.** A root key is global; a route that is not is therefore not a complete rotation of
 * it. What this route is for is the in-product path — *my workspace's secrets are now under
 * the new key, and I can see that they are* — and `scripts/rekey.mjs` is the operator path
 * over every workspace, which is what a root key rotation actually needs. `SECURITY.md` →
 * *Rotating the root key* is the procedure; this route is step two of it.
 *
 * Idempotent and resumable: a row already on the target version is counted `unchanged` and
 * not rewritten, so running it twice is free and running it after a failure finishes the job.
 */
export async function POST() {
  return handle(async () => {
    const scope = await requireScope("owner");
    const outcome = await rekeyCredentials({ scope });
    return ok({ rekey: outcome, vault: await readVault(scope) });
  });
}
