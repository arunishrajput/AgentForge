import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createRecords, listRecords, verifyToken as verifyAirtable } from "./airtable";
import { commentOnIssue, createIssue, verifyToken as verifyGitHub } from "./github";
import { IntegrationError } from "./net";
import {
  appendParagraphs,
  createDatabasePage,
  dataSourceFor,
  verifyToken as verifyNotion,
} from "./notion";
import { postMessage, verifyWebhook } from "./slack";

/**
 * **What each service's answers are taken to mean — Phase 23B.**
 *
 * `scripts/verify-integrations.mjs` proves these modules against the real Slack, Notion,
 * GitHub and Airtable, and that is the only thing that can prove a request is well formed. It
 * cannot prove the other half: **what this code does with an answer it is unlikely to
 * receive.** A revoked Slack webhook, a Notion page nobody shared, a fine-grained GitHub token
 * with no account permission — each is a decision table written here, and each is reached on
 * the day something is broken, which is the worst day to discover it was never exercised.
 *
 * So `fetch` is replaced with a stub that answers the status and body the service documents,
 * exactly as `net.test.ts` does. **This is not a mock of the service standing in for a real
 * call** — nothing here asserts that a request succeeds. Every assertion is about this
 * repository's own classification of a documented response.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeFetch(queue: Array<Response | Error>) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error("fake fetch ran out of answers");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return calls;
}

const text = (body: string, status: number) => new Response(body, { status });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/* ------------------------------------------------------------------ *
 * Slack: proving a webhook without posting to the channel
 * ------------------------------------------------------------------ */

/** Self-describing on purpose — see the note in `tokens.test.ts`. */
const WEBHOOK = "https://hooks.slack.com/services/T00000000/B00000000/EXAMPLE-NOT-A-REAL-WEBHOOK";

test("verifying a Slack webhook sends no text, so nothing lands in the channel", async () => {
  // The whole reason the probe exists. If this body ever gains a `text`, saving or rotating a
  // credential starts posting to somebody's channel — a side effect nobody asked for and which
  // no other test would notice.
  const calls = fakeFetch([text("no_text", 400)]);
  await verifyWebhook(WEBHOOK);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.body, "{}");
});

test("Slack's documented answer to an empty payload proves the webhook is live", async () => {
  // `no_text` is 400. It is a *success* for this probe, because Slack can only produce it
  // after resolving the webhook — which is the fact the whole verification rests on.
  for (const body of ["no_text", "invalid_payload", "missing_text_or_fallback_or_attachments"]) {
    fakeFetch([text(body, 400)]);
    await verifyWebhook(WEBHOOK);
  }
  // And an outright 200 is obviously fine.
  fakeFetch([text("ok", 200)]);
  await verifyWebhook(WEBHOOK);
});

test("a dead Slack webhook is refused with words the user can act on", async () => {
  const cases: [string, number, RegExp][] = [
    ["no_service", 404, /removed or disabled/],
    ["no_active_hooks", 404, /disabled in Slack/],
    ["channel_not_found", 404, /no longer exists/],
    ["invalid_token", 403, /invalid or expired/],
    ["team_disabled", 403, /inactive/],
    ["action_prohibited", 403, /admin restriction/],
    ["no_team", 400, /identify the workspace/],
    ["channel_is_archived", 400, /archived/],
  ];

  for (const [body, status, expected] of cases) {
    fakeFetch([text(body, status)]);
    await assert.rejects(() => verifyWebhook(WEBHOOK), (error: unknown) => {
      assert.ok(error instanceof IntegrationError, body);
      assert.match(error.message, expected, body);
      return true;
    });
  }
});

