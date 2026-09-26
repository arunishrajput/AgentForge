import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * Illustration and character.
 *
 * All of it is inline SVG referencing the design tokens by `var(--color-*)`, which
 * is the reason it is a component and not a file in `public/`: an `<img src>` cannot
 * read a CSS variable, so a token change would leave the artwork behind. The copies
 * in `public/illustrations/` exist only for the README and the docs site, where
 * literal hex is unavoidable — `DESIGN.md` → *Illustration* records that they are
 * generated from these and must be regenerated when a token moves.
 *
 * Every drawing here obeys the same three rules as the rest of the system: a 3px ink
 * outline on every shape, a hard offset shadow where something is meant to sit on
 * the page, and no gradient. They are drawn on a 3px grid so the strokes line up
 * with the UI's 2px outlines rather than fighting them.
 *
 * Everything is `aria-hidden`. An illustration in an empty state is decoration over
 * a heading and a sentence that already say what is going on; announcing it twice
 * is noise. `EmptyState` below is what carries the text.
 */

const STROKE = { stroke: "var(--color-ink)", strokeWidth: 3, strokeLinejoin: "round" } as const;

export type MascotMood = "happy" | "thinking" | "concerned";

/**
 * Sparky — the forge sprite. An ingot with a flame, which is as much character as a
 * developer tool can carry without becoming a toy shop.
 *
 * Three moods, and the third one is the careful one. `BUILD_PLAN.md` Phase 14 is
 * explicit: a mascot must not read as flippant when someone's workflow has just
 * failed. So `concerned` is *attentive*, not sad — level mouth, lowered brows, no
 * tears, no shrug — it is rendered small in error contexts, and it never replaces
 * the error text. `DESIGN.md` → *When the mascot may appear* is the binding form of
 * that rule.
 */
export function Mascot({
  mood = "happy",
  className,
  float = false,
}: {
  mood?: MascotMood;
  className?: string;
  float?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("shrink-0", float && "animate-float", className)}
    >
      {/* The flame, drawn first so the body's outline closes over its base. */}
      <path
        d="M32 3c5 6 9 9 9 13a9 9 0 0 1-18 0c0-4 4-7 9-13z"
        fill="var(--color-warn-pop)"
        {...STROKE}
      />
      {/* Feet, also behind the body. */}
      <path d="M20 50h7v6h-7z" fill="var(--color-ink)" />
      <path d="M37 50h7v6h-7z" fill="var(--color-ink)" />
      {/* The body. */}
      <rect
        x="9"
        y="20"
        width="46"
        height="32"
        rx="12"
        fill="var(--color-accent-pop)"
        {...STROKE}
      />

      {mood === "concerned" && (
        <>
          {/* Worried brows: the INNER ends are raised. The first draft had them
              lowered toward the nose, which is the geometry of anger — on a
              deployed error screen it read as cross with the user, which is worse
              than the flippancy the phase warns about. Caught by looking at it. */}
          <path d="M19 30l8 -3" fill="none" strokeLinecap="round" {...STROKE} />
          <path d="M45 30l-8 -3" fill="none" strokeLinecap="round" {...STROKE} />
        </>
      )}

      {mood === "thinking" ? (
        <>
          {/* Eyes up and to the side — the universal shorthand for working on it. */}
          <circle cx="26" cy="33" r="4" fill="var(--color-ink)" />
          <circle cx="42" cy="33" r="4" fill="var(--color-ink)" />
          <circle cx="32" cy="43" r="3" fill="none" {...STROKE} />
        </>
      ) : (
        <>
          <circle cx="24" cy="36" r="4.2" fill="var(--color-ink)" />
          <circle cx="40" cy="36" r="4.2" fill="var(--color-ink)" />
          {mood === "happy" ? (
            <path d="M25 44q7 6 14 0" fill="none" strokeLinecap="round" {...STROKE} />
          ) : (
            <path d="M26 45h12" fill="none" strokeLinecap="round" {...STROKE} />
          )}
        </>
      )}
    </svg>
  );
}

/**
 * The agent "thinking" indicator: Sparky plus three bobbing dots.
 *
 * `aria-live="polite"` with the state written out, because a bobbing dot is not
 * information. The label is a real sentence so the announcement is a sentence.
 */
export function Thinking({ label = "The agent is thinking", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-live="polite">
      <Mascot mood="thinking" className="size-7" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex items-end gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bg-cat-agent border-line animate-think size-2 rounded-full border-2"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
    </span>
  );
}

/** A node card, as a drawing. The building block of three of the four scenes. */
function NodeGlyph({
  x,
  y,
  fill,
  width = 34,
}: {
  x: number;
  y: number;
  fill: string;
  width?: number;
}) {
  return (
    <>
      <rect x={x + 3} y={y + 3} width={width} height="22" rx="6" fill="var(--color-ink)" />
      <rect x={x} y={y} width={width} height="22" rx="6" fill="var(--color-elevated)" {...STROKE} />
      <rect x={x + 5} y={y + 5} width="8" height="8" rx="3" fill={fill} {...STROKE} strokeWidth={2} />
      <path
        d={`M${x + 17} ${y + 9}h${width - 22}`}
        stroke="var(--color-muted)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d={`M${x + 17} ${y + 15}h${width - 27}`}
        stroke="var(--color-faint)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </>
  );
}

/**
 * "Nothing here yet" — an empty workbench. Two blank node cards and a slot waiting
 * for a third, which is the state it illustrates: the tools exist, nothing is built.
 */
