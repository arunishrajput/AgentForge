import assert from "node:assert/strict";
import { test } from "node:test";

import { CREDENTIAL_KINDS } from "@/lib/credentials/rotation";

import { CREDENTIAL_SAMPLES } from "./credential-samples";
import { isSecretField, REMOVED, SECRET_SHAPES, scrubText, scrubValue } from "./scrub";


test("every credential kind the product stores has a shape, and no shape names a kind that does not exist", () => {
  // The discipline ROTATION_RULES is held to: a kind added in a later phase with no shape here
  // would be the one credential a diagnosis could leak, and nothing else would notice.
  assert.deepEqual(Object.keys(SECRET_SHAPES).sort(), [...CREDENTIAL_KINDS].sort());
  assert.deepEqual(Object.keys(CREDENTIAL_SAMPLES).sort(), [...CREDENTIAL_KINDS].sort());
});

test("every sample credential is removed from text, wherever it sits in it", () => {
  for (const [kind, samples] of Object.entries(CREDENTIAL_SAMPLES)) {
    for (const secret of samples) {
      // Glued to the text before it, too: a word boundary before the prefix let one through once.
      for (const text of [secret, `before ${secret} after`, `"${secret}"`, `${secret}\n${secret}`, `glued${secret}`]) {
        const out = scrubText(text);
        assert.ok(!out.includes(secret), `${kind}: ${out}`);
        assert.ok(out.includes(REMOVED), kind);
      }
    }
  }
});

test("a bearer credential and a secret-named query parameter are removed by shape", () => {
  assert.equal(scrubText("Authorization: Bearer abc.def-ghi_jkl"), `Authorization: Bearer ${REMOVED}`);
  assert.equal(scrubText("Authorization: Basic dXNlcjpwYXNz"), `Authorization: Basic ${REMOVED}`);
  assert.equal(scrubText("Basic information, token bucket"), "Basic information, token bucket");
  assert.equal(
    scrubText("GET https://maps.example.com/v1/geocode?address=Paris&key=k3y-v4lu3&format=json"),
    `GET https://maps.example.com/v1/geocode?address=Paris&key=${REMOVED}&format=json`,
  );
  assert.equal(scrubText("https://x.example/cb?access_token=t0k3n#frag"), `https://x.example/cb?access_token=${REMOVED}#frag`);
});

test("fields named like secrets are emptied, whatever their value looks like", () => {
  for (const name of [
    "Authorization",
    "authorization",
    "Proxy-Authorization",
    "Cookie",
    "x-api-key",
    "X-Goog-Api-Key",
    "api_key",
    "apiKey",
    "client_secret",
    "password",
    "token",
    "refreshToken",
    "github_token",
    "accessToken",
    "connectionString",
  ]) {
    assert.ok(isSecretField(name), name);
  }
});

test("ordinary fields are left alone — a diagnosis has to be able to read the evidence", () => {
  // `key` is the Sort node's field and `auth` is a word, not a credential. Hiding which field a
  // step sorted by would hide exactly what a diagnosis is often about.
  for (const name of ["key", "id", "auth", "url", "spreadsheetId", "message", "content", "totalTokens", "monkey", "keys"]) {
    assert.ok(!isSecretField(name), name);
  }
});

test("a value is walked: strings scrubbed, secret fields emptied, names and everything else kept", () => {
  const discord = CREDENTIAL_SAMPLES["integration.discord"][0];
  const value = {
    url: "https://api.github.com/repos/arunishrajput/AgentForge",
    headers: { Authorization: "Bearer {{trigger.token}}", Accept: "application/json" },
    key: "price",
    note: `posted to ${discord}`,
    rows: [{ token: "t-1", name: "Ada" }, 3, true, null],
    usage: { totalTokens: 41 },
    empty: { password: "" },
  };
  assert.deepEqual(scrubValue(value), {
    url: "https://api.github.com/repos/arunishrajput/AgentForge",
    headers: { Authorization: REMOVED, Accept: "application/json" },
    key: "price",
    note: `posted to ${REMOVED}`,
    rows: [{ token: REMOVED, name: "Ada" }, 3, true, null],
    usage: { totalTokens: 41 },
    // An empty secret field says nothing — and saying it is empty is evidence ("no password set").
    empty: { password: "" },
  });
});

test("what looks like data but is not a credential survives", () => {
  for (const text of [
    "1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo", // a spreadsheet id
    "{{steps.fetch.output.json.full_name}}",
    "https://api.github.com/repo/arunishrajput/AgentForge answered 404: Not Found",
    "Discord refused the message: Unknown Webhook",
    "https://discord.com/channels/123/456",
    "the secret_sauce is patience",
    "pattern matching with a token bucket",
  ]) {
    assert.equal(scrubText(text), text, text);
  }
});