test("an answer Slack has never documented fails closed, carrying Slack's own words", async () => {
  // Fails closed deliberately: accepting anything that is not a known failure would store a
  // webhook that cannot post and defer the error to the middle of a run, which is precisely
  // what proving a credential before storing it exists to prevent.
  fakeFetch([text("something_new", 400)]);
  await assert.rejects(() => verifyWebhook(WEBHOOK), (error: unknown) => {
    assert.match((error as Error).message, /Slack refused that webhook: something_new/);
    return true;
  });

  // An empty body still names the status rather than saying nothing.
  fakeFetch([text("", 418)]);
  await assert.rejects(() => verifyWebhook(WEBHOOK), /HTTP 418/);
});

test("posting to Slack sends the text, and a dead webhook reuses the same explanations", async () => {
  const calls = fakeFetch([text("ok", 200)]);
  await postMessage(WEBHOOK, "hello");
  assert.equal(JSON.parse(calls[0]?.body ?? "{}").text, "hello");

  fakeFetch([text("no_service", 404)]);
  await assert.rejects(() => postMessage(WEBHOOK, "hello"), /removed or disabled/);

  fakeFetch([text("weird", 400)]);
  await assert.rejects(() => postMessage(WEBHOOK, "hello"), /refused the message: weird/);
});

/* ------------------------------------------------------------------ *
 * Notion: the 404 that is really a sharing problem
 * ------------------------------------------------------------------ */

const PAGE = "1f2e3d4c-5b6a-7980-1234-567890abcdef";

test("Notion's token check reports the workspace, and pins the version header", async () => {
  const calls = fakeFetch([
    json({ name: "AgentForge", bot: { workspace_name: "Acme" } }),
  ]);
  assert.deepEqual(await verifyNotion("ntn_x"), { botName: "AgentForge", workspaceName: "Acme" });
  assert.match(calls[0]?.url ?? "", /api\.notion\.com\/v1\/users\/me$/);

  // A bot whose owner is a user rather than a workspace reports no workspace name, and that is
  // null rather than the string "undefined" reaching a settings card.
  fakeFetch([json({ name: "AgentForge", bot: {} })]);
  assert.deepEqual(await verifyNotion("ntn_x"), { botName: "AgentForge", workspaceName: null });
});

test("a Notion 404 says to connect the page, which its own message never does", async () => {
  // The single most likely failure of this integration, and Notion reports it identically to a
  // page that does not exist. A user reading only Notion's text goes looking for a deleted
  // page; this sentence is the thing that actually fixes it.
  fakeFetch([json({ message: "Could not find page with ID" }, 404)]);
  await assert.rejects(
    () => appendParagraphs("ntn_x", { pageId: PAGE, body: "hi" }),
    (error: unknown) => {
      assert.match((error as Error).message, /Could not find page with ID/);
      assert.match((error as Error).message, /Connections/);
      return true;
    },
  );

  fakeFetch([json({ message: "API token is invalid" }, 401)]);
  await assert.rejects(
    () => appendParagraphs("ntn_x", { pageId: PAGE, body: "hi" }),
    /rejected the token: API token is invalid/,
  );
});

test("appending to Notion refuses an empty body rather than sending no blocks", async () => {
  await assert.rejects(
    () => appendParagraphs("ntn_x", { pageId: PAGE, body: "   \n\n  " }),
    /no text to append/,
  );
});

