import { handle, ok, requireScope } from "@/lib/api";
import { readInbox } from "@/lib/inbox/store";

export const dynamic = "force-dynamic";

/**
 * The reader's inbox in their active workspace — Phase 37 (D177): the newest entries and how many
 * are unread. **Every role** has one: a viewer may read a failed run, so a viewer is told about it.
 *
 * The header does not call this — it reads the same store when the page renders, so a page load
 * costs no second request — and **nothing polls it**. It is here for a script, and for the API's
 * own completeness.
 */
export async function GET() {
  return handle(async () => {
    const scope = await requireScope();
    return ok(await readInbox(scope));
  });
}
