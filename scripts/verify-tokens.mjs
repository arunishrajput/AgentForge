/**
 * Personal access tokens, verified end to end against the deployed service — Phase 41.
 *
 *   APP_BASE_URL=https://… node --env-file=.env scripts/verify-tokens.mjs
 *
 * **What this proves that the unit suites cannot.** `token.test.ts` asserts the rules and
 * `token-routes.test.ts` pins which source files accept a token. Neither can show that the deployed
 * container hashes before storing, refuses a token on the routes it must never reach, re-checks the
 * creator's role on every request, answers one 401 for every kind of dead token, or limits a token's
 * rate. `BUILD_PLAN.md` → *Phase 41* → *Validation steps*:
 *
 *   • create a token, list workflows, start a run — all with `Authorization: Bearer`, no cookie
 *   • revoke it and get 401; an expired one is 401; a viewer token cannot write
 *   • a token for workspace A cannot see B (404, D20)
 *   • demote the creator and the token's writes are refused; remove them and the token is dead
 *   • a token can never reach token management, credentials, workspaces or the vault
 *   • only a hash is stored; `lastUsedAt` is written once per interval, not per request
 *   • a token is rate limited (429 + Retry-After)
 *
 * Product actions go through the product's own API with real `session` rows (no test-only bypass); a
 * probe user plays the second tenant and the demoted member and is deleted in `finally`. Every token
 * and workflow it makes is deleted.
 */
import { createHash } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { verificationUser } from "./verify-user.mjs";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");
const PREFIX = "PHASE 41 VERIFY — ";
const PROBE_ID = "zzzz-phase41-token-probe";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const COOKIE = new URL(BASE).protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token";

