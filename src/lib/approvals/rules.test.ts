import assert from "node:assert/strict";
import { test } from "node:test";

import {
  askingOf,
  approversWords,
  decidedOutput,
  decisionWords,
  mayDecide,
  parseApprovers,
  timeoutMs,
  timeoutStatus,
} from "./rules";
import { approvalUrl, APPROVAL_TOKEN_PATTERN, hashApprovalToken, mintApprovalToken } from "./token";

/** **Who may decide, what a decision hands on, what a timeout means — Phase 38**, without a database. */

test("approvers: empty is any editor; a list is lower-cased, de-duplicated, and every entry an address", () => {
  assert.deepEqual(parseApprovers(undefined), { approvers: null });
  assert.deepEqual(parseApprovers("   "), { approvers: null });
  assert.deepEqual(parseApprovers("Ada@Example.com, grace@example.com;ada@example.com  bo@x.io"), {
    approvers: ["ada@example.com", "grace@example.com", "bo@x.io"],
  });
  const bad = parseApprovers("ada@example.com, Grace");
  assert.ok("error" in bad && /"grace" is not an email address/.test(bad.error));
  const many = parseApprovers(Array.from({ length: 21 }, (_, i) => `p${i}@x.io`).join(","));
  assert.ok("error" in many && /At most 20/.test(many.error));
});

test("with nobody named any editor decides; named means exactly those people — a named viewer included", () => {
  assert.equal(mayDecide({ role: "editor", email: "e@x.io" }, null), true);
  assert.equal(mayDecide({ role: "owner", email: "o@x.io" }, null), true);
  assert.equal(mayDecide({ role: "viewer", email: "v@x.io" }, null), false);

  const named = ["ada@example.com"];
  assert.equal(mayDecide({ role: "viewer", email: "Ada@Example.com " }, named), true, "chosen by name, whatever the role");
  assert.equal(mayDecide({ role: "owner", email: "o@x.io" }, named), false, "an owner not named does not decide in their place");
  assert.equal(mayDecide({ role: "editor", email: null }, named), false);
});

test("the timeout: a day by default, in minutes, hours or days, and what it does", () => {
  assert.equal(timeoutMs({}), 86_400_000);
  assert.equal(timeoutMs({ timeout: 90, timeoutUnit: "minutes" }), 5_400_000);
  assert.equal(timeoutStatus("reject"), "rejected");
  assert.equal(timeoutStatus("approve"), "approved");
  assert.equal(timeoutStatus("fail"), "expired");
});

test("a decided step hands on the decision, who made it and their comment — and an expired one nothing", () => {
  const asked = { approvalId: "ap", message: "Refund?" };
  const decidedAt = "2026-10-09T10:00:00.000Z";
  assert.deepEqual(
    decidedOutput(asked, { outcome: "rejected", via: "link", decidedBy: null, comment: "Too much", decidedAt }),
    { approvalId: "ap", decision: "rejected", via: "link", decidedBy: null, comment: "Too much", decidedAt, message: "Refund?" },
  );
  assert.throws(() => decidedOutput(asked, { outcome: "expired", via: "timeout", decidedBy: null, comment: null, decidedAt }));
});

test("the words a person reads about a request", () => {
  assert.equal(approversWords(null), "any editor");
  assert.equal(approversWords(["a@x.io"]), "a@x.io");
  assert.equal(approversWords(["a@x.io", "b@x.io", "c@x.io"]), "a@x.io and 2 others");
  assert.equal(decisionWords({ status: "approved", via: "member", decidedBy: { name: "Ada", email: "a@x.io" } }), "Approved by Ada");
  assert.equal(decisionWords({ status: "approved", via: "member", decidedBy: { name: null, email: "a@x.io" } }), "Approved by a@x.io");
  assert.equal(decisionWords({ status: "rejected", via: "link" }), "Rejected through the link");
  assert.equal(decisionWords({ status: "approved", via: "timeout" }), "Approved when nobody decided in time");
  assert.equal(decisionWords({ status: "expired", via: "timeout" }), "Expired — nobody decided in time");
  assert.equal(decisionWords({ status: "void", via: null }), "Closed — the run stopped before anybody decided");
  assert.equal(decisionWords({ status: "pending", via: null }), "Waiting for a decision");
});

test("the link's token: 256 bits, URL-safe, hashed, and carried in the fragment — never a path or a query", () => {
  const token = mintApprovalToken();
  assert.match(token, APPROVAL_TOKEN_PATTERN);
  assert.notEqual(mintApprovalToken(), token);
  assert.match(hashApprovalToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashApprovalToken(token), token);
  const url = approvalUrl("https://agentforge.test/", token);
  assert.equal(url, `https://agentforge.test/approve#${token}`);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/approve");
  assert.equal(parsed.search, "", "a query string is sent to the server and logged");
  assert.equal(parsed.hash, `#${token}`, "a fragment is never sent");
});

test("a step is asking while it is an approval, running, with the request's id on its output", () => {
  const output = { approvalId: "ap", message: "ok?", url: "https://x/approve#[removed]", expiresAt: "2026-10-10T00:00:00.000Z" };
  assert.deepEqual(askingOf({ nodeType: "core.approval", status: "running", output }), {
    approvalId: "ap",
    message: "ok?",
    expiresAt: "2026-10-10T00:00:00.000Z",
  });
  assert.equal(askingOf({ nodeType: "core.approval", status: "succeeded", output }), null, "decided");
  assert.equal(askingOf({ nodeType: "core.delay", status: "running", output }), null);
  assert.equal(askingOf({ nodeType: "core.approval", status: "running", output: null }), null, "failed before asking");
});
