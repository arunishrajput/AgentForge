import type { RunStatus, StepStatus } from "./client";

/**
 * The nine things a node can be on the canvas, and how each one looks — five run states,
 * since Phase 30 a node that is switched off, since Phase 31 a node a test run took from its
 * pinned output, since Phase 33 a node a retry carried over from the run it retries, and since
 * Phase 37 a node that failed and whose error its on-error policy handled.
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
 *   outline   `failed` reddens the card's border, `skipped` makes it dashed and
 *             `disabled` dotted
 *   surface   `skipped` and `disabled` are recessed rather than lifted
 *   motion    a one-shot boing on success, a short wiggle on failure
 *
 * So a monochrome screenshot of a run still reads: a dashed, sunken card was skipped,
 * a dotted, sunken one is switched off, a bobbing one is working, a ticked one finished.
 *
 * **`disabled` is a property of the graph as well as a step status** (Phase 30,
 * `CONTRACT.md` → *Disabled nodes*). A switched-off node wears it whether or not a run has
 * reached it, because what the card has to say is *this will not run*; and a run that does
 * reach it records a `disabled` step, so the run panel says the same thing in the same
 * word.
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
  "disabled",
  "pinned",
  "reused",
  "handled",
];

/** What a card that is not recessed looks like. Seven of the nine share it. */
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
  /**
   * Phase 30. Recessed like `skipped`, because it is also a node the run does not execute —
   * and told apart from it by the outline's *shape*, dotted rather than dashed, so the two
   * survive a greyscale screenshot as two things: *the run went another way* and *this is off*.
   * The words are the product's own for a workflow that will not run by itself.
   */
  disabled: {
    label: "Switched off",
    glyph: "⊘",
    tone: "text-muted",
    outline: "border-line border-dotted",
    surface: "bg-sunken",
    shadow: "shadow-flat",
    motion: "",
    dots: false,
  },
  /**
   * Phase 31. A test run reached the node and used its pinned output instead of running it.
   * Raised, because unlike *skipped* and *switched off* the node did hand a real value on — and
   * told apart from *succeeded* by its word, its glyph and its stillness: no boing, because
   * nothing happened that deserves one. The accent tone is the product's colour for *this is
   * yours* — what was pinned is something the author put there.
   */
  pinned: {
    label: "Pinned",
    glyph: "◆",
    tone: "text-accent",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: false,
  },
  /**
   * Phase 33. A retry carried this step over from the run it retries — it ran there and handed
   * the same value on here, so it is raised like a node that ran. It is still and muted, with a
   * word and a glyph of its own, because nothing happened to it *in this run*: the work on this
   * canvas starts at the first node that is not wearing it.
   */
  reused: {
    label: "Reused",
    glyph: "↺",
    tone: "text-muted",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: false,
  },
  /**
   * Phase 37. The node failed and its on-error policy carried the run on (D175). Raised, because
   * it handed a value on — its error. The warning hue on the word and the outline rather than the
   * failure's red, because the run did not stop here; told apart from *failed* in greyscale by its
   * word and its glyph — an arrow turning aside, the run going another way — and by keeping still:
   * the wiggle means *look here, this stopped the run*, and this did not.
   */
  handled: {
    label: "Handled",
    glyph: "↪",
    tone: "text-warn",
    outline: "border-warn",
    ...RAISED,
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
export function nodeStatusLook(
  status: NodeStatus,
  agent = false,
  /**
   * The run this step belongs to is `waiting` — Phase 26. The step is genuinely still
   * running (a delay is not over until the run wakes), but "Running" over a card that
   * will not change for two days reads as stuck. "Waiting" with the clock glyph says what
   * it is doing, and the bobbing dots stop, because nothing is.
   */
  paused = false,
): StatusLook {
  const look = LOOK[status];
  if (status === "running" && paused) return { ...look, label: "Waiting", glyph: WAITING_GLYPH, dots: false };
  return status === "running" && agent ? { ...look, label: "Thinking" } : look;
}

/** The waiting clock — one glyph for a paused step and a waiting run, so they read alike. */
const WAITING_GLYPH = "◷";

/**
 * The run's own status, which is a different set from a step's.
 *
 * A run can be `queued` or `cancelled`, neither of which a step can be, and mapping
 * them onto the step vocabulary was the tempting shortcut: `cancelled` would have
 * rendered as "Skipped", which is a different statement about what happened and a
 * wrong one. Six entries with their own words is cheaper than one wrong word — the sixth,
 * `waiting`, is Phase 26's.
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
  /**
   * Phase 26. Not running and not finished: put down until its wake time, with nothing
   * executing it. The live tone because it is still this run's story, not history — and
   * a clock rather than the dots, because the dots mean *working* and nothing is.
   */
  waiting: {
    label: "Waiting",
    glyph: WAITING_GLYPH,
    tone: "text-live",
    outline: "border-line",
    ...RAISED,
    motion: "",
    dots: false,
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

/**
 * **The tone of a step's error message — Phase 37.** A failure's words are red; a handled one's
 * take the warning hue its card wears, because the run went on past it — red under an amber outline
 * would say two things at once. Found by the browser walk, on the card and in every step list.
 */
export function stepErrorTone(status: StepStatus | undefined): "text-bad" | "text-warn" {
  return status === "handled" ? "text-warn" : "text-bad";
}

export function runStatusLook(status: RunStatus): StatusLook {
  return RUN_LOOK[status];
}

/**
 * **How an edge is drawn once a run has been by — Phase 5's lit path.** `live` animates the
 * flow into the node working now; `traversed` keeps lit every edge the run actually crossed;
 * `null` is a plain edge. On a branch the untaken edge never lights, so a finished run leaves
 * the path it chose on the canvas.
 *
 * An edge is crossed when its source **handed a value on** — it succeeded, was switched off and
 * passed its input through (Phase 30), or stood in with its pinned output (Phase 31) — and the
 * run reached its target. A pinned node was the one Phase 31's browser walk found the path
 * going dark after, because this rule named only the first two — and a step a retry carried over
 * (Phase 33) handed its value on too, as does one whose error was handled (Phase 37): an edge out of
 * its Error output lights when the run went that way, because the target says it was reached.
 */
const HANDED_ON: ReadonlySet<StepStatus> = new Set(["succeeded", "disabled", "pinned", "reused", "handled"]);

export function edgeRunLook(
  source: StepStatus | undefined,
  target: StepStatus | undefined,
  running: boolean,
): "live" | "traversed" | null {
  if (source === undefined || !HANDED_ON.has(source)) return null;
  if (running && target === "running") return "live";
  if (target !== undefined && target !== "skipped") return "traversed";
  return null;
}
