import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { decodeKey, generateDataKey, KEY_BYTES, open, seal } from "./aes";
import {
  EnvelopeError,
  isLegacyEnvelope,
  openSecret,
  rewrap,
  sealSecret,
  sealSecretWith,
  type Envelope,
} from "./envelope";
import {
  currentRootKey,
  ENV_KEY_VERSION,
  rootKey,
  RootKeyError,
  rootKeyProvider,
  secretManagerVersion,
  secretManagerVersionNumber,
} from "./root-key";
import { clearSecretCache, versionFromName } from "@/lib/gcp/secret-manager";

/**
 * The suite owns its keys: `npm test` does not load `.env`, and a credential test must never
 * depend on a real one. `ROOT_KEY_SECRET` is deliberately left unset, so every test here runs
 * on the `env` root key provider and nothing reaches Secret Manager or a metadata server.
 */
const KEY_A = randomBytes(KEY_BYTES).toString("base64");
const KEY_B = randomBytes(KEY_BYTES).toString("base64");
process.env.ENCRYPTION_KEY = KEY_A;
delete process.env.ROOT_KEY_SECRET;

const SECRET = "AIzaSyExampleLookingKeyNotReal_0123456789";

/* ------------------------------------------------------------------ *
 * aes.ts — the cipher, with nothing around it
 * ------------------------------------------------------------------ */

test("a buffer survives a seal/open round trip", () => {
  const key = generateDataKey();
  assert.equal(open(key, seal(key, SECRET)).toString("utf8"), SECRET);
});

test("sealing twice with one key gives a different IV and a different ciphertext", () => {
  // A fresh IV per call, generated inside `seal` so no caller can supply one. IV reuse
  // under GCM is a key-recovery break, not a theoretical weakness.
  const key = generateDataKey();
  const first = seal(key, SECRET);
  const second = seal(key, SECRET);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("a tampered ciphertext is refused, not silently mangled", () => {
  const key = generateDataKey();
  const sealed = seal(key, SECRET);
  const bytes = Buffer.from(sealed.ciphertext, "base64");
  bytes[0] ^= 0xff;
  assert.throws(() => open(key, { ...sealed, ciphertext: bytes.toString("base64") }));
});

test("a tampered auth tag is refused — this is why GCM and not CBC", () => {
  const key = generateDataKey();
  const sealed = seal(key, SECRET);
  const tag = Buffer.from(sealed.authTag, "base64");
  tag[0] ^= 0xff;
  assert.throws(() => open(key, { ...sealed, authTag: tag.toString("base64") }));
});

test("the wrong key fails rather than returning plausible rubbish", () => {
  const sealed = seal(generateDataKey(), SECRET);
  assert.throws(() => open(generateDataKey(), sealed));
});

test("a key of the wrong length fails with the length and never the value", () => {
  assert.throws(
    () => decodeKey(Buffer.from("too short").toString("base64"), "TEST_KEY"),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, /must decode to 32 bytes/);
      assert.equal(message.includes("too short"), false);
      return true;
    },
  );
});

test("a data key is 256 bits and never the same twice", () => {
  const first = generateDataKey();
  const second = generateDataKey();
  assert.equal(first.length, KEY_BYTES);
  assert.notEqual(first.toString("base64"), second.toString("base64"));
});

/* ------------------------------------------------------------------ *
 * root-key.ts — which key, and which version of it
 * ------------------------------------------------------------------ */

test("with no ROOT_KEY_SECRET the provider is the environment", () => {
  assert.equal(rootKeyProvider(), "environment");
});

test("the env root key comes from ENCRYPTION_KEY and tracks a change to it", async () => {
  assert.equal((await rootKey(ENV_KEY_VERSION)).toString("base64"), KEY_A);
  process.env.ENCRYPTION_KEY = KEY_B;
  try {
    // The cache is keyed on the encoded text, not on the label — so an operator who does
    // change the variable in a long-lived process sees the new value.
    assert.equal((await rootKey(ENV_KEY_VERSION)).toString("base64"), KEY_B);
  } finally {
    process.env.ENCRYPTION_KEY = KEY_A;
  }
});

test("a missing ENCRYPTION_KEY is a legible failure, not a crypto stack trace", async () => {
  const saved = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  try {
    await assert.rejects(() => rootKey(ENV_KEY_VERSION), RootKeyError);
    await assert.rejects(() => rootKey(ENV_KEY_VERSION), /ENCRYPTION_KEY/);
  } finally {
    process.env.ENCRYPTION_KEY = saved;
  }
});

test("an unknown version label is refused rather than guessed at", async () => {
  await assert.rejects(() => rootKey("kms:4"), RootKeyError);
  await assert.rejects(() => rootKey("sm:not-a-number"), /Unknown root key version/);
});

