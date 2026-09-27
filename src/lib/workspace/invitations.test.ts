import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  canAcceptAs,
  describeInvitation,
  describeInvitationForHolder,
  hashInvitationToken,
  INVITATION_TOKEN_PATTERN,
  INVITATION_TTL_DAYS,
  invitationExpiry,
  invitationState,
  invitationTokenMatches,
  invitationUrl,
  issueInvitationSchema,
  mintInvitationToken,
  normaliseEmail,
  type InvitationFacts,
} from "./invitations";

/**
 * The invitation rules — **the highest-stakes unit tests in the product.**
 *
 * An invitation is an unauthenticated bearer token that grants membership of a workspace
 * and, with it, the use of every credential in it. Each of the four ways one must be
 * refused is asserted separately, because they are four independent conditions and a
 * single passing "happy path" test would hide three of them.
 */

const live = (over: Partial<InvitationFacts> = {}): InvitationFacts => ({
  email: "ada@example.com",
  role: "editor",
  expiresAt: new Date(Date.now() + 60_000),
  acceptedAt: null,
  revokedAt: null,
  ...over,
});

describe("mintInvitationToken", () => {
  it("is 256 bits of base64url, and matches the pattern the routes gate on", () => {
    const token = mintInvitationToken();
    assert.equal(token.length, 43, token);
    assert.match(token, INVITATION_TOKEN_PATTERN);
    // base64url only: a `+`, `/` or `=` would have to be percent-encoded in a path and
    // would break the link for exactly the reason the alphabet was chosen.
    assert.doesNotMatch(token, /[+/=]/);
  });

  it("does not repeat", () => {
    // Not a proof of randomness — nothing here could be. It is a guard against the
    // failure that has actually happened in real codebases: a "token" derived from a
    // timestamp, a counter or a hash of the workspace id.
    const seen = new Set(Array.from({ length: 500 }, () => mintInvitationToken()));
    assert.equal(seen.size, 500);
  });

  it("is longer than the webhook token, deliberately", () => {
    // 256 bits here against the webhook trigger's 192: this grants a workspace, that
    // grants one workflow start. The two being different lengths also means neither can
    // be mistaken for the other in a log.
    assert.ok(mintInvitationToken().length > 32);
  });
});

describe("INVITATION_TOKEN_PATTERN", () => {
  it("rejects everything that is not a plausible token before the database is asked", () => {
    for (const bad of [
      "",
      "short",
      "a".repeat(31),
      "a".repeat(65),
      "has spaces in it aaaaaaaaaaaaaaaaaaaaaaa",
      "../../etc/passwd-aaaaaaaaaaaaaaaaaaaaaaaa",
      "'; drop table workspace_invitation; --aaaa",
      "%27%20OR%201%3D1aaaaaaaaaaaaaaaaaaaaaaaaa",
    ]) {
      assert.doesNotMatch(bad, INVITATION_TOKEN_PATTERN, bad);
    }
  });

  it("accepts a real one", () => {
    assert.match(mintInvitationToken(), INVITATION_TOKEN_PATTERN);
  });
});

describe("hashInvitationToken", () => {
  it("is sha256 hex of the token", () => {
    const token = "a-token";
    assert.equal(
      hashInvitationToken(token),
      createHash("sha256").update(token).digest("hex"),
    );
  });

  it("never returns the token itself", () => {
    // The point of hashing: what is stored must not be usable as a link. If this ever
    // fails, the database holds live invitations in plaintext.
    const token = mintInvitationToken();
    const hash = hashInvitationToken(token);
    assert.notEqual(hash, token);
    assert.equal(hash.includes(token), false);
    assert.equal(hash.length, 64);
  });
});

describe("invitationTokenMatches", () => {
  it("matches the token it was made from", () => {
    const token = mintInvitationToken();
    assert.equal(invitationTokenMatches(token, hashInvitationToken(token)), true);
  });

  it("refuses a different token", () => {
    assert.equal(invitationTokenMatches("a", hashInvitationToken("b")), false);
  });

  it("refuses a stored value that is not a 32-byte hex hash, without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, so a truncated or corrupted column
    // would take the route down with a 500 rather than refusing the link.
    for (const stored of ["", "zz", "not-hex-at-all", "ab".repeat(16), "ab".repeat(64)]) {
      assert.equal(invitationTokenMatches("a", stored), false, stored);
    }
  });
});

describe("invitationExpiry", () => {
  it("is seven days out", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    assert.equal(INVITATION_TTL_DAYS, 7);
    assert.equal(invitationExpiry(now).toISOString(), "2026-01-08T00:00:00.000Z");
  });
});

describe("normaliseEmail", () => {
  it("lower-cases and trims", () => {
    assert.equal(normaliseEmail("  Ada@Example.COM "), "ada@example.com");
  });

  it("does NOT strip dots or +tags", () => {
    // Deliberate. Those are provider-specific rules; this value has to equal whatever the
    // identity provider reports, and a normalisation the provider does not share would
    // silently refuse a legitimate accept.
    assert.equal(normaliseEmail("a.da+forge@example.com"), "a.da+forge@example.com");
  });
});

