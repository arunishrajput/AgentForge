import { handle, ok, readJson, requireScope } from "@/lib/api";
import { createToken, listTokens } from "@/lib/tokens/store";
import { createTokenSchema } from "@/lib/tokens/token";

export const dynamic = "force-dynamic";

/**
 * Personal access tokens — Phase 41, D192. **Session only: `requireScope`, never `requireApiScope`**,
 * so a token cannot list, mint or revoke tokens — a leaked one could otherwise make itself
 * immortal. Any member may hold a token up to their own role.
 */
export async function GET() {
  return handle(async () => {
    const scope = await requireScope();
    return ok(await listTokens(scope));
  });
}

/** The only response that ever contains the token itself. */
export async function POST(request: Request) {
  return handle(async () => {
    const scope = await requireScope();
    const input = await readJson(request, createTokenSchema);
    const { token, summary } = await createToken(scope, input);
    const response = ok({ ...summary, token }, 201);
    response.headers.set("cache-control", "no-store");
    return response;
  });
}
