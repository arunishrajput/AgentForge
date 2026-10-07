import type { Chord } from "@/lib/ui/keys";

/**
 * The canvas's keyboard vocabulary — `BUILD_PLAN.md` Phase 29, task 5, and `DESIGN.md` →
 * *Shortcuts*.
 *
 * **One table drives both the keys and the `?` dialog.** A shortcut documented in one
 * place and bound in another is two lists that drift, and the failure is silent in both
 * directions: a key that does something nobody can discover, or a dialog promising a key
 * that does nothing. `shortcuts.test.ts` asserts the table's own invariants.
 *
 * Some rows are bound here (`handled: "canvas"`), and the editor's key handler acts on
 * them. The rest are listed because a person needs to know them, but something else
 * already owns the key and a second handler would fight it:
 *
 *   React Flow     Delete/Backspace, Shift-click, Shift-drag, the arrow keys on a node
 *   the browser    paste — the `paste` event, which carries the clipboard's text without
 *                  a permission prompt (`use-clipboard.ts` says why copy is not the same)
 *   the shell      ⌘K, the command palette, where *Find a node* lives
 *   the editor     Escape, which closes a drawer
 *
 * **Never while typing.** A key the canvas binds would otherwise steal a letter from a
 * config field — `F` would fit the view instead of typing an F, ⌘C would copy nodes
 * instead of the selected text — so the handler checks `isTypingTarget` first. The one exception is a chord with no meaning in a text field,
 * `⌘S`, which saves from anywhere; the alternative is the browser's own *Save page as*.
 */

export type ShortcutAction =
  | "undo"
  | "redo"
  | "copy"
  | "cut"
  | "duplicate"
  | "selectAll"
  | "save"
  | "fit"
  | "search"
  | "help";

export type ShortcutGroup = "Edit" | "Select" | "Canvas";

export interface Shortcut {
  id: string;
  group: ShortcutGroup;
  title: string;
  /** Alternatives. The first is the one printed in a tooltip. */
  chords: Chord[];
  /** Who acts on the key. Only `canvas` rows are matched by `matchShortcut`. */
  handled: "canvas" | "elsewhere";
  /** The editor action a `canvas` row runs. */
  action?: ShortcutAction;
  /** Fires while focus is in a text field. Only for chords that mean nothing there. */
  inFields?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "undo", group: "Edit", title: "Undo", chords: [{ key: "z", mod: true }], handled: "canvas", action: "undo" },
  {
    id: "redo",
    group: "Edit",
    title: "Redo",
    chords: [
      { key: "z", mod: true, shift: true },
      { key: "y", mod: true },
    ],
    handled: "canvas",
    action: "redo",
  },
  {
    id: "copy",
    group: "Edit",
    title: "Copy the selection",
    chords: [{ key: "c", mod: true }],
    handled: "canvas",
    action: "copy",
  },
  { id: "cut", group: "Edit", title: "Cut the selection", chords: [{ key: "x", mod: true }], handled: "canvas", action: "cut" },
  {
    id: "paste",
    group: "Edit",
    title: "Paste — into this workflow or another",
    chords: [{ key: "v", mod: true }],
    handled: "elsewhere",
  },
  {
    id: "duplicate",
    group: "Edit",
    title: "Duplicate the selection",
    chords: [{ key: "d", mod: true }],
    handled: "canvas",
    action: "duplicate",
  },
  {
    id: "delete",
    group: "Edit",
    title: "Delete the selection",
    chords: [{ key: "Delete" }, { key: "Backspace" }],
    handled: "elsewhere",
  },
  {
    id: "save",
    group: "Edit",
    title: "Save",
    chords: [{ key: "s", mod: true }],
    handled: "canvas",
    action: "save",
    inFields: true,
  },

  {
    id: "select-all",
    group: "Select",
    title: "Select every node",
    chords: [{ key: "a", mod: true }],
    handled: "canvas",
    action: "selectAll",
  },
  {
    id: "add-to-selection",
    group: "Select",
    title: "Add a node to the selection, or take it out",
    chords: [{ key: "Click", shift: true }],
    handled: "elsewhere",
  },
  {
    id: "box-select",
    group: "Select",
    title: "Select everything inside a box",
    chords: [{ key: "Drag", shift: true }],
    handled: "elsewhere",
  },
  {
    id: "nudge",
    group: "Select",
    title: "Move the selection, from a focused node — Shift for bigger steps",
    chords: [{ key: "Arrows" }],
    handled: "elsewhere",
  },

  {
    id: "find",
    group: "Canvas",
    title: "Find a node, or any command",
    chords: [{ key: "k", mod: true }],
    handled: "elsewhere",
  },
  {
    id: "search",
    group: "Canvas",
    title: "Search the node palette",
    chords: [{ key: "/", shift: "any" }],
    handled: "canvas",
    action: "search",
  },
  { id: "fit", group: "Canvas", title: "Fit the workflow to the screen", chords: [{ key: "f" }], handled: "canvas", action: "fit" },
  {
    id: "help",
    group: "Canvas",
    title: "Show these shortcuts",
    chords: [{ key: "?", shift: "any" }],
    handled: "canvas",
    action: "help",
  },
  { id: "escape", group: "Canvas", title: "Close a panel or a dialog", chords: [{ key: "Escape" }], handled: "elsewhere" },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Edit", "Select", "Canvas"];

/** The row for an action, for a tooltip or a command's hint. */
export function shortcutFor(action: ShortcutAction): Shortcut {
  return SHORTCUTS.find((shortcut) => shortcut.action === action)!;
}

/** The parts of a `KeyboardEvent` a match reads — so the matcher is testable on Node. */
export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Which canvas action a key press asks for, if any.
 *
 * `mod` is ⌘ *or* Ctrl on every platform, as ⌘K already is: holding the "wrong" one is
 * a mistake worth forgiving, and neither means anything else on the canvas. Alt never
 * matches — on a Mac it types characters (⌥Z is Ω), and those belong to the field.
 */
export function matchShortcut(event: KeyInput, typing: boolean): ShortcutAction | null {
  if (event.altKey) return null;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  for (const shortcut of SHORTCUTS) {
    if (shortcut.handled !== "canvas" || !shortcut.action) continue;
    if (typing && !shortcut.inFields) continue;
    for (const chord of shortcut.chords) {
      if (chord.key.toLowerCase() !== key) continue;
      if (Boolean(chord.mod) !== mod) continue;
      if (chord.shift !== "any" && Boolean(chord.shift) !== event.shiftKey) continue;
      return shortcut.action;
    }
  }
  return null;
}

/** The parts of an element `isTypingTarget` reads. */
export interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Input types that take no typing — a key pressed on one is a key for the page. */
const NOT_TEXT = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/**
 * Whether a key press lands in something the user is typing into: a text input, a
 * textarea, a select (which types to choose), or editable content.
 */
export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NOT_TEXT.has((target.type ?? "text").toLowerCase());
  return false;
}