test("Secret Manager version labels round-trip", () => {
  assert.equal(secretManagerVersion("7"), "sm:7");
  assert.equal(secretManagerVersionNumber("sm:7"), "7");
  assert.equal(secretManagerVersionNumber(ENV_KEY_VERSION), null);
  assert.equal(secretManagerVersionNumber("sm:latest"), null);
});

test("a version number is parsed out of a Secret Manager resource name", () => {
  // Getting this wrong writes a credential nothing can ever unwrap, so it is asserted
  // directly rather than trusted to a regex read once.
  assert.equal(
    versionFromName("projects/733000675212/secrets/agentforge-root-key/versions/3"),
    "3",
  );
  assert.equal(versionFromName("projects/p/secrets/s/versions/latest"), null);
  assert.equal(versionFromName("projects/p/secrets/s"), null);
});

/* ------------------------------------------------------------------ *
 * envelope.ts — the two-layer scheme
 * ------------------------------------------------------------------ */

test("a secret survives a seal/open round trip through the envelope", async () => {
  const envelope = await sealSecret(SECRET);
  assert.equal(await openSecret(envelope), SECRET);
  assert.equal(envelope.keyVersion, ENV_KEY_VERSION);
  assert.equal(isLegacyEnvelope(envelope), false);
});

test("the ciphertext does not contain the plaintext, in any encoding", async () => {
  const envelope = await sealSecret(SECRET);
  assert.equal(JSON.stringify(envelope).includes(SECRET), false);
  for (const encoding of ["utf8", "latin1", "ascii"] as const) {
    assert.equal(
      Buffer.from(envelope.ciphertext, "base64").toString(encoding).includes(SECRET),
      false,
    );
  }
});

test("every write gets a fresh data key, so a rotation shares nothing with what it replaced", async () => {
  const first = await sealSecret(SECRET);
  const second = await sealSecret(SECRET);
  // Different wrapped keys means different DEKs: the same secret under two independent
  // keys. This is most of what "rotating in place" is supposed to buy.
  assert.notEqual(first.wrappedKey, second.wrappedKey);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(await openSecret(first), await openSecret(second));
});

test("a tampered wrapped key is refused with a message naming the version", async () => {
  const envelope = await sealSecret(SECRET);
  const wrapped = Buffer.from(envelope.wrappedKey!, "base64");
  wrapped[0] ^= 0xff;
  await assert.rejects(
    () => openSecret({ ...envelope, wrappedKey: wrapped.toString("base64") }),
    /does not unwrap under root key version env/,
  );
});

test("a partial envelope is refused rather than half-read", async () => {
  const envelope = await sealSecret(SECRET);
  await assert.rejects(
    () => openSecret({ ...envelope, wrapIv: null }),
    EnvelopeError,
  );
});

test("an empty secret is refused rather than stored as a valid credential", async () => {
  await assert.rejects(() => sealSecret(""), /empty secret/);
});

/* ------------------------------------------------------------------ *
 * The legacy shape — what made migration 0009 safe
 * ------------------------------------------------------------------ */

/** A Chapter 1 row: the secret straight under ENCRYPTION_KEY, no data key. */
function legacyEnvelope(secret: string, encodedKey: string): Envelope {
  const sealed = seal(decodeKey(encodedKey, "TEST"), secret);
  return { ...sealed, wrappedKey: null, wrapIv: null, wrapAuthTag: null, keyVersion: null };
}

test("a Chapter 1 row still decrypts, which is what let the migration be additive", async () => {
  const legacy = legacyEnvelope(SECRET, KEY_A);
  assert.equal(isLegacyEnvelope(legacy), true);
  assert.equal(await openSecret(legacy), SECRET);
});

test("a Chapter 1 row under a different key says so, and names the reason", async () => {
  const legacy = legacyEnvelope(SECRET, KEY_B);
  await assert.rejects(() => openSecret(legacy), /stored under a different one/);
});

/* ------------------------------------------------------------------ *
 * rewrap — the payoff
 * ------------------------------------------------------------------ */

test("re-wrapping to a new root key leaves the ciphertext byte-identical", async () => {
  // The real first rotation: a row sealed under the environment root key, moved to a
  // Secret Manager version. The *source* version has to be one this process can resolve,
  // which is why it is `env` here and not a second `sm:` label — resolving that would need
  // Secret Manager, and a crypto test that needs a network is a crypto test nobody runs.
  const before = sealSecretWith(SECRET, ENV_KEY_VERSION, decodeKey(KEY_A, "TEST"));
  const { envelope: after, changed } = await rewrap(before, {
    version: "sm:2",
    key: decodeKey(KEY_B, "TEST"),
  });

  assert.equal(changed, true);
  // The whole point of envelope encryption: the secret is not decrypted, not rewritten,
  // and not even in scope. Only the 32-byte data key moves.
  assert.equal(after.ciphertext, before.ciphertext);
  assert.equal(after.iv, before.iv);
  assert.equal(after.authTag, before.authTag);
  assert.notEqual(after.wrappedKey, before.wrappedKey);
  assert.equal(after.keyVersion, "sm:2");
});

