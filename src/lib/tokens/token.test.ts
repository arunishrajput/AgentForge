import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCESS_TOKEN_PATTERN,
  createTokenSchema,
  createUseTracker,
  effectiveRole,
  hashAccessToken,
  lesserRole,
  mayMint,
  mintAccessToken,
  readBearer,
  tokenHint,
  tokenState,
  TOKEN_PREFIX,
} from "./token";

describe("the token itself", () => {
  it("is 256 bits of CSPRNG behind a recognisable prefix, and never the same twice", () => {
    const a = mintAccessToken();
    const b = mintAccessToken();
    assert.match(a, ACCESS_TOKEN_PATTERN);
    assert.ok(a.startsWith(TOKEN_PREFIX));
    assert.equal(a.length, 47);
    assert.notEqual(a, b);
  });

  it("is stored as a hash that is not the token, is stable, and is hex SHA-256", () => {
    const token = mintAccessToken();
    const hash = hashAccessToken(token);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashAccessToken(token));
    assert.ok(!hash.includes(token.slice(4)));
  });

  it("shows only the prefix and four characters to tell tokens apart", () => {
    const token = mintAccessToken();
    assert.equal(tokenHint(token), token.slice(0, 8));
    assert.equal(tokenHint(token).length, 8);
  });
});

describe("reading an Authorization header", () => {
  const token = mintAccessToken();

  it("takes a Bearer token of ours, in any case of the scheme", () => {
    for (const scheme of ["Bearer", "bearer", "BEARER"]) {
      assert.deepEqual(readBearer(`${scheme} ${token}`), { kind: "token", token });
    }
  });

  it("ignores a request that carries no header or another scheme — that is the session's business", () => {
    assert.deepEqual(readBearer(null), { kind: "none" });
    assert.deepEqual(readBearer(undefined), { kind: "none" });
    assert.deepEqual(readBearer(""), { kind: "none" });
    assert.deepEqual(readBearer("Basic dXNlcjpwdw=="), { kind: "none" });
  });

  it("refuses a Bearer header that is not shaped like one of ours, before any lookup", () => {
    for (const header of [
      "Bearer",
      "Bearer ",
      "Bearer nonsense",
      `Bearer ${token.slice(0, -1)}`,
      `Bearer ${token}x`,
      `Bearer afp_${"a".repeat(44)}`,
      `Bearer ${token} ${token}`,
      "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x",
    ]) {
      assert.deepEqual(readBearer(header), { kind: "malformed" }, header);
    }
  });
});

describe("what a token can do", () => {
  it("is the lower of its ceiling and what its creator holds now", () => {
    assert.equal(effectiveRole("editor", "owner"), "editor");
    assert.equal(effectiveRole("editor", "editor"), "editor");
    assert.equal(effectiveRole("viewer", "owner"), "viewer");
    assert.equal(effectiveRole("editor", "viewer"), "viewer");
    assert.equal(lesserRole("admin", "viewer"), "viewer");
  });

  it("is nothing once the creator is no longer a member", () => {
    assert.equal(effectiveRole("editor", null), null);
    assert.equal(effectiveRole("viewer", null), null);
  });

  it("is never created above the creator's own role", () => {
    assert.equal(mayMint("owner", "editor"), true);
    assert.equal(mayMint("editor", "editor"), true);
    assert.equal(mayMint("viewer", "viewer"), true);
    assert.equal(mayMint("viewer", "editor"), false);
  });

  it("can be asked for only as viewer or editor — nothing an allowlisted route needs is higher", () => {
    const ok = { name: "ci", expiresInDays: 30 };
    assert.equal(createTokenSchema.safeParse({ ...ok, role: "editor" }).success, true);
    assert.equal(createTokenSchema.safeParse({ ...ok, role: "viewer" }).success, true);
    for (const role of ["admin", "owner", "root"]) {
      assert.equal(createTokenSchema.safeParse({ ...ok, role }).success, false, role);
    }
  });
});

describe("creating a token", () => {
  const base = { name: "ci", role: "editor", expiresInDays: 30 };

  it("requires an expiry, within a year", () => {
    assert.equal(createTokenSchema.safeParse({ name: "ci", role: "editor" }).success, false);
    assert.equal(createTokenSchema.safeParse({ ...base, expiresInDays: 0 }).success, false);
    assert.equal(createTokenSchema.safeParse({ ...base, expiresInDays: 366 }).success, false);
    assert.equal(createTokenSchema.safeParse({ ...base, expiresInDays: 1.5 }).success, false);
    assert.equal(createTokenSchema.safeParse({ ...base, expiresInDays: 365 }).success, true);
  });

  it("requires a real name, trimmed", () => {
    assert.equal(createTokenSchema.safeParse({ ...base, name: "   " }).success, false);
    assert.equal(createTokenSchema.safeParse({ ...base, name: "x".repeat(61) }).success, false);
    const parsed = createTokenSchema.parse({ ...base, name: "  nightly  " });
    assert.equal(parsed.name, "nightly");
  });
});

describe("a token's state", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const future = new Date(now + 1000);
  const past = new Date(now - 1000);

  it("is live until it expires or is revoked", () => {
    assert.equal(tokenState({ expiresAt: future, revokedAt: null }, now), "live");
    assert.equal(tokenState({ expiresAt: past, revokedAt: null }, now), "expired");
    assert.equal(tokenState({ expiresAt: new Date(now), revokedAt: null }, now), "expired");
  });

  it("is revoked whatever its expiry says", () => {
    assert.equal(tokenState({ expiresAt: future, revokedAt: past }, now), "revoked");
    assert.equal(tokenState({ expiresAt: past, revokedAt: past }, now), "revoked");
  });
});

describe("last-used writes", () => {
  it("are due once per interval per token, not once per request", () => {
    const tracker = createUseTracker(300_000);
    assert.equal(tracker.due("a", 0), true);
    assert.equal(tracker.due("a", 1), false);
    assert.equal(tracker.due("a", 299_999), false);
    assert.equal(tracker.due("b", 10), true, "another token has its own interval");
    assert.equal(tracker.due("a", 300_000), true);
    assert.equal(tracker.due("a", 300_001), false);
  });

  it("holds a bounded number of tokens", () => {
    const tracker = createUseTracker(300_000, 3);
    for (let i = 0; i < 20; i++) tracker.due(`t${i}`, i);
    assert.equal(tracker.size(), 3);
  });
});

