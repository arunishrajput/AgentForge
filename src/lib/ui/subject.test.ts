import assert from "node:assert/strict";
import { test } from "node:test";

import { opened } from "./subject";

const card = { id: "wf-1" };

test("handing a dialog a subject opens it", () => {
  assert.equal(opened(null, card), true);
});

test("reopening on the same workflow is an opening too — the bug was keying this on the id", () => {
  // Opened, closed (null), opened again with the very same card: the export dialog kept its
  // "include pinned outputs" tick across exactly this sequence.
  assert.equal(opened(card, null), false);
  assert.equal(opened(null, card), true);
});

test("a dialog that stays open on its subject is not reopened, and a different subject is", () => {
  assert.equal(opened(card, card), false);
  assert.equal(opened(card, { id: "wf-1" }), true);
  assert.equal(opened(card, { id: "wf-2" }), true);
});
