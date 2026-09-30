import assert from "node:assert/strict";
import { test } from "node:test";

import { DISCORD_CREDENTIAL_KIND } from "@/lib/integrations/discord";
import { GOOGLE_CREDENTIAL_KIND } from "@/lib/integrations/google";
import { TOKEN_INTEGRATIONS } from "@/lib/integrations/tokens";

import { ApiError } from "@/lib/api-error";
import { clearTokenCache } from "@/lib/gcp/metadata";
import { accessToken, projectId } from "@/lib/gcp/metadata";
import { clearSecretCache, readRootKeyVersion, rootKeySecretName } from "@/lib/gcp/secret-manager";

import {
  CREDENTIAL_EVENT_LABELS,
  CREDENTIAL_EVENTS,
  describeEvent,
  EVENT_RETENTION_DAYS,
  retentionCutoff,
} from "./audit";
import { describeCredential, LLM_CREDENTIAL_KIND } from "./index";
import {
  CREDENTIAL_KINDS,
  ROTATION_RULES,
  rotateCredential,
  rotationRule,
} from "./rotation";

/* ------------------------------------------------------------------ *
 * The rotation table must cover the registry, in both directions
 * ------------------------------------------------------------------ */

/**
 * The same gate `share.test.ts` puts on `PUBLISHABLE`, for the same reason. A credential kind
 * added in a later phase with no rotation rule would silently become unrotatable — the vault
 * would list it with no control, and **nothing would break**, so nobody would notice. This
 * fails the build instead, which forces whoever adds a kind to decide what rotating it means.
 */
test("every credential kind the product stores has a rotation rule", () => {
  for (const kind of CREDENTIAL_KINDS) {
    assert.ok(rotationRule(kind), `${kind} has no entry in ROTATION_RULES`);
  }
});

test("every rotation rule names a kind the product actually stores", () => {
  // The other direction, which catches the rule left behind after a kind is removed — a
  // control in the vault for a credential that can no longer exist.
  for (const kind of Object.keys(ROTATION_RULES)) {
    assert.ok(
      (CREDENTIAL_KINDS as readonly string[]).includes(kind),
      `ROTATION_RULES has ${kind}, which CREDENTIAL_KINDS does not list`,
    );
  }
});

test("the seven kinds are the seven the product stores, and no more", () => {
  // Pinned deliberately, and it did its job: it said "a fourth kind arriving in Phase 23
  // should fail this and be a decision, not a diff nobody reads", and Phase 23B's four made
  // it fail. The list is spelled out rather than derived from TOKEN_INTEGRATIONS on purpose —
  // deriving it from the same table `CREDENTIAL_KINDS` is built from would assert nothing.
  assert.deepEqual([...CREDENTIAL_KINDS].sort(), [
    DISCORD_CREDENTIAL_KIND,
    GOOGLE_CREDENTIAL_KIND,
    LLM_CREDENTIAL_KIND,
    "integration.slack",
    "integration.notion",
    "integration.github",
    "integration.airtable",
  ].sort());
});

test("every token integration is rotatable by value, with a title that reads as English", () => {
  // The rules are generated from TOKEN_INTEGRATIONS, so what needs asserting is not that they
  // exist but that generating them produced something a person can read. The first version
  // lower-cased `secretLabel` to build these strings and shipped "Slack incoming webhook url"
  // into the vault — a transformation that is wrong precisely when the label holds an acronym.
  for (const integration of TOKEN_INTEGRATIONS) {
    const rule = rotationRule(integration.kind);
    assert.ok(rule, `${integration.kind} has no rotation rule`);
    assert.equal(rule.mode, "value");
    assert.ok(rule.schema, `${integration.kind} bounds nothing`);
    assert.equal(rule.title, `${integration.service} ${integration.secretNoun}`);
    assert.ok(
      !/\burl\b/.test(rule.title) && !/\burl\b/.test(rule.secretLabel ?? ""),
      `${integration.kind} renders "URL" as "url": ${rule.title} / ${rule.secretLabel}`,
    );
  }
});

test("a value rotation offers an input and a shape to check it against", () => {
  for (const [kind, rule] of Object.entries(ROTATION_RULES)) {
    if (rule.mode !== "value") continue;
    assert.ok(rule.secretLabel, `${kind} is rotatable by value but labels no input`);
    assert.ok(rule.schema, `${kind} is rotatable by value but bounds nothing`);
  }
});

