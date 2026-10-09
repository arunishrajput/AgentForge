/**
 * Join class names, dropping anything falsy.
 *
 * Every primitive in this directory takes a `className` so a call site can add a
 * layout class without a wrapper div, which means every primitive has to merge two
 * strings. That is the whole job. There is no Tailwind-aware conflict resolution
 * here on purpose: `tailwind-merge` is 40 kB to solve a problem the primitives
 * avoid by construction — a caller adds layout a primitive does not set.
 *
 * **Not by the caller's class "coming last".** Two utilities for one property on one
 * element are decided by the order of the *stylesheet*, not of the class attribute:
 * `Keys` sets `inline-flex`, the command palette passed `hidden sm:inline-flex`, and the
 * ⌘K cap showed on phones from Phase 29 until Phase 37. A caller that needs to hide a
 * primitive wraps it; `primitives.test.ts` refuses a display class handed to one that
 * sets its own.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
