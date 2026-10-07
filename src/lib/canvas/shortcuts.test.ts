import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTypingTarget,
  matchShortcut,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  shortcutFor,
  type KeyInput,
  type ShortcutAction,
} from "./shortcuts";

const press = (key: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("the shortcut table", () => {
  it("gives every row a group the dialog prints, a title and at least one chord", () => {
    const ids = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      assert.ok(SHORTCUT_GROUPS.includes(shortcut.group), shortcut.id);
      assert.ok(shortcut.title.length > 0, shortcut.id);
      assert.ok(shortcut.chords.length > 0, shortcut.id);
      assert.ok(!ids.has(shortcut.id), `duplicate id ${shortcut.id}`);
      ids.add(shortcut.id);
    }
  });

  it("binds every canvas row to an action, and documents the rest without one", () => {
    for (const shortcut of SHORTCUTS) {
      assert.equal(shortcut.handled === "canvas", shortcut.action !== undefined, shortcut.id);
    }
  });

  it("binds every action exactly once", () => {
    const actions: ShortcutAction[] = [
      "undo",
      "redo",
      "copy",
      "cut",
      "duplicate",
      "selectAll",
      "save",
      "fit",
      "search",
      "help",
      "toggleDisabled",
      "addNote",
    ];
    for (const action of actions) {
      assert.equal(SHORTCUTS.filter((s) => s.action === action).length, 1, action);
      assert.equal(shortcutFor(action).action, action);
    }
  });

  it("never binds one chord twice", () => {
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      for (const chord of shortcut.chords) {
        const id = `${chord.mod ? "mod+" : ""}${chord.shift === true ? "shift+" : ""}${chord.key.toLowerCase()}`;
        assert.ok(!seen.has(id), `${id} is bound twice`);
        seen.add(id);
      }
    }
  });

  it("matches every chord it prints for a canvas row", () => {
    for (const shortcut of SHORTCUTS.filter((s) => s.handled === "canvas")) {
      for (const chord of shortcut.chords) {
        const event = press(chord.key, { metaKey: Boolean(chord.mod), shiftKey: chord.shift === true });
        assert.equal(matchShortcut(event, false), shortcut.action, `${shortcut.id}: ${chord.key}`);
      }
    }
  });
});

describe("matching a key press", () => {
  it("reads ⌘ and Ctrl alike, as ⌘K does", () => {
    assert.equal(matchShortcut(press("z", { metaKey: true }), false), "undo");
    assert.equal(matchShortcut(press("z", { ctrlKey: true }), false), "undo");
  });

  it("tells undo from redo by Shift, whatever case the browser reports the letter in", () => {
    assert.equal(matchShortcut(press("z", { metaKey: true, shiftKey: true }), false), "redo");
    assert.equal(matchShortcut(press("Z", { metaKey: true, shiftKey: true }), false), "redo");
    assert.equal(matchShortcut(press("y", { ctrlKey: true }), false), "redo");
  });

  it("does not take a plain letter as its ⌘ chord, or the reverse", () => {
    assert.equal(matchShortcut(press("z"), false), null);
    assert.equal(matchShortcut(press("f", { metaKey: true }), false), null, "⌘F stays the browser's find");
    assert.equal(matchShortcut(press("F", { shiftKey: true }), false), null);
  });

  it("finds ? and / with or without Shift, which differs by keyboard layout", () => {
    assert.equal(matchShortcut(press("?", { shiftKey: true }), false), "help");
    assert.equal(matchShortcut(press("/"), false), "search");
    assert.equal(matchShortcut(press("/", { shiftKey: true }), false), "search");
  });

  it("never matches with Alt held — it types characters on a Mac", () => {
    assert.equal(matchShortcut(press("z", { metaKey: true, altKey: true }), false), null);
    assert.equal(matchShortcut(press("f", { altKey: true }), false), null);
  });

  it("leaves the keys others own alone", () => {
    for (const key of ["v", "k"]) {
      assert.equal(matchShortcut(press(key, { metaKey: true }), false), null, key);
    }
    assert.equal(matchShortcut(press("Delete"), false), null);
    assert.equal(matchShortcut(press("Escape"), false), null);
  });

  it("while typing, lets every key through to the field except ⌘S", () => {
    for (const [key, modifiers] of [
      ["f", {}],
      ["/", {}],
      ["?", { shiftKey: true }],
      ["z", { metaKey: true }],
      ["z", { metaKey: true, shiftKey: true }],
      ["a", { metaKey: true }],
      ["c", { metaKey: true }],
      ["x", { metaKey: true }],
      ["d", { metaKey: true }],
    ] as const) {
      assert.equal(matchShortcut(press(key, modifiers), true), null, key);
    }
    assert.equal(matchShortcut(press("s", { metaKey: true }), true), "save");
  });
});

describe("what counts as typing", () => {
  it("text inputs, textareas, selects and editable content", () => {
    for (const target of [
      { tagName: "INPUT" },
      { tagName: "input", type: "text" },
      { tagName: "INPUT", type: "search" },
      { tagName: "INPUT", type: "number" },
      { tagName: "INPUT", type: "email" },
      { tagName: "TEXTAREA" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
    ]) {
      assert.equal(isTypingTarget(target), true, JSON.stringify(target));
    }
  });

  it("not buttons, checkboxes, the canvas or nothing at all", () => {
    for (const target of [
      { tagName: "BUTTON" },
      { tagName: "INPUT", type: "checkbox" },
      { tagName: "INPUT", type: "radio" },
      { tagName: "INPUT", type: "range" },
      { tagName: "DIV" },
      { tagName: "BODY" },
      null,
      undefined,
    ]) {
      assert.equal(isTypingTarget(target), false, JSON.stringify(target));
    }
  });
});

describe("Phase 30's two keys", () => {
  it("D switches the selection off or on, and ⌘D still duplicates", () => {
    assert.equal(matchShortcut(press("d"), false), "toggleDisabled");
    assert.equal(matchShortcut(press("D", { shiftKey: true }), false), null, "Shift-D is not bound");
    assert.equal(matchShortcut(press("d", { metaKey: true }), false), "duplicate");
  });

  it("N adds a note, and neither fires while typing — a D or an N is a letter there", () => {
    assert.equal(matchShortcut(press("n"), false), "addNote");
    assert.equal(matchShortcut(press("n"), true), null);
    assert.equal(matchShortcut(press("d"), true), null);
  });
});
