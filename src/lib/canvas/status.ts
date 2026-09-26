import type { RunStatus, StepStatus } from "./client";

/**
 * The five things a node can be on the canvas, and how each one looks.
 *
 * A table rather than a chain of ternaries in the node component, because this is the
 * phase's one hard accessibility requirement and it is worth being able to assert:
 * `BUILD_PLAN.md` Phase 16 asks for "each visually distinct at a glance and without
 * relying on colour alone", and `DESIGN.md` → *Never colour alone* is the rule it
 * comes from. `status.test.ts` checks the distinctness rather than trusting that five
 * hand-written class strings stayed different from each other.
 *
 * Each status is carried on **five** channels, only one of which is hue:
 *
 *   word      "Succeeded" — the one a screen reader and a colourblind user get
 *   shape     a distinct glyph, or, for `running`, the three bobbing dots
 *   outline   `failed` reddens the card's border, `skipped` makes it dashed
 *   surface   `skipped` is recessed rather than lifted
 *   motion    a one-shot boing on success, a short wiggle on failure
 *
 * So a monochrome screenshot of a run still reads: a dashed, sunken card was skipped,
 * a bobbing one is working, a ticked one finished.
 */

/**
 * A node with no step in the run currently on screen is `idle`. The engine has no such
 * status — nothing is recorded for a node that has not run — so it exists here and
 * only here, which is why this is `StepStatus` widened rather than the engine's type
 * edited.
 */
export type NodeStatus = StepStatus | "idle";

export interface StatusLook {
  /** The status in words. Never omitted: it is what replaces the colour. */
  label: string;
  /** A glyph distinct in shape from every other status. Empty when `dots` is set. */
  glyph: string;
  /** The chip's text tone. The chip's own fill is the recessed neutral — see `chip`. */
  tone: string;
  /** The card's border treatment. */
  outline: string;
  /**
   * The card's fill. A node the run deliberately stepped over is drawn **recessed**
   * rather than faded: `DESIGN.md` says elevation in this language is the outline and
   * the shadow rather than the lightness, so a skipped node sits *in* the page instead
   * of on it. See the note below for what this replaced, and why.
   */
  surface: string;
  /** Resting elevation. Selection overrides it by lifting the card. */
  shadow: string;
  /** A one-shot entry animation from the `DESIGN.md` motion vocabulary, or "". */
  motion: string;
  /** The `waiting` state: three bobbing dots instead of a glyph. Only `running`. */
  dots: boolean;
}

/**
 * **Why `skipped` is not simply `opacity-65`.**
 *
 * It was, for one build, and it did nothing whatsoever. The node card carried
 * `animate-rise`, whose `animation-fill-mode: both` leaves the keyframe's final
 * `opacity: 1` applied once the animation ends — and a filled animation outranks an
 * ordinary declaration in the cascade, so the `opacity-65` on that same element was
 * overridden the instant the entry animation finished. The class sat in the DOM doing
 * nothing, which no test in this repository could see and one `getComputedStyle` call
 * made obvious.
 *
 * Two things came out of that. The entry animation moved to a wrapper element, so the
 * card's own opacity is usable at all; and the skipped treatment moved to surface and
 * shadow, which no animation in this system touches and which say the same thing
 * better — this language expresses depth with outline and elevation, not lightness.
 *
 * The selected lift was never affected, and it is worth writing down why, because the
 * two look like the same bug: Tailwind compiles `-translate-x-px` to the `translate`
 * property while the keyframe animates `transform`, so those two never collide.
 */

/** Declaration order is display order wherever all five are listed at once. */
export const NODE_STATUSES: NodeStatus[] = [
  "idle",
  "running",
  "succeeded",
  "failed",
  "skipped",
];

/** What a card that is not skipped looks like. Four of the five share it. */
const RAISED = { surface: "bg-elevated", shadow: "shadow-node" } as const;

const LOOK: Record<NodeStatus, StatusLook> = {
  idle: {
    label: "Idle",
    glyph: "○",
    tone: "text-muted",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: false,
  },
  running: {
    label: "Running",
    // No glyph: the three bobbing dots are this status's shape, and they are the
    // product's own `waiting` state. `DESIGN.md` forbids a spinner outright.
    glyph: "",
    tone: "text-live",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: true,
  },
  succeeded: {
    label: "Succeeded",
    glyph: "✓",
    tone: "text-ok",
    outline: "border-line",
    ...RAISED,
    motion: "animate-boing",
    dots: false,
  },
  failed: {
    label: "Failed",
    glyph: "!",
    tone: "text-bad",
    outline: "border-bad",
    ...RAISED,
    // Small and short on purpose. It says "look here", not "your work is gone".
    motion: "animate-wiggle",
    dots: false,
  },
  skipped: {
    label: "Skipped",
    glyph: "–",
    tone: "text-muted",
    // The one dashed outline in the product, and the one recessed card. A branch not
    // taken survives a greyscale screenshot on both channels.
    outline: "border-line border-dashed",
    surface: "bg-sunken",
    shadow: "shadow-flat",
    motion: "",
    dots: false,
  },
};

/**
 * `agent` renames the running state to "Thinking".
 *
 * An agent node genuinely is thinking — it is in a tool-calling loop deciding what to
 * do — and the phase asks for status as *character*. Every other node is doing
 * something defined, so it is running. The distinction costs one word and is the
 * difference between a graph that reports and a graph that narrates.
 */
export function nodeStatusLook(status: NodeStatus, agent = false): StatusLook {
  const look = LOOK[status];
  return status === "running" && agent ? { ...look, label: "Thinking" } : look;
}

/**
 * The run's own status, which is a different set from a step's.
 *
 * A run can be `queued` or `cancelled`, neither of which a step can be, and mapping
 * them onto the step vocabulary was the tempting shortcut: `cancelled` would have
 * rendered as "Skipped", which is a different statement about what happened and a
 * wrong one. Five entries with their own words is cheaper than one wrong word.
 *
 * `outline`, `surface` and `shadow` go unused here — a run is not a card on the canvas
 * — but the shape is shared so the chip that renders either one needs no second code
 * path.
 */
const RUN_LOOK: Record<RunStatus, StatusLook> = {
  queued: {
    label: "Queued",
    glyph: "◌",
    tone: "text-muted",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: false,
  },
  running: {
    label: "Running",
    glyph: "",
    tone: "text-live",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: true,
  },
  succeeded: {
    label: "Succeeded",
    glyph: "✓",
    tone: "text-ok",
    outline: "border-line",
    ...RAISED,
    motion: "animate-boing",
    dots: false,
  },
  failed: {
    label: "Failed",
    glyph: "!",
    tone: "text-bad",
    outline: "border-bad",
    ...RAISED,
    motion: "animate-wiggle",
    dots: false,
  },
  cancelled: {
    label: "Cancelled",
    glyph: "✕",
    tone: "text-muted",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: false,
  },
};

export const RUN_STATUSES = Object.keys(RUN_LOOK) as RunStatus[];

export function runStatusLook(status: RunStatus): StatusLook {
  return RUN_LOOK[status];
}
