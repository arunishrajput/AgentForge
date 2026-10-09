import { cn } from "@/components/ui/cn";

/**
 * The mark: one node branching into two.
 *
 * The motif is Chapter 1's and is deliberately kept — it is the smallest true
 * picture of what the product does, and a recognisable mark is worth more than a
 * new one. What changed in Phase 15 is the language: a cream tile with a full outline
 * and pop-filled nodes, rather than the old dark tile with unoutlined dots.
 *
 * `src/app/icon.svg` is the same drawing in literal hex, because a favicon cannot
 * read a CSS variable. If a token below moves, that file moves with it.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("shrink-0", className)}>
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="8.5"
        fill="var(--color-canvas)"
        stroke="var(--color-line)"
        strokeWidth="2.5"
      />
      <g stroke="var(--color-line)" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M12.8 16H15" />
        <path d="m15 16 3.2-4.2" />
        <path d="m15 16 3.2 4.2" />
      </g>
      <circle
        cx="9"
        cy="16"
        r="3.3"
        fill="var(--color-accent-pop)"
        stroke="var(--color-line)"
        strokeWidth="2"
      />
      <circle
        cx="21.6"
        cy="10.6"
        r="2.9"
        fill="var(--color-live-pop)"
        stroke="var(--color-line)"
        strokeWidth="2"
      />
      <circle
        cx="21.6"
        cy="21.4"
        r="2.9"
        fill="var(--color-ok-pop)"
        stroke="var(--color-line)"
        strokeWidth="2"
      />
    </svg>
  );
}

/** The mark and the name, as one object. The name is text, never an image. */
/**
 * `shrinks` — Phase 37: on a phone (below `sm`) the name yields and the mark stands alone, so the
 * shell header's controls fit once the inbox bell joined them. Measured on the deployed header:
 * 24 px of overlap and a 9 px sideways scroll at 320 px; a first cut-off at 360 px left 9 px of
 * overlap at 360, a common Android width. Below `sm` the workspace switcher — the one item that
 * shrinks, and the more informative of the two (Phase 23A) — gets the room instead of a 32 px
 * caret. Only where the link around it carries the name.
 */
export function Wordmark({ className, shrinks = false }: { className?: string; shrinks?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark className="size-7" />
      <span className={cn("text-base font-bold tracking-tight", shrinks && "max-sm:hidden")}>AgentForge</span>
    </span>
  );
}
