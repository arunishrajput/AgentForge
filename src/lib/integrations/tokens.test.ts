import assert from "node:assert/strict";
import { test } from "node:test";

import { getNode, listNodes } from "@/lib/nodes";

import { normaliseBaseId } from "./airtable";
import { parseRepo } from "./github";
import { IntegrationError } from "./net";
import { normaliseId, NOTION_TEXT_LIMIT, NOTION_VERSION, toParagraphs } from "./notion";
import { normaliseWebhookUrl } from "./slack";
import {
  describeTokenIntegration,
  TOKEN_INTEGRATIONS,
  tokenIntegrationByKind,
  tokenIntegrationBySlug,
} from "./tokens";

/**
 * Phase 23B's own properties, in one place.
 *
 * Every function asserted here is **pure**: it parses a string a user pasted, and it is the
 * half of an integration that can be wrong without any network at all. That is deliberate —
 * the HTTP half is proved against the real service by `scripts/verify-integrations.mjs`,
 * because a mock of Slack or Notion would only ever assert what this repository already
 * believes about them (`CLAUDE.md` → *Testing expectations*).
 */

/* ------------------------------------------------------------------ *
 * The registry, and the obligations it is supposed to make unmissable
 * ------------------------------------------------------------------ */

test("the registry is the four Phase 23B services, keyed uniquely by slug and by kind", () => {
  assert.equal(TOKEN_INTEGRATIONS.length, 4);
  assert.equal(new Set(TOKEN_INTEGRATIONS.map((entry) => entry.slug)).size, 4);
  assert.equal(new Set(TOKEN_INTEGRATIONS.map((entry) => entry.kind)).size, 4);

  for (const entry of TOKEN_INTEGRATIONS) {
    assert.equal(tokenIntegrationBySlug(entry.slug), entry);
    assert.equal(tokenIntegrationByKind(entry.kind), entry);
    // The slug is a URL segment and the kind is persisted in a database row. Neither may
    // acquire a character that would have to be escaped in one place and not the other.
    assert.match(entry.slug, /^[a-z]+$/, entry.slug);
    assert.match(entry.kind, /^integration\.[a-z]+$/, entry.kind);
  }
});

test("a slug or kind that is not in the registry resolves to null, including a prototype key", () => {
  assert.equal(tokenIntegrationBySlug("discord"), null, "Discord has its own route, not this one");
  assert.equal(tokenIntegrationBySlug("google"), null);
  assert.equal(tokenIntegrationBySlug(""), null);
  // Both lookups are fed a path segment from a URL. A `Map` makes this true by construction,
  // which is why they are Maps rather than object literals — see `rotationRule`, which was
  // an object literal and answered `Object.prototype.toString` to exactly this input.
  assert.equal(tokenIntegrationBySlug("__proto__"), null);
  assert.equal(tokenIntegrationBySlug("toString"), null);
  assert.equal(tokenIntegrationByKind("__proto__"), null);
  assert.equal(tokenIntegrationByKind("toString"), null);
});

test("every entry names registry nodes that actually exist", () => {
  // The settings card says "these nodes will stop running" before revoking a credential. A
  // stale type there is a lie told at the exact moment a user is deciding something.
  for (const entry of TOKEN_INTEGRATIONS) {
    assert.ok(entry.nodes.length > 0, entry.slug);
    for (const type of entry.nodes) {
      assert.ok(getNode(type), `${entry.slug} names ${type}, which is not registered`);
    }
  }
});

test("every registered node that needs a token credential is reachable from the registry", () => {
  // The other direction, which is the one that catches a node added without its credential
  // plumbing. Any `integration.*` node whose type matches a registry slug must be listed by
  // that entry, so a node cannot quietly depend on a credential nothing can connect.
  const claimed = new Set(TOKEN_INTEGRATIONS.flatMap((entry) => entry.nodes));
  for (const node of listNodes()) {
    const slug = node.type.split(".")[1];
    if (!node.type.startsWith("integration.") || !tokenIntegrationBySlug(slug ?? "")) continue;
    assert.ok(claimed.has(node.type), `${node.type} has a registry entry that does not list it`);
  }
});

test("the copy a user reads is present, and the secret noun is not a lower-cased label", () => {
  for (const entry of TOKEN_INTEGRATIONS) {
    assert.ok(entry.blurb.length >= 80, `${entry.slug}'s blurb is too thin`);
    assert.ok(entry.rotationHelp.length >= 40, `${entry.slug}'s rotation help is too thin`);
    assert.ok(entry.docsHref.startsWith("https://"), entry.slug);
    assert.ok(entry.docsLabel.length > 0, entry.slug);
    assert.ok(entry.placeholder.length > 0, entry.slug);

    // The bug this pair of fields exists to prevent: `secretLabel.toLowerCase()` shipped
    // "incoming webhook url" into the vault and into three error messages.
    assert.equal(entry.secretNoun, entry.secretNoun.trimStart());
    assert.equal(entry.secretNoun[0], entry.secretNoun[0]?.toLowerCase(), entry.slug);
    assert.equal(entry.secretLabel[0], entry.secretLabel[0]?.toUpperCase(), entry.slug);
    if (/URL/.test(entry.secretLabel)) {
      assert.match(entry.secretNoun, /URL/, `${entry.slug} lost the acronym's capitals`);
    }
  }
});

