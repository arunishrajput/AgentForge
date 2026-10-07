import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ariaKeyShortcut, chordLabel, chordSpoken, chordTokens, keyLabel, platformOf } from "./keys";

describe("the platform", () => {
  it("recognises every Apple platform string a browser reports", () => {
    for (const hint of ["MacIntel", "macOS", "iPhone", "iPad", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"]) {
      assert.equal(platformOf(hint), "apple", hint);
    }
  });

  it("treats everything else as Ctrl-first", () => {
    for (const hint of ["Win32", "Windows", "Linux x86_64", "Android", "CrOS", ""]) {
      assert.equal(platformOf(hint), "other", hint);
    }
  });
});

describe("printing a chord", () => {
  it("runs Mac glyphs together in Apple's order, ⇧ before ⌘", () => {
    assert.equal(chordLabel({ key: "z", mod: true }, "apple"), "⌘Z");
    assert.equal(chordLabel({ key: "z", mod: true, shift: true }, "apple"), "⇧⌘Z");
    assert.deepEqual(chordTokens({ key: "z", mod: true, shift: true }, "apple"), ["⇧", "⌘", "Z"]);
  });

  it("joins words with + elsewhere, Ctrl before Shift", () => {
    assert.equal(chordLabel({ key: "z", mod: true }, "other"), "Ctrl+Z");
    assert.equal(chordLabel({ key: "z", mod: true, shift: true }, "other"), "Ctrl+Shift+Z");
    assert.deepEqual(chordTokens({ key: "z", mod: true, shift: true }, "other"), ["Ctrl", "Shift", "Z"]);
  });

  it("never prints ⌘ to a reader who has no ⌘ key", () => {
    for (const key of ["a", "c", "d", "k", "s", "v", "x", "y", "z"]) {
      assert.doesNotMatch(chordLabel({ key, mod: true }, "other"), /⌘/);
      assert.doesNotMatch(chordLabel({ key, mod: true }, "apple"), /Ctrl/);
    }
  });

  it("keeps a space between a modifier glyph and a pointer word", () => {
    assert.equal(chordLabel({ key: "Click", shift: true }, "apple"), "⇧ Click");
    assert.equal(chordLabel({ key: "Click", shift: true }, "other"), "Shift+Click");
  });

  it("prints a bare key without modifiers, and a layout-dependent Shift as nothing", () => {
    assert.equal(chordLabel({ key: "f" }, "apple"), "F");
    assert.equal(chordLabel({ key: "?", shift: "any" }, "apple"), "?");
    assert.equal(chordLabel({ key: "/", shift: "any" }, "other"), "/");
  });

  it("says a chord in words for a screen reader, never in glyphs", () => {
    assert.equal(chordSpoken({ key: "z", mod: true, shift: true }, "apple"), "Command Shift Z");
    assert.equal(chordSpoken({ key: "z", mod: true, shift: true }, "other"), "Control Shift Z");
    assert.equal(chordSpoken({ key: "?", shift: "any" }, "apple"), "question mark");
    assert.equal(chordSpoken({ key: "Arrows" }, "other"), "arrow keys");
    assert.equal(chordSpoken({ key: "Click", shift: true }, "apple"), "Shift Click");
  });

  it("writes aria-keyshortcuts in the form the attribute defines", () => {
    assert.equal(ariaKeyShortcut({ key: "z", mod: true, shift: true }, "apple"), "Meta+Shift+Z");
    assert.equal(ariaKeyShortcut({ key: "d", mod: true }, "other"), "Control+D");
    assert.equal(ariaKeyShortcut({ key: "?", shift: "any" }, "apple"), "?");
    assert.equal(ariaKeyShortcut({ key: "f" }, "other"), "F");
  });

  it("names the keys that have names", () => {
    assert.equal(keyLabel("Backspace", "apple"), "⌫");
    assert.equal(keyLabel("Backspace", "other"), "Backspace");
    assert.equal(keyLabel("Escape", "other"), "Esc");
    assert.equal(keyLabel("Arrows", "apple"), "← ↑ ↓ →");
  });
});