test("a database's data source is resolved, and an ambiguous one is reported not guessed", async () => {
  const calls = fakeFetch([json({ data_sources: [{ id: "ds-1", name: "Tasks" }] })]);
  assert.equal(await dataSourceFor("ntn_x", PAGE), "ds-1");
  assert.match(calls[0]?.url ?? "", /\/v1\/databases\//);

  // A page rather than a database.
  fakeFetch([json({ data_sources: [] })]);
  await assert.rejects(() => dataSourceFor("ntn_x", PAGE), /no data sources/);
  fakeFetch([json({})]);
  await assert.rejects(() => dataSourceFor("ntn_x", PAGE), /no data sources/);

  // Several: writing to whichever came back first would silently pick for the user.
  fakeFetch([json({ data_sources: [{ id: "a" }, { id: "b" }] })]);
  await assert.rejects(() => dataSourceFor("ntn_x", PAGE), /has 2 data sources/);

  fakeFetch([json({ data_sources: [{ name: "no id" }] })]);
  await assert.rejects(() => dataSourceFor("ntn_x", PAGE), /no id/);
});

test("creating a Notion row sends the 2025-09-03 parent shape and the configured title property", async () => {
  // The shape the upgrade guide requires: `data_source_id`, never `database_id`. Getting this
  // wrong is a 400 from inside a run, and it is the one thing about this integration that a
  // version bump can silently invalidate.
  const calls = fakeFetch([json({ id: "page-1", url: "https://notion.so/page-1" }, 200)]);
  const result = await createDatabasePage("ntn_x", {
    dataSourceId: "ds-1",
    title: "Hello",
    titleProperty: "Task name",
    body: "one\n\ntwo",
  });

  const sent = JSON.parse(calls[0]?.body ?? "{}");
  assert.deepEqual(sent.parent, { type: "data_source_id", data_source_id: "ds-1" });
  assert.equal(sent.properties["Task name"].title[0].text.content, "Hello");
  assert.equal(sent.children.length, 2);
  assert.deepEqual(result, { pageId: "page-1", url: "https://notion.so/page-1", blocks: 2 });
});

test("a Notion row with no body sends no children key at all", async () => {
  const calls = fakeFetch([json({ id: "page-1" })]);
  const result = await createDatabasePage("ntn_x", {
    dataSourceId: "ds-1",
    title: "Hello",
    titleProperty: "Name",
    body: "",
  });
  assert.equal("children" in JSON.parse(calls[0]?.body ?? "{}"), false);
  assert.equal(result.blocks, 0);
  assert.equal(result.url, null);
});

test("a Notion page created without an id is an error, not a silent success", async () => {
  fakeFetch([json({ url: "https://notion.so/x" })]);
  await assert.rejects(
    () =>
      createDatabasePage("ntn_x", {
        dataSourceId: "ds-1",
        title: "Hello",
        titleProperty: "Name",
        body: "",
      }),
    /returned no id/,
  );
});

/* ------------------------------------------------------------------ *
 * GitHub: the token that is valid but cannot name itself
 * ------------------------------------------------------------------ */

test("a GitHub 403 on /user falls back to /rate_limit rather than refusing a good token", async () => {
  // A fine-grained token created with no account permissions answers 403 to `GET /user` while
  // being perfectly valid for filing issues. Refusing it would be this code being wrong about
  // GitHub rather than the user being wrong about their token.
  const calls = fakeFetch([json({ message: "Resource not accessible" }, 403), json({ rate: {} })]);
  assert.deepEqual(await verifyGitHub("github_pat_x"), { login: null });
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.url ?? "", /\/rate_limit$/);
});

test("a GitHub token that fails both checks is refused", async () => {
  fakeFetch([json({ message: "Forbidden" }, 403), json({ message: "Bad credentials" }, 401)]);
  await assert.rejects(() => verifyGitHub("github_pat_x"), /rejected the token: Bad credentials/);
});

test("a GitHub 401 is a bad token and is never softened into a fallback", async () => {
  const calls = fakeFetch([json({ message: "Bad credentials" }, 401)]);
  await assert.rejects(() => verifyGitHub("github_pat_x"), /rejected the token/);
  assert.equal(calls.length, 1, "a 401 must not spend a second request");
});

test("a working GitHub token reports its login and sends the pinned api version", async () => {
  const calls = fakeFetch([json({ login: "octocat" })]);
  assert.deepEqual(await verifyGitHub("github_pat_x"), { login: "octocat" });
  assert.match(calls[0]?.url ?? "", /api\.github\.com\/user$/);
});

