import { handle, ok, requireScope } from "@/lib/api";
import { disconnectGoogle, googleStatus } from "@/lib/integrations/store";

export const dynamic = "force-dynamic";

/**
 * The Google connection's status and removal. The stored refresh token never appears
 * here: `connected`, the account's email address and the scopes Google actually
 * granted are all the UI needs.
 */
export async function GET() {
  return handle(async () => {
    const scope = await requireScope();
    return ok(await googleStatus(scope));
  });
}

export async function DELETE() {
  return handle(async () => {
    const scope = await requireScope("admin");
    return ok(await disconnectGoogle(scope));
  });
}
