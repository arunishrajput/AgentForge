import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalTitle, badgeCount, bellLabel, entryTitle, panelSummary } from "./words";

test("an entry names its workflow, and how many failures it stands for", () => {
  assert.equal(entryTitle({ workflowName: "Invoice sync", count: 1 }), "Invoice sync failed");
  assert.equal(entryTitle({ workflowName: "Invoice sync", count: 3 }), "Invoice sync failed 3 times");
});

test("the bell says its number in words — the badge is never the only place it is", () => {
  assert.equal(bellLabel(0), "Inbox, nothing unread");
  assert.equal(bellLabel(2), "Inbox, 2 unread");
});

test("the badge shows nothing at zero and stops counting at 99", () => {
  assert.equal(badgeCount(0), null);
  assert.equal(badgeCount(7), "7");
  assert.equal(badgeCount(140), "99+");
});

test("the bell names requests waiting on the reader, and unread failures, in words (Phase 38)", () => {
  assert.equal(bellLabel(0, 1), "Inbox, 1 approval waiting on you");
  assert.equal(bellLabel(2, 3), "Inbox, 3 approvals waiting on you, 2 unread");
  assert.equal(bellLabel(0, 0), "Inbox, nothing unread");
  assert.equal(approvalTitle({ workflowName: "Refunds" }), "Refunds asks for a decision");
});

test("the panel's summary never says 'all read' beside something waiting — found by the Phase 38 walk", () => {
  assert.equal(panelSummary(0, 1), "1 waiting on you");
  assert.equal(panelSummary(2, 1), "1 waiting on you · 2 unread");
  assert.equal(panelSummary(2, 0), "2 unread");
  assert.equal(panelSummary(0, 0), "all read");
});