test("a reconnect rotation offers somewhere to go instead of a box that cannot work", () => {
  for (const [kind, rule] of Object.entries(ROTATION_RULES)) {
    if (rule.mode !== "reconnect") continue;
    assert.ok(rule.reconnectHref, `${kind} cannot be rotated by value and links nowhere`);
    assert.equal(rule.schema, undefined, `${kind} bounds a secret it cannot accept`);
  }
});

test("every kind says where to go to connect one, so the vault has no dead ends", () => {
  // Found in a browser: an empty workspace's vault listed all three kinds as "Not connected"
  // and offered a link for exactly one of them, because the list was reading `reconnectHref`
  // — a field only a `reconnect` credential has. Naming something missing without saying
  // where to get it is worse than not listing it.
  for (const [kind, rule] of Object.entries(ROTATION_RULES)) {
    assert.ok(rule.connectHref, `${kind} does not say where to connect one`);
    assert.match(rule.connectHref, /^\/settings/, `${kind} points outside settings`);
  }
});

test("google.oauth is reconnect, because only Google can mint a refresh token", () => {
  assert.equal(rotationRule(GOOGLE_CREDENTIAL_KIND)?.mode, "reconnect");
});

test("the provider key and the Discord webhook are both rotatable by value", () => {
  assert.equal(rotationRule(LLM_CREDENTIAL_KIND)?.mode, "value");
  assert.equal(rotationRule(DISCORD_CREDENTIAL_KIND)?.mode, "value");
});

test("every rule says what rotation does, in a sentence somebody can read", () => {
  for (const [kind, rule] of Object.entries(ROTATION_RULES)) {
    assert.ok(rule.title.length > 0, `${kind} has no title`);
    assert.ok(rule.help.length > 20, `${kind}'s help is too short to be useful`);
  }
});

test("an unknown kind has no rule, rather than a permissive default", () => {
  // Fails closed. A kind nobody has decided about must not be rotatable by accident.
  assert.equal(rotationRule("integration.no_such_service"), null);
  assert.equal(rotationRule(""), null);
  // The generated entries are spread into an object literal, so a prototype key must not
  // resolve to something off Object.prototype — the same hole `getNode` is tested for.
  assert.equal(rotationRule("__proto__"), null);
  assert.equal(rotationRule("toString"), null);
});

test("a rotation schema refuses an obviously wrong secret before the provider is called", () => {
  const key = ROTATION_RULES[LLM_CREDENTIAL_KIND]!.schema!;
  assert.equal(key.safeParse("short").success, false);
  assert.equal(key.safeParse("x".repeat(500)).success, false);
  assert.equal(key.safeParse("AIzaSyExampleLookingKeyNotReal_0123456789").success, true);
});

/* ------------------------------------------------------------------ *
 * The audit vocabulary
 * ------------------------------------------------------------------ */

test("every event name has a label, and every label names an event", () => {
  for (const event of CREDENTIAL_EVENTS) {
    assert.ok(CREDENTIAL_EVENT_LABELS[event], `${event} has no label`);
  }
  assert.deepEqual(
    Object.keys(CREDENTIAL_EVENT_LABELS).sort(),
    [...CREDENTIAL_EVENTS].sort(),
  );
});

test("stored and rotated are distinct events", () => {
  // Both write the same three columns. The distinction is whether a secret existed here
  // before, and collapsing it would make every credential look as though it had been
  // replaced once.
  assert.notEqual(CREDENTIAL_EVENT_LABELS.stored, CREDENTIAL_EVENT_LABELS.rotated);
  assert.ok((CREDENTIAL_EVENTS as readonly string[]).includes("stored"));
  assert.ok((CREDENTIAL_EVENTS as readonly string[]).includes("rotated"));
});

test("retention is a bounded number of days, not unlimited", () => {
  // A log with no retention is the largest table in a 0.5 GB free-tier database eventually.
  assert.ok(EVENT_RETENTION_DAYS > 0);
  assert.ok(EVENT_RETENTION_DAYS <= 90);
});

/* ------------------------------------------------------------------ *
 * The two projections that must never carry a secret
 * ------------------------------------------------------------------ */

