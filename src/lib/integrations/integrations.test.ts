import assert from "node:assert/strict";
import { test } from "node:test";

import { DISCORD_CONTENT_LIMIT, normaliseWebhookUrl } from "./discord";
import { base64url, buildMessage, sanitiseHeader } from "./gmail";
import {
  authorizeUrl,
  GMAIL_SEND_SCOPE,
  INTEGRATION_SCOPES,
  missingScopes,
  parseScopes,
  SHEETS_SCOPE,
} from "./google";
import { IntegrationError } from "./net";
import { readCookie, stateMatches } from "./oauth-state";
import { spreadsheetIdFrom } from "./sheets";

/* ------------------------------------------------------------------ *
 * Discord — the credential is a URL, so its shape is the first guard
 * ------------------------------------------------------------------ */

test("a real webhook URL is accepted and normalised", () => {
  const canonical = "https://discord.com/api/webhooks/123456789/abcDEF-ghi_jkl";
  assert.equal(normaliseWebhookUrl(canonical), canonical);
  assert.equal(normaliseWebhookUrl(`  ${canonical}/  `), canonical);
  // Discord's own copy button has been known to add a query; the path is what matters.
  assert.equal(normaliseWebhookUrl(`${canonical}?wait=true`), canonical);
  assert.equal(
    normaliseWebhookUrl("https://discordapp.com/api/v10/webhooks/1/tok-en"),
    "https://discordapp.com/api/v10/webhooks/1/tok-en",
  );
});

test("the things a user pastes instead of a webhook URL are all rejected", () => {
  for (const wrong of [
    "https://discord.com/channels/123/456", // a channel link
    "https://discord.gg/invite", // an invite
    "https://discord.com/api/webhooks/123", // no token
    "https://evil.test/api/webhooks/1/tok", // not Discord
    "http://discord.com/api/webhooks/1/tok", // not https
    "not a url",
  ]) {
    assert.throws(() => normaliseWebhookUrl(wrong), IntegrationError, wrong);
  }
});

test("Discord's content limit is the one the API enforces", () => {
  assert.equal(DISCORD_CONTENT_LIMIT, 2000);
});

/* ------------------------------------------------------------------ *
 * Gmail — buildMessage is a header-injection guard, not a formatter
 * ------------------------------------------------------------------ */

test("a newline in a header value cannot splice in another header", () => {
  // The attack: a subject taken from a webhook payload adds `Bcc:`. If this ever
  // regresses, a workflow silently copies every message to somebody else.
  const raw = buildMessage({
    to: "her@example.com",
    subject: "Hello\r\nBcc: attacker@evil.test",
    body: "hi",
  });
  assert.ok(!/^Bcc:/m.test(raw), raw);
  assert.match(raw, /^Subject: Hello Bcc: attacker@evil\.test$/m);
});

test("a newline in the recipient cannot splice either", () => {
  const raw = buildMessage({ to: "a@b.test\nBcc: c@d.test", subject: "s", body: "b" });
  assert.ok(!/^Bcc:/m.test(raw), raw);
});

test("sanitiseHeader collapses every line break and trims", () => {
  assert.equal(sanitiseHeader("  a\r\n\r\nb\nc  "), "a b c");
});