let passed = 0;
let failed = 0;
const check = (ok, good, bad) => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${good}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${bad ?? good}`);
  }
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function call(path, { method = "GET", body, cookie, bearer, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, headers: response.headers, json, text };
}

const node = (id, type, config = {}, x = 0) => ({ id, type, position: { x, y: 0 }, config });
const graph = () => ({
  version: 1,
  nodes: [node("t", "core.manual_trigger"), node("log", "core.log", { message: "a token started this run" }, 220)],
  edges: [{ id: "t-log", source: "t", target: "log", sourceHandle: null }],
});

const sessions = [];
const workflows = [];
async function sessionFor(userId) {
  const value = crypto.randomUUID() + crypto.randomUUID();
  await sql.query('insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)', [
    value,
    userId,
    new Date(Date.now() + 60 * 60 * 1000),
  ]);
  sessions.push(value);
  return `${COOKIE}=${value}`;
}

console.log(`\nPersonal access tokens — ${BASE}\n`);

const owner = await verificationUser(sql);
if (!owner) throw new Error("No user row — sign in through the browser once first.");
const [{ id: workspaceA }] = await sql.query(
  'select w."id" from "workspace" w where w."createdBy" = $1 and w."personal" order by w."createdAt" limit 1',
  [owner.id],
);
const ownerCookie = await sessionFor(owner.id);

async function mint(cookie, body) {
  return call("/api/tokens", { method: "POST", cookie, body });
}

async function cleanUp({ sessionsToo = false } = {}) {
  await sql.query('delete from "access_token" where "name" like $1', [`${PREFIX}%`]).catch(() => {});
  for (const id of workflows) await sql.query('delete from "workflow" where "id" = $1', [id]).catch(() => {});
  await sql.query('delete from "workflow" where "name" like $1', [`${PREFIX}%`]).catch(() => {});
  await sql.query('delete from "session" where "userId" = $1', [PROBE_ID]).catch(() => {});
  await sql.query('delete from "workspace" where "createdBy" = $1', [PROBE_ID]).catch(() => {});
  await sql.query('delete from "user" where "id" = $1', [PROBE_ID]).catch(() => {});
  if (sessionsToo) for (const value of sessions) await sql.query('delete from "session" where "sessionToken" = $1', [value]).catch(() => {});
}

try {
  await cleanUp();

  /* ---------------------------------------------------------------- *
   * Creating one
   * ---------------------------------------------------------------- */
  console.log("Creating a token");
  const editor = await mint(ownerCookie, { name: `${PREFIX}editor`, role: "editor", expiresInDays: 7 });
  const secret = editor.json?.data?.token;
  check(editor.status === 201 && /^afp_[A-Za-z0-9_-]{43}$/.test(secret ?? ""), "POST /api/tokens → 201 with a prefixed token", `got ${editor.status}`);
  check(editor.headers.get("cache-control")?.includes("no-store") === true, "…and the response is not cacheable");
  const listed = await call("/api/tokens", { cookie: ownerCookie });
  check(listed.status === 200 && listed.json.data.some((t) => t.id === editor.json.data.id), "the list shows it");
  check(!listed.text.includes(secret) && !JSON.stringify(listed.json).includes("tokenHash"), "…without the token, its hash, or anything that could rebuild it");
  const [row] = await sql.query('select "tokenHash", "hint", "role" from "access_token" where "id" = $1', [editor.json.data.id]);
  check(row?.tokenHash === sha256(secret), "the database holds sha256(token)");
  const plaintextRows = await sql.query('select count(*)::int as n from "access_token" where "tokenHash" = $1 or "hint" = $1', [secret]);
  check(plaintextRows[0].n === 0, "…and the plaintext appears nowhere in the row");

  for (const [label, body] of [
    ["no expiry", { name: `${PREFIX}x`, role: "editor" }],
    ["an expiry beyond a year", { name: `${PREFIX}x`, role: "editor", expiresInDays: 400 }],
    ["an owner-level ceiling", { name: `${PREFIX}x`, role: "owner", expiresInDays: 7 }],
    ["an admin-level ceiling", { name: `${PREFIX}x`, role: "admin", expiresInDays: 7 }],
    ["a blank name", { name: "   ", role: "viewer", expiresInDays: 7 }],
  ]) {
    const refused = await mint(ownerCookie, body);
    check(refused.status === 400, `${label} → 400`, `${label} → ${refused.status}`);
  }
  check((await call("/api/tokens", { method: "POST", body: { name: "x", role: "viewer", expiresInDays: 7 } })).status === 401, "creating a token needs a session");

  /* ---------------------------------------------------------------- *
   * Using one — no cookie at all
   * ---------------------------------------------------------------- */
  console.log("\nUsing a token, with no cookie");
  const list = await call("/api/workflows", { bearer: secret });
  check(list.status === 200 && Array.isArray(list.json?.data), "GET /api/workflows → 200", `got ${list.status}`);
  const made = await call("/api/workflows", { method: "POST", bearer: secret, body: { name: `${PREFIX}by token`, graph: graph() } });
  check(made.status === 201, "POST /api/workflows → 201", `got ${made.status}: ${made.text.slice(0, 200)}`);
  const wfId = made.json?.data?.id;
  if (wfId) workflows.push(wfId);
  const started = await call(`/api/workflows/${wfId}/runs`, { method: "POST", bearer: secret, body: {} });
  check(started.status === 201 && started.json?.data?.status === "succeeded", "POST /api/workflows/:id/runs starts a run that succeeds", `got ${started.status} ${started.json?.data?.status}`);
  const runId = started.json?.data?.id;
  const read = await call(`/api/runs/${runId}`, { bearer: secret });
  check(read.status === 200 && read.json?.data?.id === runId, "GET /api/runs/:id reads it back");
  check((await call(`/api/runs?limit=5`, { bearer: secret })).status === 200, "GET /api/runs lists runs");
  const [runRow] = await sql.query('select "ownerId", "workspaceId" from "run" where "id" = $1', [runId]);
  check(runRow?.ownerId === owner.id && runRow?.workspaceId === workspaceA, "the run belongs to the token's creator, in the token's workspace");
  check((await call(`/api/workflows/${wfId}`, { method: "PATCH", bearer: secret, body: { name: `${PREFIX}renamed` } })).status === 200, "PATCH /api/workflows/:id → 200");

  /* ---------------------------------------------------------------- *
   * Where a token never goes
   * ---------------------------------------------------------------- */
  console.log("\nWhere a token never goes");
  for (const [method, path, body] of [
    ["GET", "/api/tokens"],
    ["POST", "/api/tokens", { name: "x", role: "viewer", expiresInDays: 7 }],
    ["DELETE", `/api/tokens/${editor.json.data.id}`],
    ["GET", "/api/credentials"],
    ["POST", "/api/credentials/rekey"],
    ["GET", "/api/workspaces"],
    ["GET", `/api/workspaces/${workspaceA}/members`],
    ["POST", `/api/workspaces/${workspaceA}/invitations`, { email: "a@agentforge.invalid", role: "viewer" }],
    ["GET", "/api/settings/provider"],
    ["GET", "/api/integrations/slack"],
    ["POST", `/api/workflows/${wfId}/copilot`, {}],
    ["POST", `/api/workflows/${wfId}/share`],
    ["POST", `/api/workflows/${wfId}/webhook/rotate`],
    ["GET", "/api/inbox"],
  ]) {
    const response = await call(path, { method, bearer: secret, ...(body ? { body } : {}) });
    check(response.status === 401, `${method} ${path} with a token → 401`, `${method} ${path} with a token → ${response.status}`);
  }
  const stillAlive = await call(`/api/tokens`, { cookie: ownerCookie });
  check(stillAlive.json?.data?.some((t) => t.id === editor.json.data.id && t.state === "live"), "…and none of that revoked or changed the token");

  /* ---------------------------------------------------------------- *
   * One 401 for every kind of dead token
   * ---------------------------------------------------------------- */
  console.log("\nRefusals");
  const malformed = await call("/api/workflows", { bearer: "not-a-token" });
  const stranger = await call("/api/workflows", { bearer: `afp_${"A".repeat(43)}` });
  check(malformed.status === 401 && stranger.status === 401, "a malformed and an unknown token are both 401");
  check(stranger.json?.error?.code === "unauthenticated", "…with the ordinary unauthenticated code");
  const mixed = await call("/api/workflows", { bearer: "afp_nonsense", cookie: ownerCookie });
  check(mixed.status === 401, "a bad token is not rescued by a valid cookie beside it", `got ${mixed.status}`);
  const basic = await call("/api/workflows", { headers: { authorization: "Basic dXNlcjpwdw==" }, cookie: ownerCookie });
  check(basic.status === 200, "another scheme is none of the token layer's business (the cookie still works)");

  const viewer = await mint(ownerCookie, { name: `${PREFIX}viewer`, role: "viewer", expiresInDays: 7 });
  const viewerSecret = viewer.json.data.token;
  check((await call("/api/workflows", { bearer: viewerSecret })).status === 200, "a viewer token reads");
  const viewerWrite = await call("/api/workflows", { method: "POST", bearer: viewerSecret, body: { name: `${PREFIX}nope`, graph: graph() } });
  check(viewerWrite.status === 403, "…and cannot create a workflow (403)", `got ${viewerWrite.status}`);
  check((await call(`/api/workflows/${wfId}/runs`, { method: "POST", bearer: viewerSecret, body: {} })).status === 403, "…or start a run");
  check((await call(`/api/workflows/${wfId}`, { method: "DELETE", bearer: viewerSecret })).status === 403, "…or delete one");

  const expiring = await mint(ownerCookie, { name: `${PREFIX}expiring`, role: "viewer", expiresInDays: 7 });
  await sql.query(`update "access_token" set "expiresAt" = now() - interval '1 minute' where "id" = $1`, [expiring.json.data.id]);
  const expired = await call("/api/workflows", { bearer: expiring.json.data.token });
  check(expired.status === 401 && /expired/.test(expired.json?.error?.message ?? ""), "an expired token is 401 and says so", `got ${expired.status}`);

  const doomed = await mint(ownerCookie, { name: `${PREFIX}doomed`, role: "editor", expiresInDays: 7 });
  check((await call("/api/workflows", { bearer: doomed.json.data.token })).status === 200, "a token works before it is revoked");
  const revoked = await call(`/api/tokens/${doomed.json.data.id}`, { method: "DELETE", cookie: ownerCookie });
  check(revoked.status === 200 && revoked.json.data.state === "revoked", "DELETE /api/tokens/:id revokes it");
  const after = await call("/api/workflows", { bearer: doomed.json.data.token });
  check(after.status === 401 && /revoked/.test(after.json?.error?.message ?? ""), "…and the next request is 401", `got ${after.status}`);
  check((await call(`/api/tokens/${doomed.json.data.id}`, { method: "DELETE", cookie: ownerCookie })).status === 200, "revoking twice is harmless");
  check((await call(`/api/tokens/${crypto.randomUUID()}`, { method: "DELETE", cookie: ownerCookie })).status === 404, "revoking an unknown token → 404");

  /* ---------------------------------------------------------------- *
   * A second tenant, and a demoted member
   * ---------------------------------------------------------------- */
  console.log("\nTenancy and demotion");
  await sql.query('insert into "user" ("id", "name", "email") values ($1, $2, $3)', [PROBE_ID, "Token Probe", "token-probe@agentforge.invalid"]);
  const [probeWs] = await sql.query(
    'insert into "workspace" ("id", "name", "createdBy", "personal") values (gen_random_uuid()::text, $1, $2, true) returning "id"',
    ["Token probe workspace", PROBE_ID],
  );
  await sql.query('insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)', [probeWs.id, PROBE_ID, "owner"]);
  const probeCookie = await sessionFor(PROBE_ID);
  const probeOwn = await call("/api/workflows", { method: "POST", cookie: probeCookie, body: { name: `${PREFIX}in B`, graph: graph() } });
  const bId = probeOwn.json?.data?.id;
  if (bId) workflows.push(bId);
  check(probeOwn.status === 201, "the second tenant works and owns a workflow", `got ${probeOwn.status}`);
  check((await call(`/api/workflows/${bId}`, { bearer: secret })).status === 404, "a token for workspace A reading B's workflow → 404");
  check((await call(`/api/workflows/${bId}/runs`, { method: "POST", bearer: secret, body: {} })).status === 404, "…starting its run → 404");
  check(!(await call("/api/workflows", { bearer: secret })).text.includes(bId), "…and B's workflow is not in its list");

  await sql.query('insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)', [workspaceA, PROBE_ID, "editor"]);
  const inA = `${probeCookie}; af_workspace=${workspaceA}`;
  const probeToken = await mint(inA, { name: `${PREFIX}probe`, role: "editor", expiresInDays: 7 });
  check(probeToken.status === 201, "a member mints a token in the workspace they were invited to", `got ${probeToken.status}`);
  const probeSecret = probeToken.json?.data?.token;
  const first = await call("/api/workflows", { method: "POST", bearer: probeSecret, body: { name: `${PREFIX}by member`, graph: graph() } });
  if (first.json?.data?.id) workflows.push(first.json.data.id);
  check(first.status === 201, "an editor member's token writes", `got ${first.status}`);
  const above = await mint(`${probeCookie}; af_workspace=${workspaceA}`, { name: `${PREFIX}above`, role: "editor", expiresInDays: 7 });
  check(above.status === 201, "an editor may mint an editor token");
  await sql.query(`update "workspace_member" set "role" = 'viewer' where "workspaceId" = $1 and "userId" = $2`, [workspaceA, PROBE_ID]);
  const demotedWrite = await call("/api/workflows", { method: "POST", bearer: probeSecret, body: { name: `${PREFIX}after demotion`, graph: graph() } });
  check(demotedWrite.status === 403, "demote the creator and the token's writes are refused (403)", `got ${demotedWrite.status}`);
  check((await call("/api/workflows", { bearer: probeSecret })).status === 200, "…while its reads still work");
  const viewerMint = await mint(`${probeCookie}; af_workspace=${workspaceA}`, { name: `${PREFIX}too high`, role: "editor", expiresInDays: 7 });
  check(viewerMint.status === 403, "a viewer cannot mint an editor token (403)", `got ${viewerMint.status}`);
  await sql.query(`update "workspace_member" set "role" = 'editor' where "workspaceId" = $1 and "userId" = $2`, [workspaceA, PROBE_ID]);
  check((await call("/api/workflows", { method: "POST", bearer: probeSecret, body: { name: `${PREFIX}restored`, graph: graph() } })).status === 201, "promote them again and the same token writes again (the ceiling never moved)");
  await sql.query('delete from "workspace_member" where "workspaceId" = $1 and "userId" = $2', [workspaceA, PROBE_ID]);
  const removed = await call("/api/workflows", { bearer: probeSecret });
  check(removed.status === 401, "remove the creator and the token is dead (401)", `got ${removed.status}`);

  /* ---------------------------------------------------------------- *
   * lastUsedAt, once per interval
   * ---------------------------------------------------------------- */
  console.log("\nLast use");
  const usedToken = await mint(ownerCookie, { name: `${PREFIX}used`, role: "viewer", expiresInDays: 7 });
  const lastUsed = async () => (await sql.query('select "lastUsedAt" from "access_token" where "id" = $1', [usedToken.json.data.id]))[0].lastUsedAt;
  check((await lastUsed()) === null, "a new token has never been used");
  await call("/api/workflows", { bearer: usedToken.json.data.token });
  const firstUse = await lastUsed();
  check(firstUse !== null, "its first use is recorded");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (let i = 0; i < 5; i++) await call("/api/runs?limit=1", { bearer: usedToken.json.data.token });
  const later = await lastUsed();
  check(String(later) === String(firstUse), "six more requests within the interval wrote nothing", `${firstUse} → ${later}`);

  /* ---------------------------------------------------------------- *
   * The cap, and the rate limit
   * ---------------------------------------------------------------- */
  console.log("\nLimits");
  const limited = await mint(ownerCookie, { name: `${PREFIX}limited`, role: "viewer", expiresInDays: 1 });
  const limitedSecret = limited.json.data.token;
  let rejected = null;
  let retryAfter = null;
  let served = 0;
  for (let batch = 0; batch < 30 && !rejected; batch++) {
    const results = await Promise.all(Array.from({ length: 20 }, () => call("/api/runs?limit=1", { bearer: limitedSecret })));
    for (const r of results) {
      if (r.status === 200) served += 1;
      if (r.status === 429 && !rejected) {
        rejected = r;
        retryAfter = r.headers.get("retry-after");
      }
    }
  }
  check(rejected !== null, `a token is rate limited (${served} served first)`, `no 429 after ${served} requests`);
  check(rejected?.json?.error?.code === "rate_limited" && Number(retryAfter) >= 1, "…as rate_limited with a Retry-After", `retry-after ${retryAfter}`);
  check(served >= 100, "…and not before it is reasonable (100+ requests)", `${served} served`);
  const other = await call("/api/runs?limit=1", { bearer: viewerSecret });
  check(other.status === 200, "another token is not held up by it");

  const live = (await call("/api/tokens", { cookie: ownerCookie })).json.data.filter((t) => t.state === "live").length;
  let capped = null;
  for (let i = live; i <= 21 && !capped; i++) {
    const response = await mint(ownerCookie, { name: `${PREFIX}cap ${i}`, role: "viewer", expiresInDays: 1 });
    if (response.status === 409) capped = response;
  }
  check(capped !== null, "the twenty-first live token → 409", "no cap reached");
} finally {
  await cleanUp({ sessionsToo: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