export function WorkbenchArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true" className={className}>
      {/* The bench. */}
      <rect x="6" y="78" width="148" height="16" rx="7" fill="var(--color-warn-pop)" {...STROKE} />
      <path d="M22 94v10M138 94v10" strokeLinecap="round" {...STROKE} />
      <NodeGlyph x={18} y={30} fill="var(--color-cat-trigger-pop)" />
      <NodeGlyph x={66} y={48} fill="var(--color-cat-agent-pop)" />
      {/* The waiting slot. */}
      <rect
        x="114"
        y="30"
        width="34"
        height="22"
        rx="6"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="3"
        strokeDasharray="6 5"
        strokeLinecap="round"
      />
      <path d="M131 35v12M125 41h12" strokeLinecap="round" {...STROKE} />
      <path
        d="M52 41q14 0 14 13"
        fill="none"
        strokeLinecap="round"
        stroke="var(--color-ink)"
        strokeWidth="3"
      />
    </svg>
  );
}

/**
 * "This canvas is empty" — three loose node cards and a dashed connector, one of
 * them mid-drag. It says: pieces go here and they join up.
 */
export function CanvasArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true" className={className}>
      <NodeGlyph x={10} y={18} fill="var(--color-cat-trigger-pop)" />
      <NodeGlyph x={62} y={52} fill="var(--color-cat-logic-pop)" />
      <NodeGlyph x={112} y={16} fill="var(--color-cat-integration-pop)" width={38} />
      <path
        d="M46 29q18 2 18 23"
        fill="none"
        strokeLinecap="round"
        stroke="var(--color-ink)"
        strokeWidth="3"
      />
      <path
        d="M98 63q16 0 16-20"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="6 6"
        stroke="var(--color-ink)"
        strokeWidth="3"
      />
      {/* The cursor, because something is being built rather than watched. */}
      <path
        d="M104 74l16 6-6 3-3 7z"
        fill="var(--color-elevated)"
        {...STROKE}
        strokeWidth="2.5"
      />
    </svg>
  );
}

/**
 * "Nothing has run yet" — a quiet scene. A coiled, unplugged cable rather than a
 * clock: the point is that the machine is idle and ready, not that time is passing.
 */
export function QuietArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true" className={className}>
      <rect x="14" y="34" width="46" height="40" rx="12" fill="var(--color-surface)" {...STROKE} />
      <circle cx="27" cy="50" r="4" fill="var(--color-ink)" />
      <circle cx="47" cy="50" r="4" fill="var(--color-ink)" />
      <path d="M28 62h18" strokeLinecap="round" {...STROKE} />
      {/* The cable, coiled and not reaching. */}
      <path
        d="M60 60q22 14 36-2t30 0"
        fill="none"
        strokeLinecap="round"
        stroke="var(--color-ink)"
        strokeWidth="3"
      />
      <rect
        x="124"
        y="48"
        width="20"
        height="16"
        rx="5"
        fill="var(--color-live-pop)"
        {...STROKE}
      />
      <path d="M144 53h8M144 59h8" strokeLinecap="round" {...STROKE} />
      {/* The socket it is not in. */}
      <rect
        x="118"
        y="80"
        width="30"
        height="18"
        rx="6"
        fill="none"
        strokeDasharray="6 5"
        strokeLinecap="round"
        {...STROKE}
      />
    </svg>
  );
}

/**
 * "Something broke" — a node card with its wire pulled out. Used by `error.tsx` and
 * `not-found.tsx`. No mascot in the drawing: on a failure the character appears
 * small and separately, if at all.
 */
export function BrokenArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true" className={className}>
      <NodeGlyph x={12} y={40} fill="var(--color-cat-trigger-pop)" />
      <NodeGlyph x={108} y={40} fill="var(--color-bad-pop)" width={38} />
      {/* Two frayed ends that do not meet. */}
      <path
        d="M48 51h18"
        fill="none"
        strokeLinecap="round"
        stroke="var(--color-ink)"
        strokeWidth="3"
      />
      <path
        d="M92 51h16"
        fill="none"
        strokeLinecap="round"
        stroke="var(--color-ink)"
        strokeWidth="3"
      />
      <path
        d="M70 44l6 7-6 7M86 44l-6 7 6 7"
        fill="none"
        strokeLinecap="round"
        stroke="var(--color-bad)"
        strokeWidth="3"
      />
    </svg>
  );
}

/**
 * The composed empty state: a drawing, a heading, one sentence, and the action that
 * resolves it.
 *
 * The action is the part that matters. An empty state without one is a dead end
 * dressed up as a picture, and this component takes `action` before `children` so
 * that omitting it is a visible choice at the call site.
 */
export function EmptyState({
  art,
  title,
  description,
  action,
  level = 3,
  className,
}: {
  art: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  /**
   * The heading level. It defaults to 3 because the usual caller is a region
   * inside a page that already has an `h1` — but on a screen that IS the empty
   * state, the 404 and the error boundary, the title is the page's only heading
   * and has to be the `h1`, or the document has none at all.
   */
  level?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = `h${level}` as const;

  return (
    <div
      className={cn(
        "animate-rise flex flex-col items-center gap-4 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="w-full max-w-56">{art}</div>
      <div className="max-w-sm space-y-1.5">
        <Heading className={level === 1 ? "text-2xl font-bold tracking-tight" : "text-base font-bold"}>
          {title}
        </Heading>
        <p className="text-muted text-sm text-pretty">{description}</p>
      </div>
      {action}
    </div>
  );
}
