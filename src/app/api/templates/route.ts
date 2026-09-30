import { handle, ok, requireScope } from "@/lib/api";
import { describeTemplates } from "@/lib/templates/catalogue";

export const dynamic = "force-dynamic";

/**
 * `GET /api/templates` — the gallery.
 *
 * Reads a module-level constant rather than the database, so it costs no query on a
 * metered instance (`CLAUDE.md` → *Cost rules*): the whole point of templates being
 * graph literals is that listing them touches nothing.
 *
 * Still behind `requireScope`, though it is the same list for everybody. The page
 * offering "use this template" is only meaningful to somebody who has a workspace to
 * put it in, and an unauthenticated surface is a thing to add deliberately, never by
 * omission — the product has four and each one is argued for in `CONTRACT.md`.
 */
export async function GET() {
  return handle(async () => {
    await requireScope();
    return ok(describeTemplates());
  });
}
