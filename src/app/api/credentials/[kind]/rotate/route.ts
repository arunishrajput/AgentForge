import { z } from "zod";

import { handle, ok, readJson, requireScope } from "@/lib/api";
import { rotateCredential } from "@/lib/credentials/rotation";
import { readVault } from "@/lib/credentials/vault";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ kind: string }> };

const bodySchema = z.object({
  /**
   * The replacement. Bounded here as well as by the per-kind rule, so an unbounded body
   * cannot reach the provider-validation call at all — the rule's own schema is about
   * *shape*, this is about not reading a megabyte before deciding.
   */
  secret: z.string().min(1).max(4000),
});

/**
 * Rotate one credential in place — **Phase 21's answer to the gap Chapter 1 left.**
 *
 * **`admin`, and for the reason Phase 20 established for the share link**: an editor may
 * already run a workflow, which sends mail and posts to Discord, so the bar is not about
 * power. It is about *kind*. This replaces a secret the whole workspace depends on, and if
 * the new one is wrong every workflow that uses it fails at once — which is the sort of act
 * the person accountable for the workspace should be the one to take.
 *
 * **Nothing is stored until the new secret has been proved against the provider**, by the
 * same code that proved the original. A rotation that stored first and validated afterwards
 * would be a route whose failure mode is "your workspace is now broken and the old key is
 * gone", and there is no undo for that because the old secret is not kept.
 *
 * The response is the whole vault rather than the one entry. It costs one extra query and it
 * means the page cannot be left holding a stale `lastUsedAt` or a stale rotation count beside
 * a row that just changed — which is the bug class Phase 19B's four deploys were mostly made
 * of.
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const { kind } = await params;
    const scope = await requireScope("admin");
    const body = await readJson(request, bodySchema);

    // No error mapping here. `rotateCredential` already answers with an `ApiError` for every
    // refusal it makes, and `handle` turns anything else into a clean 500 with the cause in the
    // log — which is what the first version of this route got wrong by wrapping its whole body
    // in `integrationApiError` and collapsing four deliberate refusals into one internal error.
    await rotateCredential({ scope, kind: decodeURIComponent(kind), secret: body.secret });

    return ok(await readVault(scope));
  });
}
