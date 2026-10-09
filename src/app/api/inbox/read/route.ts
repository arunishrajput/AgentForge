import { handle, ok, readJson, requireScope } from "@/lib/api";
import { markReadSchema } from "@/lib/inbox/schema";
import { markRead, readInbox } from "@/lib/inbox/store";

export const dynamic = "force-dynamic";

/**
 * Mark the reader's own entries read — `{ ids }` or `{ all: true }` — Phase 37. Answers the inbox
 * as it now stands, so the bell's count is the server's and not the client's arithmetic.
 *
 * Any role: reading is not a change to the workspace. An id that is not the reader's — another
 * person's entry, another workspace's — matches nothing in the `where`, and the answer says as
 * much as a wrong id would: nothing.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const scope = await requireScope();
    const body = await readJson(request, markReadSchema);
    const marked = await markRead(scope, "all" in body ? { all: true } : { ids: body.ids });
    return ok({ marked, ...(await readInbox(scope)) });
  });
}
