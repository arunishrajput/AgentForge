/**
 * The four message tones, and the one table that describes them.
 *
 * A toast and an inline notice are the same statement in two places — one
 * transient, one anchored to the thing it is about — so they share a fill, a shape
 * and, importantly, a WORD. `DESIGN.md` → *Never colour alone*: the label is what
 * a red-green colourblind user and a screen reader both get instead of the hue,
 * and it is only reliably the same in both surfaces if it is written once.
 *
 * The icons are glyphs rather than SVGs on purpose: they sit inside a 24px ink
 * outline on a pop fill, at a weight that matches the type around them, and an
 * icon set would be a dependency to draw four characters.
 */
export type Tone = "ok" | "bad" | "warn" | "info";

export const TONE: Record<Tone, { fill: string; icon: string; label: string }> = {
  ok: { fill: "bg-ok-pop", icon: "✓", label: "Success" },
  bad: { fill: "bg-bad-pop", icon: "!", label: "Error" },
  warn: { fill: "bg-warn-pop", icon: "▲", label: "Warning" },
  info: { fill: "bg-live-pop", icon: "i", label: "Note" },
};

/**
 * An error interrupts; nothing else does. `alert` is assertive and cuts across
 * whatever a screen reader is saying, which is right for a failure and rude for a
 * "saved".
 */
export function liveRole(tone: Tone): "alert" | "status" {
  return tone === "bad" ? "alert" : "status";
}
