import { z } from "zod";

/**
 * **Tags — the rules, with no database in sight** (Phase 32, D144).
 *
 * A tag is a word a workspace files its workflows under. The rows live in `tag` and
 * `workflow_tag` (`db/schema.ts`) and the queries in `./library.ts`; this module is the part
 * the browser needs too — the list filters by tag and the dialogs check a name before they
 * send it — so it imports nothing but zod.
 *
 * **Why tags and not folders** (D145): a workflow often belongs in two places at once — *billing*
 * and *weekly* — and a folder makes the author choose one. Tags cover what folders would, with
 * one level and no tree to keep consistent, and a filter that is a single equality.
 */

/** Long enough for "customer onboarding", short enough to sit on a card beside four others. */
export const TAG_NAME_MAX = 32;

/**
 * **A workspace holds at most 100 tags, and a workflow wears at most 10.** Sanity bounds, not
 * security ones: they keep the filter a list a person can read and a card a row it can fit.
 * The workspace's is checked by a count before the insert, so two creations at the same moment
 * can pass it by one — which is harmless, and the alternative is a lock `neon-http` cannot take.
 */
export const WORKSPACE_TAG_LIMIT = 100;
export const WORKFLOW_TAG_LIMIT = 10;

/**
 * A tag's name: trimmed, inner whitespace collapsed to one space, 1–32 characters, and no
 * control characters — a name is printed on a card and in a URL, never interpreted.
 * `.trim()` before `.min(1)`, or `"   "` passes (`PROGRESS.md` → *Engineering rules*).
 */
export const tagNameSchema = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "A tag needs a name.")
      .max(TAG_NAME_MAX, `A tag name can be at most ${TAG_NAME_MAX} characters.`)
      // oxlint-disable-next-line no-control-regex -- refusing control characters is the point.
      .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), "A tag name cannot hold control characters."),
  );

export interface TagSummary {
  id: string;
  name: string;
}

/**
 * Whether two names are the same tag. Case-insensitive, matching the database's unique index
 * on `lower(name)` — so the browser refuses "Billing" beside "billing" for the same reason the
 * database would.
 */
export function sameTagName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The tag with this name, if the list holds one. */
export function findTag<T extends TagSummary>(tags: readonly T[], name: string): T | undefined {
  return tags.find((tag) => sameTagName(tag.name, name));
}

/** Tags in the order every surface lists them: by name, ignoring case, numbers in order. */
export function sortTags<T extends TagSummary>(tags: readonly T[]): T[] {
  return tags.toSorted((a, b) =>
    a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }),
  );
}