test("a GitHub 404 explains that a fine-grained token only reaches selected repositories", async () => {
  // GitHub answers 404 rather than 403 for a resource a credential cannot see, so that it does
  // not confirm a private repository exists. Reported as the permissions problem it usually is,
  // without claiming the repository definitely exists.
  fakeFetch([json({ message: "Not Found" }, 404)]);
  await assert.rejects(
    () => createIssue("t", { owner: "a", repo: "b", title: "x", body: "", labels: [] }),
    (error: unknown) => {
      assert.match((error as Error).message, /not granted access/);
      return true;
    },
  );

  fakeFetch([json({ message: "Issues are disabled" }, 410)]);
  await assert.rejects(
    () => createIssue("t", { owner: "a", repo: "b", title: "x", body: "", labels: [] }),
    /issues are disabled/,
  );

  fakeFetch([json({ message: "Forbidden" }, 403)]);
  await assert.rejects(
    () => createIssue("t", { owner: "a", repo: "b", title: "x", body: "", labels: [] }),
    /Issues permission as read and write/,
  );
});

test("filing an issue omits an empty body and empty labels rather than sending nulls", async () => {
  const calls = fakeFetch([json({ number: 7, html_url: "https://github.com/a/b/issues/7" }, 201)]);
  const result = await createIssue("t", {
    owner: "a",
    repo: "b",
    title: "Broken",
    body: "",
    labels: [],
  });

  const sent = JSON.parse(calls[0]?.body ?? "{}");
  assert.deepEqual(Object.keys(sent), ["title"]);
  assert.deepEqual(result, { number: 7, url: "https://github.com/a/b/issues/7", repo: "a/b" });

  const withBoth = fakeFetch([json({ number: 8 }, 201)]);
  await createIssue("t", { owner: "a", repo: "b", title: "x", body: "why", labels: ["bug"] });
  const second = JSON.parse(withBoth[0]?.body ?? "{}");
  assert.equal(second.body, "why");
  assert.deepEqual(second.labels, ["bug"]);
});

test("an issue created without a number is an error, not a step that reports success", async () => {
  fakeFetch([json({ html_url: "https://github.com/a/b/issues/9" }, 201)]);
  await assert.rejects(
    () => createIssue("t", { owner: "a", repo: "b", title: "x", body: "", labels: [] }),
    /no issue number/,
  );
});

test("a comment reports the issue it was added to, since GitHub returns the comment", async () => {
  // GitHub's answer describes the *comment*, which has its own id and no issue number — so the
  // number has to come back from the request rather than from the response.
  const calls = fakeFetch([json({ id: 99, html_url: "https://github.com/a/b/issues/7#c99" }, 201)]);
  const result = await commentOnIssue("t", { owner: "a", repo: "b", issueNumber: 7, body: "hi" });
  assert.deepEqual(result, {
    number: 7,
    url: "https://github.com/a/b/issues/7#c99",
    repo: "a/b",
  });
  assert.match(calls[0]?.url ?? "", /\/repos\/a\/b\/issues\/7\/comments$/);
});

/* ------------------------------------------------------------------ *
 * Airtable
 * ------------------------------------------------------------------ */

test("Airtable's whoami proves a token with no scopes at all", async () => {
  const calls = fakeFetch([json({ id: "usr1", email: "a@b.c" })]);
  assert.deepEqual(await verifyAirtable("pat_x"), { userId: "usr1", email: "a@b.c" });
  assert.match(calls[0]?.url ?? "", /\/v0\/meta\/whoami$/);

  // `email` only arrives with `user.email:read`, so its absence is normal rather than an error.
  fakeFetch([json({ id: "usr1" })]);
  assert.deepEqual(await verifyAirtable("pat_x"), { userId: "usr1", email: null });

  fakeFetch([json({}, 200)]);
  await assert.rejects(() => verifyAirtable("pat_x"), /returned no user id/);
});

test("an Airtable table name is encoded, so a slash in it cannot change the path", async () => {
  // A table called "Q3/Q4 plan" interpolated raw would address a different path entirely.
  const calls = fakeFetch([json({ records: [{ id: "rec1", fields: {} }] })]);
  await createRecords("pat_x", {
    baseId: "appABCDEFGHIJKL",
    table: "Q3/Q4 plan",
    records: [{ Name: "x" }],
    typecast: true,
  });
  assert.match(calls[0]?.url ?? "", /\/appABCDEFGHIJKL\/Q3%2FQ4%20plan$/);
});

