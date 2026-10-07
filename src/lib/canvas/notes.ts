import { NOTE_TONES, type NoteTone } from "@/lib/workflow/graph";

/**
 * What a sticky note looks like — Phase 30.
 *
 * **Every tone is a fill the palette already has**, not a new colour. A note is a `-pop`
 * fill with an `accent-ink` label inside an ink outline — `DESIGN.md`'s rule for a fill,
 * all three parts — so it needs a fill the contrast gates have already proved against that
 * label and that outline, in Light *and* in Toybox Night. Five new tokens would have been
 * five more rows in both themes' matrices for a note's colour, which carries no meaning:
 * the tone is the author's to choose, and it says nothing a reader must not miss.
 *
 * So it is never "colour alone" either, because it is never information. The word for each
 * tone is still here, because the tone picker is a set of swatches and a swatch needs a name.
 *
 * Every class is a **literal**, for the reason `categories.ts` gives: a class built by
 * concatenation compiles to nothing, silently.
 */

export interface NoteLook {
  /** The tone in a word — the swatch's accessible name. */
  label: string;
  /** A `-pop` fill. Only ever a background, under `text-accent-ink`, inside `border-line`. */
  fill: string;
}

const LOOK: Record<NoteTone, NoteLook> = {
  // The amber is the classic sticky note. In Night it is bronze, by design (D121).
  yellow: { label: "Yellow", fill: "bg-warn-pop" },
  pink: { label: "Pink", fill: "bg-cat-agent-pop" },
  blue: { label: "Blue", fill: "bg-live-pop" },
  green: { label: "Green", fill: "bg-ok-pop" },
  purple: { label: "Purple", fill: "bg-accent-pop" },
};

/** A new note's tone. */
export const DEFAULT_NOTE_TONE: NoteTone = "yellow";

export function noteLook(tone: NoteTone): NoteLook {
  return LOOK[tone] ?? LOOK[DEFAULT_NOTE_TONE];
}

/** The tones in picker order. */
export const NOTE_TONE_ORDER: readonly NoteTone[] = NOTE_TONES;

/**
 * A note's text as a name — for React Flow's `aria-label` on the note, a selection list and
 * the inspector's title. One line, cut short, and never empty.
 */
export function noteName(text: string, limit = 48): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line === "") return "Empty note";
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}
