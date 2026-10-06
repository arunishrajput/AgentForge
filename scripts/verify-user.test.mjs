import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseVerificationUser } from "./verify-user.mjs";

// The shape Phase 26 found: the owner signed in first, and a second account — whose random id
// happens to sort first — a few days later. Synthetic ids, same ordering as the real pair.
const owner = {
  id: "9f000000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  workspaceCreatedAt: new Date("2026-09-27T03:52:12Z"),
};
const later = {
  id: "2a000000-0000-4000-8000-000000000002",
  email: "tester@example.com",
  workspaceCreatedAt: new Date("2026-10-01T18:50:26Z"),
};

test("acts as whoever signed in first, not whichever id sorts first", () => {
  assert.equal(chooseVerificationUser([later, owner]).id, owner.id);
  assert.equal(chooseVerificationUser([owner, later]).id, owner.id);
});

test("VERIFY_USER_EMAIL picks another account deliberately, case-insensitively", () => {
  assert.equal(chooseVerificationUser([owner, later], " Tester@Example.com ").id, later.id);
});

test("an email that names nobody is an error, not a silent fallback to the owner", () => {
  assert.throws(() => chooseVerificationUser([owner, later], "nobody@example.com"), /names no user/);
});

test("nobody signed in yet is null, so each script keeps its own message", () => {
  assert.equal(chooseVerificationUser([]), null);
});

test("timestamps from the driver as strings order the same way", () => {
  const asStrings = [later, owner].map((u) => ({ ...u, workspaceCreatedAt: u.workspaceCreatedAt.toISOString() }));
  assert.equal(chooseVerificationUser(asStrings).id, owner.id);
});