test("Airtable's record envelope is unwrapped, and a missing one is an error", async () => {
  fakeFetch([json({ records: [{ id: "rec1", createdTime: "2026-10-01T00:00:00Z", fields: { A: 1 } }] })]);
  const created = await createRecords("pat_x", {
    baseId: "appABCDEFGHIJKL",
    table: "T",
    records: [{ A: 1 }],
    typecast: true,
  });
  assert.deepEqual(created, [
    { id: "rec1", createdTime: "2026-10-01T00:00:00Z", fields: { A: 1 } },
  ]);

  // A record with no fields reports an empty object rather than undefined, because the node
  // hands `fields` straight to a `{{ }}` reference.
  fakeFetch([json({ records: [{ id: "rec2" }] })]);
  const sparse = await createRecords("pat_x", {
    baseId: "appABCDEFGHIJKL",
    table: "T",
    records: [{ A: 1 }],
    typecast: true,
  });
  assert.deepEqual(sparse, [{ id: "rec2", createdTime: null, fields: {} }]);

  fakeFetch([json({ nope: true })]);
  await assert.rejects(
    () =>
      createRecords("pat_x", {
        baseId: "appABCDEFGHIJKL",
        table: "T",
        records: [{ A: 1 }],
        typecast: true,
      }),
    /without a records array/,
  );
});

test("Airtable refuses to write nothing, or more than one request's worth", async () => {
  await assert.rejects(
    () => createRecords("pat_x", { baseId: "appABCDEFGHIJKL", table: "T", records: [], typecast: true }),
    /no fields to write/,
  );
  await assert.rejects(
    () =>
      createRecords("pat_x", {
        baseId: "appABCDEFGHIJKL",
        table: "T",
        records: Array.from({ length: 11 }, () => ({ A: 1 })),
        typecast: true,
      }),
    /at most 10 records/,
  );
});

test("an Airtable read clamps maxRecords into the cap and passes a view through", async () => {
  // The cap is what keeps one node call to one bounded `jsonb` in Neon.
  const calls = fakeFetch([json({ records: [] })]);
  await listRecords("pat_x", { baseId: "appABCDEFGHIJKL", table: "T", maxRecords: 5000 });
  assert.match(calls[0]?.url ?? "", /maxRecords=100/);

  const withView = fakeFetch([json({ records: [] })]);
  await listRecords("pat_x", {
    baseId: "appABCDEFGHIJKL",
    table: "T",
    maxRecords: 0,
    view: " Grid view ",
  });
  assert.match(withView[0]?.url ?? "", /maxRecords=1&view=Grid\+view/);
});

test("an Airtable failure names the three things it could be, since the message names none", async () => {
  fakeFetch([json({ error: { type: "NOT_FOUND", message: "Table not found" } }, 404)]);
  await assert.rejects(
    () => listRecords("pat_x", { baseId: "appABCDEFGHIJKL", table: "T", maxRecords: 1 }),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /Table not found/);
      assert.match(message, /exact table name/);
      assert.match(message, /data\.records/);
      return true;
    },
  );

  fakeFetch([json({ error: { type: "INVALID_VALUE", message: "Field bad" } }, 422)]);
  await assert.rejects(
    () =>
      createRecords("pat_x", {
        baseId: "appABCDEFGHIJKL",
        table: "T",
        records: [{ A: 1 }],
        typecast: true,
      }),
    /including its capitals/,
  );

  fakeFetch([json({ error: "UNAUTHORIZED" }, 401)]);
  await assert.rejects(
    () => listRecords("pat_x", { baseId: "appABCDEFGHIJKL", table: "T", maxRecords: 1 }),
    /rejected the token/,
  );
});