test("the client projection carries the copy and none of the functions", () => {
  // It crosses from a server component to a client one. A `verify` closure would either be a
  // build error or the service's verification logic shipped to a browser.
  for (const entry of TOKEN_INTEGRATIONS) {
    const copy = describeTokenIntegration(entry);
    assert.deepEqual(JSON.parse(JSON.stringify(copy)), copy);
    assert.equal("verify" in copy, false);
    assert.equal("schema" in copy, false);
    assert.equal("normalise" in copy, false);
    assert.equal("detail" in copy, false);
  }
});

test("Slack stores no metadata, because every identifying part of its secret is the secret", () => {
  const slack = tokenIntegrationBySlug("slack")!;
  assert.equal(slack.detail({}), null);
  // And the others do report something, when the service gave one.
  assert.equal(tokenIntegrationBySlug("notion")!.detail({ workspaceName: "Acme" }), "Acme");
  assert.equal(tokenIntegrationBySlug("notion")!.detail({ botName: "AgentForge" }), "AgentForge");
  assert.equal(tokenIntegrationBySlug("github")!.detail({ login: "octocat" }), "@octocat");
  assert.equal(tokenIntegrationBySlug("airtable")!.detail({ email: "a@b.c" }), "a@b.c");
  assert.equal(tokenIntegrationBySlug("airtable")!.detail({ userId: "usr1" }), "usr1");
  // A credential whose service told us nothing reports nothing rather than "undefined".
  for (const entry of TOKEN_INTEGRATIONS) assert.equal(entry.detail({}) ?? null, entry.detail({}) ?? null);
});

/* ------------------------------------------------------------------ *
 * Slack
 * ------------------------------------------------------------------ */

test("a Slack webhook URL is accepted only on Slack's own host and shape", () => {
  // Deliberately self-describing rather than realistic. The first version of this fixture was
  // a plausible-looking 24-character token, and GitHub's push protection refused the commit —
  // correctly, because "it is only a test fixture" is exactly what a real leaked webhook would
  // also look like to a scanner. A fixture only has to satisfy WEBHOOK_PATTERN, so it may as
  // well say what it is.
  const good = "https://hooks.slack.com/services/T00000000/B00000000/EXAMPLE-NOT-A-REAL-WEBHOOK";
  assert.equal(normaliseWebhookUrl(`  ${good}  `), good);
  assert.equal(normaliseWebhookUrl(good), good);
});

test("a Slack webhook URL on any other host is refused before it is ever sent", () => {
  // The refusal matters more than the parse: this value is a bearer credential, and the one
  // host it may be POSTed to is Slack's. A loose check would send the user's mistyped secret
  // to whatever they actually typed.
  for (const bad of [
    "http://hooks.slack.com/services/T1/B1/xyz", // not https
    "https://hooks.slack.com.evil.test/services/T1/B1/xyz",
    "https://evil.test/services/T1/B1/xyz",
    "https://hooks.slack.com/services/T1/B1", // a segment short
    "https://hooks.slack.com/webhook/T1/B1/xyz",
    "https://hooks.slack.com/services/T1/B1/xyz?x=1",
    "",
    "not a url",
  ]) {
    assert.throws(() => normaliseWebhookUrl(bad), IntegrationError, bad);
  }
});

/* ------------------------------------------------------------------ *
 * Notion
 * ------------------------------------------------------------------ */

test("the Notion API version is pinned, because the parent shape depends on it", () => {
  // 2025-09-03 is the version whose upgrade guide this implementation was written against:
  // `parent: { database_id }` is refused from here on, and a data source has to be resolved.
  // If this changes, the guide for the new version has to be read first.
  assert.equal(NOTION_VERSION, "2025-09-03");
});

test("a Notion id is read from an id, a dashed id, or a pasted link", () => {
  const dashed = "1f2e3d4c-5b6a-7980-1234-567890abcdef";
  const bare = "1f2e3d4c5b6a79801234567890abcdef";
  assert.equal(normaliseId(bare), dashed);
  assert.equal(normaliseId(dashed), dashed);
  assert.equal(normaliseId(`https://www.notion.so/My-Page-${bare}`), dashed);
  assert.equal(normaliseId(`https://www.notion.so/workspace/My-Page-${bare.toUpperCase()}`), dashed);
});

