import assert from "node:assert/strict";
import { test } from "node:test";

import { firstFocusable, lastFocusable, stepFocus } from "./menu-focus";

/** The account menu's shape: a disabled address, then real items. */
const account = [
  { disabled: true }, // the signed-in address
  {}, // Settings
  {}, // Design system
  {}, // Light
  {}, // Dark
  {}, // System
  {}, // Sign out
];

test("opening focuses the first item that can take focus, not item 0", () => {
  // The defect: item 0 was focused unconditionally, and a disabled button refuses focus,
  // so the account menu opened with focus stranded on its trigger.
  assert.equal(firstFocusable(account), 1);
  assert.equal(firstFocusable([{}, {}]), 0);
});

test("End reaches the last item even when the first is disabled", () => {
  // It used to count back from item 0; with 0 disabled that landed on the next-to-last.
  assert.equal(lastFocusable(account), 6);
  assert.equal(lastFocusable([{}, {}, { disabled: true }]), 1);
});

test("the arrows step over disabled items and wrap at both ends", () => {
  assert.equal(stepFocus(account, 1, 1), 2);
  assert.equal(stepFocus(account, 6, 1), 1, "Down from the last wraps past the disabled address");
  assert.equal(stepFocus(account, 1, -1), 6, "Up from the first wraps to the last");
  const gappy = [{}, { disabled: true }, {}];
  assert.equal(stepFocus(gappy, 0, 1), 2);
  assert.equal(stepFocus(gappy, 2, -1), 0);
});

test("from an item that cannot take focus, Down goes to the first and Up to the last", () => {
  assert.equal(stepFocus(account, 0, 1), 1);
  assert.equal(stepFocus(account, 0, -1), 6);
});

test("a menu with nothing focusable reports that rather than an index", () => {
  const none = [{ disabled: true }, { disabled: true }];
  assert.equal(firstFocusable(none), null);
  assert.equal(lastFocusable(none), null);
  assert.equal(stepFocus(none, 0, 1), null);
  assert.equal(firstFocusable([]), null);
});