describe("issueInvitationSchema", () => {
  it("normalises the address and defaults the role to editor", () => {
    const parsed = issueInvitationSchema.parse({ email: " Ada@Example.com " });
    assert.deepEqual(parsed, { email: "ada@example.com", role: "editor" });
  });

  it("refuses owner", () => {
    assert.equal(
      issueInvitationSchema.safeParse({ email: "ada@example.com", role: "owner" }).success,
      false,
    );
  });

  it("refuses an address that is not one", () => {
    for (const bad of ["", "ada", "ada@", "@example.com", "   "]) {
      assert.equal(issueInvitationSchema.safeParse({ email: bad }).success, false, bad);
    }
  });

  it("accepts each invitable role", () => {
    for (const role of ["admin", "editor", "viewer"]) {
      assert.equal(
        issueInvitationSchema.safeParse({ email: "ada@example.com", role }).success,
        true,
        role,
      );
    }
  });
});

describe("invitationState", () => {
  it("is live for a fresh, untouched invitation", () => {
    assert.equal(invitationState(live()), "live");
  });

  it("is expired once the clock passes expiresAt", () => {
    const at = new Date("2026-01-08T00:00:00Z");
    assert.equal(invitationState(live({ expiresAt: at }), at), "expired");
    assert.equal(
      invitationState(live({ expiresAt: at }), new Date(at.getTime() - 1)),
      "live",
    );
  });

  it("is revoked, and revoked beats expired", () => {
    // A person's decision outranks the clock's, because "revoked" is what the person who
    // revoked it is looking for in the list.
    const facts = live({ expiresAt: new Date(0), revokedAt: new Date() });
    assert.equal(invitationState(facts), "revoked");
  });

  it("is accepted, and accepted beats everything", () => {
    const facts = live({
      expiresAt: new Date(0),
      revokedAt: new Date(),
      acceptedAt: new Date(),
    });
    assert.equal(invitationState(facts), "accepted");
  });
});

describe("canAcceptAs", () => {
  it("accepts the address it was sent to, whatever the casing", () => {
    assert.deepEqual(canAcceptAs(live(), "ADA@Example.com"), { ok: true });
    assert.deepEqual(canAcceptAs(live(), " ada@example.com "), { ok: true });
  });

  it("refuses a different address", () => {
    // The check that stops a forwarded link from being a way into somebody else's
    // workspace.
    assert.deepEqual(canAcceptAs(live(), "eve@example.com"), {
      ok: false,
      state: "wrong_email",
    });
  });

  it("refuses an account with no email address", () => {
    // Cannot happen with Google as the only provider, and `undefined === undefined` must
    // never be a match if a second provider ever arrives.
    for (const absent of [null, undefined, "", "   "]) {
      assert.deepEqual(canAcceptAs(live(), absent), { ok: false, state: "wrong_email" });
    }
  });

  it("refuses an expired invitation even for the right address", () => {
    const at = new Date("2026-02-01T00:00:00Z");
    assert.deepEqual(canAcceptAs(live({ expiresAt: new Date("2026-01-01T00:00:00Z") }), "ada@example.com", at), {
      ok: false,
      state: "expired",
    });
  });

  it("refuses a revoked invitation even for the right address", () => {
    assert.deepEqual(canAcceptAs(live({ revokedAt: new Date() }), "ada@example.com"), {
      ok: false,
      state: "revoked",
    });
  });

  it("refuses a second use — the token is single use", () => {
    assert.deepEqual(canAcceptAs(live({ acceptedAt: new Date() }), "ada@example.com"), {
      ok: false,
      state: "accepted",
    });
  });

  it("checks the state BEFORE the address", () => {
    // Order matters for what the user is told: a dead link is a dead link whoever holds
    // it, and reporting "wrong email" for an expired one would send them to sign in
    // again for nothing.
    assert.deepEqual(canAcceptAs(live({ revokedAt: new Date() }), "eve@example.com"), {
      ok: false,
      state: "revoked",
    });
  });
});

describe("invitationUrl", () => {
  it("is the app's own origin plus the token", () => {
    assert.equal(
      invitationUrl("https://example.run.app", "tok"),
      "https://example.run.app/invite/tok",
    );
  });

  it("tolerates a trailing slash on the base", () => {
    assert.equal(invitationUrl("https://example.run.app/", "tok"), "https://example.run.app/invite/tok");
  });
});

describe("describeInvitation", () => {
  it("carries no token and no hash", () => {
    // The projection an admin sees. A token cannot appear here because none is stored —
    // this asserts that the shape never grows one back.
    const described = describeInvitation({
      ...live(),
      id: "inv-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    assert.equal("token" in described, false);
    assert.equal("tokenHash" in described, false);
    assert.equal("url" in described, false);
    assert.equal(described.state, "live");
    assert.equal(described.email, "ada@example.com");
  });
});

describe("describeInvitationForHolder", () => {
  it("tells a link holder the workspace and the role, and nothing else", () => {
    // Reached before any session exists, by whoever opened the link. Anything more would
    // be describing a workspace to somebody who may not be the invitee.
    const described = describeInvitationForHolder({ role: "viewer", workspaceName: "Acme" });
    assert.deepEqual(described, { workspace: "Acme", role: "viewer" });
    assert.equal("email" in described, false);
    assert.equal("members" in described, false);
    assert.equal("id" in described, false);
  });
});
