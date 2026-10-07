import type { NodeChange } from "@/lib/workflow/diff";

/**
 * The five things a node can be in a diff, and how each one looks on the canvas.
 *
 * A table, tested for distinctness, for exactly the reason `status.ts` is one: the
 * hard requirement here is `DESIGN.md` → *Never colour alone*, and five hand-written
 * class strings drift together silently. A greyscale screenshot of a diff has to still
 * read, and a reader who cannot distinguish green from red has to get the same
 * information as everyone else.
 *
 * Four channels, only one of which is hue:
 *
 *   word      "Added", "Removed" — what a screen reader announces and what is printed
 *             on the ribbon
 *   shape     a distinct glyph
 *   outline   removed is the one dashed outline; added and changed take a coloured one
 *   surface   removed is recessed, because it is not in the workflow any more —
 *             the same recessed-not-faded treatment `skipped` uses, for the same
 *             reason (this language expresses depth with outline and elevation)
 *
 * **`unchanged` is deliberately the plain card.** A diff where every node is decorated
 * is a diff with no signal in the decoration; the point of the mode is that the three
 * nodes which changed are the three that stand out.
 */

export interface ChangeLook {
  /** The status in words. Never omitted: it is what replaces the colour. */
  label: string;
  /** A glyph distinct in shape from every other change. */
  glyph: string;
  /** The ribbon's fill — a `-pop`, which by `DESIGN.md`'s rule carries an ink label. */
  fill: string;
  /**
   * The ribbon's label. `text-accent-ink` on a `-pop` fill, and `text-ink` on the one ribbon
   * that is not a fill — `moved`, on `bg-surface`. Phase 30 found the moved ribbon drawing
   * `accent-ink` on `surface`: identical to ink in Light, and near-black on indigo in Night,
   * which D126 says `accent-ink` must never be drawn anywhere but a fill.
   */
  ink: string;
  /** The card's border treatment. */
  outline: string;
  /** The card's fill. */
  surface: string;
  /** Resting elevation. */
  shadow: string;
  /** Whether this change gets a ribbon at all. Only `unchanged` does not. */
  ribbon: boolean;
}

/** Declaration order is display order wherever all five are listed at once. */
export const NODE_CHANGES: NodeChange[] = [
  "added",
  "removed",
  "changed",
  "moved",
  "unchanged",
];

const RAISED = { surface: "bg-elevated", shadow: "shadow-node" } as const;

const LOOK: Record<NodeChange, ChangeLook> = {
  added: {
    label: "Added",
    glyph: "+",
    fill: "bg-ok-pop",
    ink: "text-accent-ink",
    outline: "border-ok",
    ...RAISED,
    ribbon: true,
  },
  removed: {
    label: "Removed",
    glyph: "−",
    fill: "bg-bad-pop",
    ink: "text-accent-ink",
    // Dashed and recessed: this node is not in the newer workflow, and the card says
    // so on two channels that survive a greyscale screenshot.
    outline: "border-bad border-dashed",
    surface: "bg-sunken",
    shadow: "shadow-flat",
    ribbon: true,
  },
  changed: {
    label: "Changed",
    glyph: "~",
    fill: "bg-warn-pop",
    ink: "text-accent-ink",
    outline: "border-warn",
    ...RAISED,
    ribbon: true,
  },
  moved: {
    label: "Moved",
    // The quiet one of the four, and on purpose: a node that was dragged did not
    // change what the workflow does. It is worth reporting and not worth shouting.
    glyph: "⤢",
    fill: "bg-surface",
    ink: "text-ink",
    outline: "border-line",
    ...RAISED,
    ribbon: true,
  },
  unchanged: {
    label: "Unchanged",
    glyph: "",
    fill: "",
    ink: "",
    outline: "border-line",
    ...RAISED,
    ribbon: false,
  },
};

export function changeLook(change: NodeChange): ChangeLook {
  return LOOK[change];
}

/** What a `changed` node's field list reads as. `fields` is never empty for one. */
export const FIELD_WORDS: Record<string, string> = {
  type: "node type",
  label: "name",
  config: "configuration",
  policy: "retry and timeout",
  // Phase 30's note fields. `disabled` is not here: its word depends on which way it went.
  text: "text",
  tone: "colour",
  size: "size",
};

/**
 * The ribbon's words. `disabledNow` says which way a `disabled` change went — Phase 30's
 * ribbon names *what* changed, and "switched off" and "switched on" are two different
 * statements about what the workflow now does, where "on/off state" would be neither.
 */
export function fieldWords(fields: readonly string[], disabledNow = false): string {
  const words = fields.map((field) =>
    field === "disabled" ? (disabledNow ? "switched off" : "switched on") : (FIELD_WORDS[field] ?? field),
  );
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