/** A credential row as the database hands it over, envelope columns and all. */
const ROW = {
  id: "cred-1",
  kind: LLM_CREDENTIAL_KIND,
  label: "default",
  metadata: { model: "gemini-3-flash-preview" },
  ciphertext: "CIPHERTEXT-WOULD-BE-HERE",
  iv: "IV-WOULD-BE-HERE",
  authTag: "TAG-WOULD-BE-HERE",
  wrappedKey: "WRAPPED-DATA-KEY-WOULD-BE-HERE",
  wrapIv: "WRAP-IV",
  wrapAuthTag: "WRAP-TAG",
  keyVersion: "sm:1",
  rotatedAt: new Date("2026-09-30T09:00:00Z"),
  rotationCount: 2,
  createdAt: new Date("2026-09-26T09:00:00Z"),
  updatedAt: new Date("2026-09-30T09:00:00Z"),
};

test("describeCredential carries no part of the envelope, in any field", () => {
  // **The write-only rule, asserted rather than maintained by hand.** Phase 6 set it and Phase
  // 21 added four more columns that must obey it — the serialised projection is searched for
  // every one of them, so a future spread cannot quietly widen this.
  const described = describeCredential(ROW);
  const serialised = JSON.stringify(described);
  for (const secret of [
    ROW.ciphertext,
    ROW.iv,
    ROW.authTag,
    ROW.wrappedKey,
    ROW.wrapIv,
    ROW.wrapAuthTag,
  ]) {
    assert.equal(serialised.includes(secret), false, `leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(described).sort(), [
    "createdAt",
    "keyVersion",
    "kind",
    "label",
    "legacy",
    "metadata",
    "rotatedAt",
    "rotationCount",
    "updatedAt",
  ]);
});

test("describeCredential reports the key version, which is not key material", () => {
  // A version label names immutable bytes in a key store and reveals nothing about them. It
  // crosses to the client because it is the only way an operator can tell that a re-key moved
  // anything — otherwise the phase's central claim has to be taken on trust.
  assert.equal(describeCredential(ROW).keyVersion, "sm:1");
  assert.equal(describeCredential(ROW).legacy, false);
});

test("a Chapter 1 row is reported as legacy so the vault can say so", () => {
  const legacy = describeCredential({ ...ROW, wrappedKey: null, keyVersion: null });
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.keyVersion, null);
});

test("rotatedAt and rotationCount are projected separately from updatedAt", () => {
  // They answer different questions: "saved 5 minutes ago" and "the key has never been
  // replaced" are both true of a credential whose model was just changed, and only the second
  // is about risk.
  const described = describeCredential({ ...ROW, rotatedAt: null, rotationCount: 0 });
  assert.equal(described.rotatedAt, null);
  assert.equal(described.rotationCount, 0);
  assert.equal(described.updatedAt, ROW.updatedAt.toISOString());
});

test("describeEvent never projects who did it", () => {
  // Recorded in the database, deliberately absent from the response: a workspace member
  // cannot act on it, and a user id on a page about secrets is one identifier too many.
  const described = describeEvent({
    id: "ev-1",
    event: "rotated",
    kind: LLM_CREDENTIAL_KIND,
    label: "default",
    runId: null,
    nodeId: null,
    nodeType: null,
    detail: "sm:1",
    at: new Date("2026-09-30T09:00:00Z"),
    credentialId: "cred-1",
  });
  assert.equal("actorId" in described, false);
  assert.equal(described.orphaned, false);
  assert.equal(described.label, CREDENTIAL_EVENT_LABELS.rotated);
});

test("an event whose credential is gone is marked orphaned, not hidden", () => {
  // `ON DELETE SET NULL` plus the denormalised kind is what keeps a revocation readable, which
  // is exactly when somebody wants to read it.
  const described = describeEvent({
    id: "ev-2",
    event: "revoked",
    kind: LLM_CREDENTIAL_KIND,
    label: "default",
    runId: null,
    nodeId: null,
    nodeType: null,
    detail: null,
    at: new Date("2026-09-30T09:00:00Z"),
    credentialId: null,
  });
  assert.equal(described.orphaned, true);
  assert.equal(described.kind, LLM_CREDENTIAL_KIND);
});

test("the retention cutoff is exactly the retention window, in days", () => {
  // Off by a factor of 1000 either deletes the whole log on the next tick or never deletes
  // anything, and both look like nothing happening.
  const now = new Date("2026-09-30T00:00:00Z");
  const cutoff = retentionCutoff(now);
  assert.equal(
    (now.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000),
    EVENT_RETENTION_DAYS,
  );
  assert.ok(cutoff < now);
});

/* ------------------------------------------------------------------ *
 * Rotation refuses before it writes
 * ------------------------------------------------------------------ */

const SCOPE = { workspaceId: "ws-1", userId: "user-1", role: "admin" } as const;

test("an unknown kind is 404, not 400 — the vault builds its controls from the table", async () => {
  await assert.rejects(
    // Not `integration.slack` any more: Phase 23B made that a real kind, and a test for
    // "an unknown kind is refused" whose example became known is a test that passes by
    // accident. Same correction as `generate.test.ts` needed.
    () => rotateCredential({ scope: SCOPE, kind: "integration.no_such_service", secret: "x".repeat(20) }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

test("a reconnect credential refuses with the reason, and reaches no provider", async () => {
  // The refusal happens before the dynamic import of any store, so this needs no database —
  // which is also the property that makes it impossible to half-rotate a Google connection.
  await assert.rejects(
    () =>
      rotateCredential({
        scope: SCOPE,
        kind: "google.oauth",
        secret: "1//not-a-real-refresh-token",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "invalid_request");
      assert.match(error.message, /only be issued by Google/);
      return true;
    },
  );
});

test("a secret that fails the shape check never reaches the provider", async () => {
  await assert.rejects(
    () => rotateCredential({ scope: SCOPE, kind: LLM_CREDENTIAL_KIND, secret: "short" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "invalid_request");
      return true;
    },
  );
});

/* ------------------------------------------------------------------ *
 * The operator paths — what makes a root key rotation possible at all
 * ------------------------------------------------------------------ */

test("a supplied access token short-circuits the metadata server", async () => {
  // There is no metadata server off Cloud Run, so without this branch `scripts/rekey.mjs`
  // could never reach a key store — and a root key that can only be rotated from inside the
  // container is a root key that never gets rotated.
  clearTokenCache();
  process.env.GCP_ACCESS_TOKEN = "ya29.operator-supplied";
  try {
    assert.equal(await accessToken(), "ya29.operator-supplied");
  } finally {
    delete process.env.GCP_ACCESS_TOKEN;
    clearTokenCache();
  }
});

test("a supplied project short-circuits the metadata server too", async () => {
  process.env.GCP_PROJECT = "agentforge-test";
  try {
    assert.equal(await projectId(), "agentforge-test");
  } finally {
    delete process.env.GCP_PROJECT;
  }
});

test("with no ROOT_KEY_SECRET the secret store is unconfigured, not an error", async () => {
  // Unconfigured is a supported state: it is a developer machine, CI, and any deployment that
  // has not been given a secret. Throwing here would make the whole product unbootable off
  // Cloud Run.
  clearSecretCache();
  delete process.env.ROOT_KEY_SECRET;
  assert.equal(rootKeySecretName(), null);
  assert.deepEqual(await readRootKeyVersion("1"), { ok: false, reason: "unconfigured" });
});

test("a blank ROOT_KEY_SECRET is unset rather than a secret named empty string", async () => {
  process.env.ROOT_KEY_SECRET = "   ";
  try {
    assert.equal(rootKeySecretName(), null);
  } finally {
    delete process.env.ROOT_KEY_SECRET;
  }
});

test("a named secret with no reachable project is unconfigured, and writes nothing", async () => {
  clearSecretCache();
  clearTokenCache();
  process.env.ROOT_KEY_SECRET = "agentforge-root-key";
  const savedProject = process.env.GCP_PROJECT;
  delete process.env.GCP_PROJECT;
  process.env.GCP_ACCESS_TOKEN = "ya29.irrelevant";
  try {
    const result = await readRootKeyVersion("1");
    // No project means no URL to call, so this resolves without a network round trip.
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "unconfigured");
  } finally {
    delete process.env.ROOT_KEY_SECRET;
    delete process.env.GCP_ACCESS_TOKEN;
    if (savedProject) process.env.GCP_PROJECT = savedProject;
    clearSecretCache();
    clearTokenCache();
  }
});