test("re-wrapping to the version a row already names changes nothing", async () => {
  const before = sealSecretWith(SECRET, "sm:1", decodeKey(KEY_A, "TEST"));
  // No root key is resolved at all on this path, which is what makes a repeated re-key free
  // — and, on Secret Manager, what keeps it inside 10,000 access operations a month.
  const { envelope: after, changed } = await rewrap(before, {
    version: "sm:1",
    key: decodeKey(KEY_A, "TEST"),
  });
  assert.equal(changed, false);
  assert.deepEqual(after, before);
});

test("re-wrapping a Chapter 1 row converts it, and the secret still reads back", async () => {
  const legacy = legacyEnvelope(SECRET, KEY_A);
  const { envelope: converted, changed } = await rewrap(legacy, {
    version: ENV_KEY_VERSION,
    key: decodeKey(KEY_A, "TEST"),
  });

  assert.equal(changed, true);
  assert.equal(isLegacyEnvelope(converted), false);
  assert.equal(converted.keyVersion, ENV_KEY_VERSION);
  assert.equal(await openSecret(converted), SECRET);
});

test("the reverse conversion exists, which is what makes a rollback past Phase 21 survivable", async () => {
  const enveloped = await sealSecret(SECRET);
  const { envelope: back, changed } = await rewrap(enveloped, {
    version: ENV_KEY_VERSION,
    key: decodeKey(KEY_A, "TEST"),
    legacy: true,
  });

  assert.equal(changed, true);
  assert.equal(isLegacyEnvelope(back), true);
  assert.equal(back.keyVersion, null);
  // A pre-Phase-21 revision decrypts exactly this shape with exactly this key.
  assert.equal(open(decodeKey(KEY_A, "TEST"), back).toString("utf8"), SECRET);
});

test("re-wrapping a Chapter 1 row to legacy is a no-op rather than a re-encryption", async () => {
  const legacy = legacyEnvelope(SECRET, KEY_A);
  const { changed } = await rewrap(legacy, {
    version: ENV_KEY_VERSION,
    key: decodeKey(KEY_A, "TEST"),
    legacy: true,
  });
  assert.equal(changed, false);
});

test("a row wrapped under a version that cannot be resolved fails as a key problem", async () => {
  // The distinction the caller has to be able to make: this is an outage or a missing IAM
  // grant, and the data is fine. Collapsing it into "could not decrypt" would send an
  // operator to inspect data that was never wrong.
  const orphan = sealSecretWith(SECRET, "sm:9", decodeKey(KEY_A, "TEST"));
  await assert.rejects(() => openSecret(orphan), RootKeyError);
});

/* ------------------------------------------------------------------ *
 * Which key a new secret is sealed under
 * ------------------------------------------------------------------ */

test("with no secret store, new secrets are sealed under the environment key", async () => {
  const { version, key } = await currentRootKey();
  assert.equal(version, ENV_KEY_VERSION);
  assert.equal(key.toString("base64"), KEY_A);
});

test("with a secret store named but unreachable, sealing refuses rather than falling back", async () => {
  /**
   * **The most important negative in this file.** A silent fallback to `ENCRYPTION_KEY` when
   * Secret Manager is unreachable would seal new credentials under a key the operator believes
   * is no longer in use — so a later root key rotation would leave rows behind, labelled `env`,
   * that nobody knew existed. Refusing is the only safe answer: the write fails, the user sees
   * an error, and nothing is stored under the wrong key.
   */
  clearSecretCache();
  process.env.ROOT_KEY_SECRET = "agentforge-root-key";
  const savedProject = process.env.GCP_PROJECT;
  delete process.env.GCP_PROJECT;
  try {
    assert.equal(rootKeyProvider(), "secret-manager");
    await assert.rejects(() => currentRootKey(), RootKeyError);
    await assert.rejects(() => sealSecret(SECRET), /ROOT_KEY_SECRET/);
  } finally {
    delete process.env.ROOT_KEY_SECRET;
    if (savedProject) process.env.GCP_PROJECT = savedProject;
    clearSecretCache();
  }
});

test("a tampered ciphertext on an enveloped row names the version, not the cipher", async () => {
  // The two failures a caller must tell apart: the key could not be reached (fixable, data is
  // fine) and this row does not decrypt under the key it names (corruption, or an unfinished
  // re-key). A single "could not decrypt" sends an operator to inspect data that was never
  // wrong.
  const envelope = await sealSecret(SECRET);
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 0xff;
  await assert.rejects(
    () => openSecret({ ...envelope, ciphertext: bytes.toString("base64") }),
    (error: unknown) => {
      assert.ok(error instanceof EnvelopeError);
      assert.match(error.message, /does not decrypt under root key version env/);
      return true;
    },
  );
});