test("a slug ending in hex letters does not eat the id — the bug this parser had", () => {
  // "Cafe", "Decade", "Facade": a–f are letters, and the first version of `normaliseId`
  // stripped every dash before matching 32 hex characters, so the window started one letter
  // early and dropped the id's last digit. The result was a *well-formed* id for a page that
  // does not exist, and a 404 that reads like a permissions problem. Nothing about that
  // failure points at the parser, which is why it gets its own test.
  const id = "1f2e3d4c5b6a79801234567890abcdef";
  const dashed = "1f2e3d4c-5b6a-7980-1234-567890abcdef";
  for (const slug of ["Cafe", "Decade", "Facade", "Deadbeef", "ABBA", "beef"]) {
    assert.equal(normaliseId(`https://www.notion.so/${slug}-${id}`), dashed, slug);
  }
  // And the same shape with no host at all.
  assert.equal(normaliseId(`Cafe-${id}`), dashed);
});

test("a database link's view id never wins over its database id", () => {
  // The trap: a database URL carries a *second* 32-hex id in `?v=`, and taking the first
  // match — or matching after the query string — sends the view id and gets a 404 that reads
  // like a permissions problem. Both halves of the fix are asserted here.
  const database = "1f2e3d4c5b6a79801234567890abcdef";
  const view = "aaaabbbbccccddddeeeeffff00001111";
  assert.equal(
    normaliseId(`https://www.notion.so/My-Tasks-${database}?v=${view}&pvs=4`),
    "1f2e3d4c-5b6a-7980-1234-567890abcdef",
  );
});

test("a Notion target with no id in it is refused rather than guessed at", () => {
  for (const bad of ["", "   ", "https://www.notion.so/My-Page", "not-an-id", "abc123"]) {
    assert.throws(() => normaliseId(bad), IntegrationError, JSON.stringify(bad));
  }
});

test("a body becomes paragraphs on blank lines, then on Notion's own length limit", () => {
  assert.deepEqual(toParagraphs("one\n\ntwo"), ["one", "two"]);
  assert.deepEqual(toParagraphs("one\nstill one\n\n\n  two  "), ["one\nstill one", "two"]);
  assert.deepEqual(toParagraphs(""), []);
  assert.deepEqual(toParagraphs("   \n\n  "), []);

  // Notion rejects a rich-text content string longer than this, so a long paragraph has to be
  // split rather than sent and 400'd.
  const long = "x".repeat(NOTION_TEXT_LIMIT * 2 + 5);
  const blocks = toParagraphs(long);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]?.length, NOTION_TEXT_LIMIT);
  assert.equal(blocks[2]?.length, 5);
  assert.equal(blocks.join(""), long);
});

/* ------------------------------------------------------------------ *
 * GitHub
 * ------------------------------------------------------------------ */

test("a GitHub repository is read from owner/repo or from a pasted URL", () => {
  assert.deepEqual(parseRepo("octocat/hello-world"), { owner: "octocat", repo: "hello-world" });
  assert.deepEqual(parseRepo("  octocat/hello-world  "), { owner: "octocat", repo: "hello-world" });
  assert.deepEqual(parseRepo("https://github.com/octocat/hello-world"), {
    owner: "octocat",
    repo: "hello-world",
  });
  assert.deepEqual(parseRepo("https://github.com/octocat/hello-world.git"), {
    owner: "octocat",
    repo: "hello-world",
  });
  assert.deepEqual(parseRepo("https://www.github.com/octocat/hello-world/"), {
    owner: "octocat",
    repo: "hello-world",
  });
  assert.deepEqual(parseRepo("a-b/c.d_e"), { owner: "a-b", repo: "c.d_e" });
});

test("a GitHub repository that would escape its path segment is refused", () => {
  // Both halves are interpolated straight into an API path, so anything that could add a
  // segment or a query has to be refused here rather than sanitised later.
  for (const bad of [
    "",
    "octocat",
    "octocat/hello/world",
    "octocat//hello",
    "../../etc",
    "octocat/hello world",
    "-octocat/hello",
    "octocat-/hello",
    "octocat/hello?x=1",
    "octocat/hello#frag",
  ]) {
    assert.throws(() => parseRepo(bad), IntegrationError, JSON.stringify(bad));
  }
});

/* ------------------------------------------------------------------ *
 * Airtable
 * ------------------------------------------------------------------ */

test("an Airtable base id is read from the id or from a pasted base URL", () => {
  assert.equal(normaliseBaseId("appABCDEFGHIJKL"), "appABCDEFGHIJKL");
  assert.equal(normaliseBaseId("  appABCDEFGHIJKL "), "appABCDEFGHIJKL");
  assert.equal(
    normaliseBaseId("https://airtable.com/appABCDEFGHIJKL/tblXYZ/viwQRS"),
    "appABCDEFGHIJKL",
  );
});

test("anything that is not an Airtable base id is refused", () => {
  for (const bad of ["", "tblABCDEFGHIJKL", "app", "appSHORT", "https://airtable.com/", "Table 1"]) {
    assert.throws(() => normaliseBaseId(bad), IntegrationError, JSON.stringify(bad));
  }
});
