import { handle, ok, requireScope } from "@/lib/api";
import { readVault } from "@/lib/credentials/vault";

export const dynamic = "force-dynamic";

/**
 * The vault — **Phase 21**. Everything this workspace's settings page needs to say about its
 * secrets, in one request.
 *
 * **`viewer`, which is deliberate and is the matrix already in `CONTRACT.md`**: *read
 * credential status* has been a viewer action since Phase 19B. Nothing here is a secret — the
 * response carries metadata, timestamps, counts and root key *version labels*, and never a
 * value, a prefix or a masked tail. Putting it behind `admin` would hide from a viewer the one
 * fact they most need in order to understand a failed run: whether the credential it wanted
 * exists at all.
 *
 * Rotation and revocation are `admin`, on their own routes. The split is the Phase 20 rule
 * applied again: what a role gates is the class of act, not the size of it.
 */
export async function GET() {
  return handle(async () => {
    const scope = await requireScope();
    return ok(await readVault(scope));
  });
}