test("the message is CRLF throughout with a bare blank line before the body", () => {
  const raw = buildMessage({ to: "a@b.test", subject: "S", body: "line one\nline two" });
  const [headers, body] = raw.split("\r\n\r\n");
  assert.match(headers, /^To: a@b\.test\r\n/);
  assert.match(headers, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.equal(body, "line one\r\nline two");
  assert.ok(!/[^\r]\n/.test(raw), "found a bare LF");
});

test("cc and from appear only when given", () => {
  const without = buildMessage({ to: "a@b.test", subject: "s", body: "b" });
  assert.ok(!/^Cc:/m.test(without));
  assert.ok(!/^From:/m.test(without));
  const with_ = buildMessage({ to: "a@b.test", subject: "s", body: "b", cc: "c@d.test", from: "me@x.test" });
  assert.match(with_, /^Cc: c@d\.test$/m);
  assert.match(with_, /^From: me@x\.test$/m);
});

test("an empty recipient is refused before anything is sent", () => {
  assert.throws(() => buildMessage({ to: "   ", subject: "s", body: "b" }), IntegrationError);
});

test("the encoding is base64url, not base64", () => {
  // Gmail answers 400 to `+` and `/`. This is the whole difference between a send
  // that works and one that never does.
  const encoded = base64url("þÿþÿþÿ");
  assert.ok(!encoded.includes("+"), encoded);
  assert.ok(!encoded.includes("/"), encoded);
  assert.ok(!encoded.includes("="), encoded);
  assert.equal(Buffer.from(encoded, "base64url").toString("utf8"), "þÿþÿþÿ");
});

test("a UTF-8 body survives the round trip", () => {
  const raw = buildMessage({ to: "a@b.test", subject: "Ünïcodé", body: "héllo — 世界" });
  assert.equal(Buffer.from(base64url(raw), "base64url").toString("utf8"), raw);
});

/* ------------------------------------------------------------------ *
 * Sheets — the id, from an id or from what people actually paste
 * ------------------------------------------------------------------ */

test("a spreadsheet id is read from a pasted URL or taken as given", () => {
  const id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
  assert.equal(spreadsheetIdFrom(id), id);
  assert.equal(spreadsheetIdFrom(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(spreadsheetIdFrom(`  https://docs.google.com/spreadsheets/d/${id}/edit  `), id);
});

test("something that is not an id is refused rather than 404-ing inside a run", () => {
  for (const wrong of ["", "  ", "short", "https://docs.google.com/document/d/abc/edit"]) {
    assert.throws(() => spreadsheetIdFrom(wrong), IntegrationError, JSON.stringify(wrong));
  }
});

/* ------------------------------------------------------------------ *
 * Google OAuth — the parameters that decide whether a refresh token arrives
 * ------------------------------------------------------------------ */

test("the consent URL asks for offline access and forces a prompt", () => {
  // Without both of these Google omits `refresh_token` for a user who has already
  // granted the scopes, and the integration works for exactly one hour.
  const url = new URL(
    authorizeUrl(
      { clientId: "cid", clientSecret: "secret", redirectUri: "https://app.test/api/integrations/google/callback" },
      "st4te",
    ),
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "st4te");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("scope"), `${SHEETS_SCOPE} ${GMAIL_SEND_SCOPE}`);
  // The client secret has no business in a URL the browser follows.
  assert.ok(!url.toString().includes("secret"));
});

test("both integration scopes are requested in one consent screen", () => {
  assert.deepEqual([...INTEGRATION_SCOPES], [SHEETS_SCOPE, GMAIL_SEND_SCOPE]);
});

test("granted scopes are parsed from Google's space-separated string", () => {
  assert.deepEqual(parseScopes(`openid  ${SHEETS_SCOPE}\n${GMAIL_SEND_SCOPE}`), [
    "openid",
    SHEETS_SCOPE,
    GMAIL_SEND_SCOPE,
  ]);
  assert.deepEqual(parseScopes(undefined), []);
  assert.deepEqual(parseScopes(null), []);
});

test("a scope the user unticked is reported as missing", () => {
  // The state that matters: consent succeeded, the connection looks fine, and the
  // Gmail node would 403 from inside a run with nothing explaining why.
  assert.deepEqual(missingScopes([SHEETS_SCOPE], [SHEETS_SCOPE]), []);
  assert.deepEqual(missingScopes([SHEETS_SCOPE], [GMAIL_SEND_SCOPE]), [GMAIL_SEND_SCOPE]);
  assert.deepEqual(missingScopes([], [SHEETS_SCOPE, GMAIL_SEND_SCOPE]), [SHEETS_SCOPE, GMAIL_SEND_SCOPE]);
});

test("full-mailbox access implies the send scope", () => {
  assert.deepEqual(missingScopes(["https://mail.google.com/"], [GMAIL_SEND_SCOPE]), []);
});

/* ------------------------------------------------------------------ *
 * OAuth state — the CSRF guard on the one callback a third party can trigger
 * ------------------------------------------------------------------ */

test("state comparison rejects absent, wrong and differently-sized values", () => {
  assert.equal(stateMatches("abc", "abc"), true);
  assert.equal(stateMatches("abc", "abd"), false);
  assert.equal(stateMatches("abc", "abcd"), false);
  assert.equal(stateMatches(null, "abc"), false);
  assert.equal(stateMatches("abc", null), false);
  assert.equal(stateMatches(null, null), false);
  // An empty cookie must never match an empty query parameter.
  assert.equal(stateMatches("", ""), false);
});

test("one cookie is read out of a header holding several", () => {
  const header = "other=1; agentforge-google-oauth=st4te-value; third=x";
  assert.equal(readCookie(header, "agentforge-google-oauth"), "st4te-value");
  assert.equal(readCookie(header, "missing"), null);
  assert.equal(readCookie(null, "agentforge-google-oauth"), null);
  // A name that is only a suffix of another must not match it.
  assert.equal(readCookie("xagentforge-google-oauth=no", "agentforge-google-oauth"), null);
});
