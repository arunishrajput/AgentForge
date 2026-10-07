/**
 * Keyboard chords, written once and printed for the reader's platform — Phase 29.
 *
 * A shortcut is stated as `mod` rather than "⌘" or "Ctrl" so the same table drives a Mac,
 * where the command key is ⌘ and modifiers are glyphs run together (`⇧⌘Z`), and
 * everything else, where it is Ctrl and the words are joined with `+` (`Ctrl+Shift+Z`).
 * Printing ⌘ to a Windows user is a shortcut they cannot find on their keyboard.
 *
 * Pure, so the labels are tested; the hook that picks the platform lives in
 * `components/ui/kbd.tsx`, because reading `navigator` is a browser concern.
 */

export type Platform = "apple" | "other";

/**
 * Whether a platform string names an Apple device. Fed `navigator.platform` (or the
 * user agent where that is empty); iPadOS reports itself as a Mac, which is correct
 * here — it uses ⌘.
 */
export function platformOf(hint: string): Platform {
  return /mac|iphone|ipad|ipod/i.test(hint) ? "apple" : "other";
}

/** One key combination: an optional modifier set and one key (or a pointer gesture). */
export interface Chord {
  /** A `KeyboardEvent.key` value, case-insensitive — or `Click`, `Drag`, `Arrows`. */
  key: string;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod?: boolean;
  /** `"any"` for keys that need Shift on some layouts and not others, like `?` and `/`. */
  shift?: boolean | "any";
}

const APPLE: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  Backspace: "⌫",
  Escape: "esc",
};

const OTHER: Record<string, string> = {
  mod: "Ctrl",
  shift: "Shift",
  Escape: "Esc",
};

const COMMON: Record<string, string> = {
  Arrows: "← ↑ ↓ →",
  Delete: "Delete",
};

/** The printed form of one token: a modifier name or a key. */
export function keyLabel(token: string, platform: Platform): string {
  const table = platform === "apple" ? APPLE : OTHER;
  if (token in table) return table[token];
  if (token in COMMON) return COMMON[token];
  return token.length === 1 ? token.toUpperCase() : token;
}

/**
 * The tokens of a chord in the order its platform prints them: on a Mac ⇧ before ⌘
 * (Apple's own menu order), elsewhere Ctrl before Shift.
 */
export function chordTokens(chord: Chord, platform: Platform): string[] {
  const modifiers: string[] = [];
  if (platform === "apple") {
    if (chord.shift === true) modifiers.push("shift");
    if (chord.mod) modifiers.push("mod");
  } else {
    if (chord.mod) modifiers.push("mod");
    if (chord.shift === true) modifiers.push("shift");
  }
  return [...modifiers, chord.key].map((token) => keyLabel(token, platform));
}

const SPOKEN: Record<string, string> = {
  shift: "Shift",
  Arrows: "arrow keys",
  Backspace: "Backspace",
  Escape: "Escape",
  "?": "question mark",
  "/": "slash",
};

/**
 * A chord in words, for a screen reader. The glyphs are not dependable there: `⇧` is
 * "upwards white arrow" to more than one reader, and `⌘` is not on a Windows user's
 * keyboard at all.
 */
export function chordSpoken(chord: Chord, platform: Platform): string {
  const words: string[] = [];
  if (chord.mod) words.push(platform === "apple" ? "Command" : "Control");
  if (chord.shift === true) words.push("Shift");
  words.push(SPOKEN[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return words.join(" ");
}

/**
 * A chord in the form `aria-keyshortcuts` wants — `Meta+Shift+Z`, `Control+D` — so a
 * control can announce its shortcut without the keys becoming part of its name.
 */
export function ariaKeyShortcut(chord: Chord, platform: Platform): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(platform === "apple" ? "Meta" : "Control");
  if (chord.shift === true) parts.push("Shift");
  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return parts.join("+");
}

/**
 * A chord as one string — for a tooltip, a hint or an accessible name. A Mac runs the
 * glyphs together (`⇧⌘Z`); a pointer gesture keeps a space (`⇧ Click`) because a glyph
 * glued to a word reads as a typo.
 */
export function chordLabel(chord: Chord, platform: Platform): string {
  const tokens = chordTokens(chord, platform);
  if (platform === "other") return tokens.join("+");
  const key = tokens.at(-1)!;
  const glyphs = tokens.slice(0, -1).join("");
  if (glyphs === "") return key;
  return key.length > 1 ? `${glyphs} ${key}` : `${glyphs}${key}`;
}
