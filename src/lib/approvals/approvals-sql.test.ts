import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { approvalForLinkSql, approvalForMemberSql, decideSql, pendingForReaderSql, timeoutSql } from "./approvals-sql";

const dialect = new PgDialect();
const render = (fragment: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(fragment);
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * **What the approval statements say — Phase 38.** The rules live in their `where`s, so each one is
 * rendered and read here: a later edit cannot quietly let a decision land on a finished run, a link
 * decide by anything but its hash, or a request reach an inbox that may not decide it.
 */

test("a decision lands only on a pending request, before its timeout, while its run is still going", () => {
  const { sql: text, params } = render(
    decideSql({ key: { tokenHash: "h".repeat(64) }, status: "approved", via: "link", decidedBy: null, comment: "ok" }),
  );
  const flat = squash(text);
  assert.match(flat, /where a\."tokenHash" = \$\d+ and a\."status" = 'pending' and a\."expiresAt" > now\(\)/);
  assert.match(flat, /exists \(select 1 from "run" r where r\."id" = a\."runId" and r\."status" in \('queued', 'running', 'waiting'\)\)/);
  assert.match(flat, /"decidedAt" = now\(\)/);
  assert.ok(params.includes("h".repeat(64)) && params.includes("ok") && params.includes("link"));
  // A member decides by the request's id, never by a hash it does not hold.
  assert.match(squash(render(decideSql({ key: { id: "ap-1" }, status: "rejected", via: "member", decidedBy: "u1", comment: null })).sql), /where a\."id" = \$\d+/);
});

test("the timeout decides only once its time has passed, by the request's own onTimeout", () => {
  const flat = squash(render(timeoutSql("ap-1")).sql);
  assert.match(flat, /where a\."id" = \$\d+ and a\."status" = 'pending' and a\."expiresAt" <= now\(\)/);
  assert.match(flat, /case a\."onTimeout" when 'approve' then 'approved' when 'fail' then 'expired' else 'rejected' end/);
  assert.match(flat, /"via" = 'timeout'/);
});

test("a reader's inbox holds only the requests they may decide, on workflows they can see", () => {
  const member = squash(render(pendingForReaderSql({ userId: "u1", workspaceId: "ws", admin: false, editor: true, limit: 12 })).sql);
  assert.match(member, /a\."status" = 'pending' and a\."expiresAt" > now\(\) and r\."status" in \('queued', 'running', 'waiting'\)/);
  assert.match(member, /\(w\."visibility" <> 'private' or w\."ownerId" = \$\d+\)/);
  assert.match(member, /\(a\."approvers" is null or a\."approvers" @> jsonb_build_array\(lower\(u\."email"\)\)\)/);
  assert.match(member, /\(count\(\*\) over \(\)\)::int as "pending"/);

  // A viewer is never "any editor" — only a request naming them reaches their inbox.
  const viewer = squash(render(pendingForReaderSql({ userId: "u1", workspaceId: "ws", admin: false, editor: false, limit: 12 })).sql);
  assert.match(viewer, /\(false or a\."approvers" @> jsonb_build_array\(lower\(u\."email"\)\)\)/);
  // An admin sees every workflow, so the visibility filter is not there to fail.
  const admin = squash(render(pendingForReaderSql({ userId: "u1", workspaceId: "ws", admin: true, editor: true, limit: 12 })).sql);
  assert.doesNotMatch(admin, /visibility/);
});

test("a member reads a request only in their workspace and only if they can see its workflow", () => {
  const flat = squash(render(approvalForMemberSql({ approvalId: "ap", userId: "u1", workspaceId: "ws", admin: false })).sql);
  assert.match(flat, /where a\."id" = \$\d+ and a\."workspaceId" = \$\d+ and \(w\."visibility" <> 'private' or w\."ownerId" = \$\d+\)/);
  assert.match(flat, /\(a\."status" = 'pending' and a\."expiresAt" > now\(\) and r\."status" in \('queued', 'running', 'waiting'\)\) as "open"/);
});

test("a link finds its request by the token's hash and by nothing else", () => {
  const { sql: text, params } = render(approvalForLinkSql("f".repeat(64)));
  assert.match(squash(text), /where a\."tokenHash" = \$\d+ limit 1$/);
  assert.deepEqual(params.filter((value) => value === "f".repeat(64)).length, 1);
});
