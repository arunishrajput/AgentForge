import { handle, ok, requireScope } from "@/lib/api";
import { revokeToken } from "@/lib/tokens/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Revokes one of the caller's own tokens. Idempotent. Session only — see `../route.ts`. */
export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id } = await params;
    return ok(await revokeToken(scope, id));
  });
}
