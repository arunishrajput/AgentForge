import assert from "node:assert/strict";
import { test } from "node:test";

import { NOTE_TONES } from "@/lib/workflow/graph";

import { DEFAULT_NOTE_TONE, noteLook, noteName, NOTE_TONE_ORDER } from "./notes";

test("every tone the graph allows has a look, and the picker offers every one", () => {
  assert.deepEqual([...NOTE_TONE_ORDER], [...NOTE_TONES]);
  for (const tone of NOTE_TONES) assert.ok(noteLook(tone), tone);
  assert.ok(NOTE_TONES.includes(DEFAULT_NOTE_TONE));
});

test("every tone is a pop fill — a background the gates already prove under its label", () => {
  // `DESIGN.md`: a `-pop` token is only ever a background, under `accent-ink`, inside the
  // outline. A note drawn in anything else would be a pair no gate has measured.
  for (const tone of NOTE_TONES) {
    assert.match(noteLook(tone).fill, /^bg-[a-z-]+-pop$/, tone);
  }
});

test("no two tones share a fill or a name", () => {
  const fills = NOTE_TONES.map((tone) => noteLook(tone).fill);
  const labels = NOTE_TONES.map((tone) => noteLook(tone).label);
  assert.equal(new Set(fills).size, fills.length);
  assert.equal(new Set(labels).size, labels.length);
});

test("a note's name is one line, cut short, and never empty", () => {
  assert.equal(noteName(""), "Empty note");
  assert.equal(noteName("   \n "), "Empty note");
  assert.equal(noteName("Ask Priya\nbefore changing"), "Ask Priya before changing");
  const long = noteName("x".repeat(200), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});
