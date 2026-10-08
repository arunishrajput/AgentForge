import assert from "node:assert/strict";
import { test } from "node:test";

import { replaceAddress } from "./url";

function fake(href: { pathname: string; search: string; hash: string }) {
  const calls: unknown[][] = [];
  return {
    calls,
    env: {
      location: href,
      history: { replaceState: (...args: unknown[]) => void calls.push(args) },
    },
  };
}

test("the address is replaced with a null state, so Next's router follows it", () => {
  // The bug: passing `history.state` — the router's own object, carrying its `__NA` marker —
  // made the router's patch ignore the call, and the next refresh put the old address back.
  const { calls, env } = fake({ pathname: "/workflows", search: "?tag=billing", hash: "" });
  assert.equal(replaceAddress("/workflows?tag=invoices", env), true);
  assert.deepEqual(calls, [[null, "", "/workflows?tag=invoices"]]);
});

test("an address that is already right is left alone — no write, no router action", () => {
  const { calls, env } = fake({ pathname: "/workflows", search: "?q=x", hash: "#generate-prompt" });
  assert.equal(replaceAddress("/workflows?q=x#generate-prompt", env), false);
  assert.deepEqual(calls, []);
});
