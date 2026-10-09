import assert from "node:assert/strict";
import { test } from "node:test";

import { NODE_STATUSES, RUN_STATUSES, edgeRunLook, nodeStatusLook, runStatusLook, stepErrorTone } from "./status";

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

test("only a failure recolours the card's outline — red where it stopped the run, the warning hue where it was handled", () => {
  const recoloured = NODE_STATUSES.filter(
    (status) => !nodeStatusLook(status).outline.startsWith("border-line"),
  );
  assert.deepEqual(recoloured, ["failed", "handled"]);
  assert.notEqual(nodeStatusLook("failed").outline, nodeStatusLook("handled").outline);
});

test("a handled failure is not a failure: its own word and shape, and it keeps still", () => {
  // Phase 37 (D175). The wiggle means "this stopped the run", and a handled error did not; a
  // greyscale screenshot tells the two apart by the word and the glyph, not by the hue.
  const handled = nodeStatusLook("handled");
  const failed = nodeStatusLook("failed");
  assert.equal(handled.label, "Handled");
  assert.notEqual(handled.glyph, failed.glyph);
  assert.equal(handled.motion, "");
  assert.equal(handled.surface, "bg-elevated", "raised: it handed a value on — its error");
});

test("the lit path runs on out of a handled step, along whichever output it left by", () => {
  // The target says whether the run went that way: the Error path's first step ran, the default
  // path's was skipped.
  assert.equal(edgeRunLook("handled", "succeeded", false), "traversed");
  assert.equal(edgeRunLook("handled", "running", true), "live");
  assert.equal(edgeRunLook("handled", "skipped", false), null);
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

test("the lit path runs through every node that handed a value on — a pinned one included", () => {
  // Phase 31's browser walk: the edge out of a pinned node stayed dark, because the rule named
  // only succeeded and switched-off sources. A pinned node hands its pin on exactly as a
  // succeeded one hands its output.
  for (const source of ["succeeded", "disabled", "pinned"] as const) {
    assert.equal(edgeRunLook(source, "succeeded", false), "traversed", source);
    assert.equal(edgeRunLook(source, "pinned", false), "traversed", source);
  }
  assert.equal(edgeRunLook("succeeded", "running", true), "live");
  assert.equal(edgeRunLook("pinned", "running", true), "live");
});

test("a retry's lit path starts at the trigger, through every step it carried over", () => {
  // Phase 33. A retried run paints its reused steps on the canvas; the edges between them and out
  // of the last one into the step the retry started at must be lit, or the path the run took
  // would read as beginning in the middle of the graph.
  assert.equal(edgeRunLook("reused", "reused", false), "traversed");
  assert.equal(edgeRunLook("reused", "succeeded", false), "traversed");
  assert.equal(edgeRunLook("reused", "running", true), "live");
  assert.equal(edgeRunLook("reused", "skipped", false), null);
});

test("a reused step is raised and still: it handed a value on, and nothing happened to it here", () => {
  const look = nodeStatusLook("reused");
  assert.equal(look.label, "Reused");
  assert.equal(look.surface, "bg-elevated");
  assert.equal(look.motion, "");
  assert.equal(look.dots, false);
  assert.notEqual(look.glyph, nodeStatusLook("succeeded").glyph);
});

test("an edge stays plain where the run did not cross it", () => {
  assert.equal(edgeRunLook("succeeded", "skipped", false), null, "the untaken side of a branch");
  assert.equal(edgeRunLook("succeeded", undefined, false), null, "a target the run never reached");
  assert.equal(edgeRunLook("failed", "skipped", false), null);
  assert.equal(edgeRunLook("skipped", "skipped", false), null);
  assert.equal(edgeRunLook(undefined, undefined, false), null);
});

test("a handled step's error is in the warning hue, a failure's in red", () => {
  // Phase 37's browser walk: red words under an amber outline said two things at once.
  assert.equal(stepErrorTone("handled"), "text-warn");
  assert.equal(stepErrorTone("failed"), "text-bad");
  assert.equal(stepErrorTone(undefined), "text-bad");
});
