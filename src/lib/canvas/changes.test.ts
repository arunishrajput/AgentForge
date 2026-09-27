import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changeLook, fieldWords, NODE_CHANGES } from "./changes";

/**
 * `DESIGN.md` → *Never colour alone*, asserted rather than trusted — the same reason
 * `status.test.ts` exists. Five class strings written by hand drift together quietly,
 * and the failure mode is a diff that only a reader who can see green and red can
 * actually read.
 */
describe("the diff look table", () => {
  it("covers every change the diff can produce", () => {
    assert.deepEqual(NODE_CHANGES.toSorted(), [
      "added",
      "changed",
      "moved",
      "removed",
      "unchanged",
    ]);
  });

  it("gives every reported change a word", () => {
    for (const change of NODE_CHANGES) {
      const look = changeLook(change);
      assert.ok(look.label.length > 0, `${change} must state itself in words`);
    }
  });

  it("gives every ribboned change a glyph distinct from the others", () => {
    const ribboned = NODE_CHANGES.filter((change) => changeLook(change).ribbon);
    const glyphs = ribboned.map((change) => changeLook(change).glyph);

    for (const glyph of glyphs) assert.ok(glyph.length > 0);
    assert.equal(new Set(glyphs).size, glyphs.length, "glyphs must be distinct in shape");
  });

  it("gives every ribboned change a distinct word", () => {
    const words = NODE_CHANGES.filter((change) => changeLook(change).ribbon).map(
      (change) => changeLook(change).label,
    );
    assert.equal(new Set(words).size, words.length);
  });

  it("does not rely on hue alone to separate added from removed", () => {
    const added = changeLook("added");
    const removed = changeLook("removed");

    assert.notEqual(added.glyph, removed.glyph);
    assert.notEqual(added.label, removed.label);
    // The channel that survives a greyscale screenshot: one is dashed and recessed.
    assert.notEqual(added.outline, removed.outline);
    assert.notEqual(added.surface, removed.surface);
  });

  it("leaves an unchanged node undecorated — decoration everywhere is no signal", () => {
    const look = changeLook("unchanged");
    assert.equal(look.ribbon, false);
    assert.equal(look.outline, "border-line");
  });

  it("draws removed as the one dashed, recessed card", () => {
    const dashed = NODE_CHANGES.filter((change) => changeLook(change).outline.includes("dashed"));
    assert.deepEqual(dashed, ["removed"]);

    const sunken = NODE_CHANGES.filter((change) => changeLook(change).surface === "bg-sunken");
    assert.deepEqual(sunken, ["removed"]);
  });
});

describe("fieldWords", () => {
  it("turns a field list into something a person reads", () => {
    assert.equal(fieldWords(["config"]), "configuration");
    assert.equal(fieldWords(["label", "config"]), "name and configuration");
    assert.equal(
      fieldWords(["type", "label", "config"]),
      "node type, name and configuration",
    );
  });

  it("passes an unmapped field through rather than dropping it", () => {
    assert.equal(fieldWords(["whatever"]), "whatever");
  });

  it("is empty for no fields, which is what a non-`changed` node has", () => {
    assert.equal(fieldWords([]), "");
  });
});
