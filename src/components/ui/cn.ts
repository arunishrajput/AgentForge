/**
 * Join class names, dropping anything falsy.
 *
 * Every primitive in this directory takes a `className` so a call site can add a
 * layout class without a wrapper div, which means every primitive has to merge two
 * strings. That is the whole job. There is no Tailwind-aware conflict resolution
 * here on purpose: `tailwind-merge` is 40 kB to solve a problem the primitives
 * avoid by construction, because a caller's class always comes last and CSS
 * source order already makes it win.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
