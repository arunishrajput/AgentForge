import assert from "node:assert/strict";
import { test } from "node:test";

import { NODE_STATUSES, RUN_STATUSES, nodeStatusLook, runStatusLook } from "./status";

/**
 * These assert the *distinctness* the phase asks for, not the specific glyphs.
 * A later phase is free to change a character; it is not free to make two statuses
 * look the same, or to let one of them be carried by hue alone.
 */

test("every status says what it is in words", () => {
  for (const status of NODE_STATUSES) {
    assert.notEqual(nodeStatusLook(status).label.trim(), "");
  }
});

test("no two statuses share a word", () => {
  const labels = NODE_STATUSES.map((status) => nodeStatusLook(status).label);
  assert.equal(new Set(labels).size, labels.length);
});

test("no two statuses share a shape", () => {
  // `running` carries its shape as the bobbing dots rather than a glyph, so it is
  // excluded from the glyph comparison and asserted separately below.
  const glyphs = NODE_STATUSES.map((status) => nodeStatusLook(status).glyph).filter(
    (glyph) => glyph !== "",
  );
  assert.equal(new Set(glyphs).size, glyphs.length);
  assert.equal(glyphs.length, NODE_STATUSES.length - 1);
});

test("running is the only status drawn as bobbing dots, and has no glyph", () => {
  const dotted = NODE_STATUSES.filter((status) => nodeStatusLook(status).dots);
  assert.deepEqual(dotted, ["running"]);
  assert.equal(nodeStatusLook("running").glyph, "");
});

test("an agent is thinking where every other node is running", () => {
  assert.equal(nodeStatusLook("running", true).label, "Thinking");
  assert.equal(nodeStatusLook("running", false).label, "Running");
});

test("the agent rename touches nothing but the word", () => {
  const { label: _plain, ...plain } = nodeStatusLook("running");
  const { label: _agent, ...agent } = nodeStatusLook("running", true);
  assert.deepEqual(agent, plain);
});

test("only a settled status animates, and only once", () => {
  // An infinite animation on a finished node is a canvas that never stops moving.
  const moving = NODE_STATUSES.filter((status) => nodeStatusLook(status).motion !== "");
  assert.deepEqual(moving.sort(), ["failed", "succeeded"]);
});

test("skipped and switched off are the recessed statuses, told apart by the outline's shape", () => {
  // Both are nodes the run does not execute, so both sit *in* the page. What separates
  // them has to survive a greyscale screenshot, so it is the outline's shape — dashed for
  // "the run went another way", dotted for "this is off" — and not a hue.
  const dashed = NODE_STATUSES.filter((status) =>
    nodeStatusLook(status).outline.includes("dashed"),
  );
  assert.deepEqual(dashed, ["skipped"]);

  const dotted = NODE_STATUSES.filter((status) =>
    nodeStatusLook(status).outline.includes("dotted"),
  );
  assert.deepEqual(dotted, ["disabled"]);

  const recessed = NODE_STATUSES.filter(
    (status) => nodeStatusLook(status).surface !== "bg-elevated",
  );
  assert.deepEqual(recessed, ["skipped", "disabled"]);

  const flattened = NODE_STATUSES.filter(
    (status) => nodeStatusLook(status).shadow !== "shadow-node",
  );
  assert.deepEqual(flattened, ["skipped", "disabled"]);
});

test("a switched-off node is not called skipped, and says so in the product's own words", () => {
  // Phase 30. "Skipped" is the run never getting here; a disabled node is one it reached.
  assert.equal(nodeStatusLook("disabled").label, "Switched off");
  assert.notEqual(nodeStatusLook("disabled").glyph, nodeStatusLook("skipped").glyph);
});

test("no status expresses itself with opacity or a transform", () => {
  // `animate-rise` uses `fill-mode: both`, so its final `opacity: 1` outranks any
  // `opacity-*` utility on the element carrying it — a class that is present in the
  // DOM and does nothing. Surface and shadow are untouched by any animation here, and
  // a transform is excluded for the same reason rather than a proven one.
  for (const status of NODE_STATUSES) {
    const look = nodeStatusLook(status);
    const classes = [look.outline, look.surface, look.shadow].join(" ");
    assert.ok(!/\bopacity-/.test(classes), `${status} leans on opacity`);
    assert.ok(!/\btranslate-/.test(classes), `${status} leans on a transform`);
  }
});

test("failure is the only status that recolours the card's outline", () => {
  const recoloured = NODE_STATUSES.filter(
    (status) => !nodeStatusLook(status).outline.startsWith("border-line"),
  );
  assert.deepEqual(recoloured, ["failed"]);
});

test("every run status says what it is, in a word of its own", () => {
  const labels = RUN_STATUSES.map((status) => runStatusLook(status).label);
  assert.equal(new Set(labels).size, labels.length);
  for (const label of labels) assert.notEqual(label.trim(), "");
});

test("a cancelled run is not called skipped", () => {
  // Mapping the run vocabulary onto the step one would have produced exactly that,
  // and it is a different statement about what happened.
  assert.equal(runStatusLook("cancelled").label, "Cancelled");
  assert.equal(nodeStatusLook("skipped").label, "Skipped");
});

test("run statuses have distinct shapes, and only running bobs", () => {
  const glyphs = RUN_STATUSES.map((status) => runStatusLook(status).glyph).filter(
    (glyph) => glyph !== "",
  );
  assert.equal(new Set(glyphs).size, glyphs.length);
  assert.deepEqual(
    RUN_STATUSES.filter((status) => runStatusLook(status).dots),
    ["running"],
  );
});

test("the two vocabularies agree where they overlap", () => {
  // A step and a run that both succeeded must not read as two different outcomes.
  for (const shared of ["running", "succeeded", "failed"] as const) {
    assert.equal(runStatusLook(shared).label, nodeStatusLook(shared).label);
    assert.equal(runStatusLook(shared).glyph, nodeStatusLook(shared).glyph);
  }
});

/* --- waiting — Phase 26 ---------------------------------------------------- */

test("a waiting run has its own word and shape, and does not bob — nothing is working", () => {
  const look = runStatusLook("waiting");
  assert.equal(look.label, "Waiting");
  assert.notEqual(look.glyph, "");
  assert.equal(look.dots, false);
});

test("a step paused inside a waiting run reads as waiting, not as running", () => {
  // The step is genuinely still `running` — the delay is not over until the run wakes —
  // but "Running" over a card that will not change for two days reads as a hang.
  const paused = nodeStatusLook("running", false, true);
  assert.equal(paused.label, "Waiting");
  assert.equal(paused.dots, false);
  assert.equal(paused.glyph, runStatusLook("waiting").glyph, "one clock for both");
  // The flag means nothing on a step that is not running.
  assert.equal(nodeStatusLook("succeeded", false, true).label, "Succeeded");
});
