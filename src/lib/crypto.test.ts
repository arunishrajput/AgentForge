import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { decryptSecret, encryptSecret } from "./crypto";

// The suite owns the key: `npm test` does not load `.env`, and a credential test must
// never depend on a real one.
const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
process.env.ENCRYPTION_KEY = KEY_A;

const SECRET = "AIzaSyExampleLookingKeyNotReal_0123456789";

test("a secret survives a round trip unchanged", () => {
  const envelope = encryptSecret(SECRET);
  assert.equal(decryptSecret(envelope), SECRET);
});

test("the ciphertext does not contain the plaintext, in any encoding", () => {
  const envelope = encryptSecret(SECRET);
  const serialised = JSON.stringify(envelope);
  assert.equal(serialised.includes(SECRET), false);
  assert.equal(Buffer.from(envelope.ciphertext, "base64").toString("utf8").includes(SECRET), false);
  assert.equal(Buffer.from(envelope.ciphertext, "base64").toString("latin1").includes(SECRET), false);
});

test("encrypting the same secret twice gives different ciphertext", () => {
  // A fresh IV per call. Identical ciphertext would leak that two users pasted the
  // same key, and IV reuse under GCM is a key-recovery break.
  const first = encryptSecret(SECRET);
  const second = encryptSecret(SECRET);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(decryptSecret(first), decryptSecret(second));
});

test("a tampered ciphertext is refused, not silently mangled", () => {
  const envelope = encryptSecret(SECRET);
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 0xff;
  assert.throws(() =>
    decryptSecret({ ...envelope, ciphertext: bytes.toString("base64") }),
  );
});

test("a tampered auth tag is refused", () => {
  const envelope = encryptSecret(SECRET);
  const tag = Buffer.from(envelope.authTag, "base64");
  tag[0] ^= 0xff;
  assert.throws(() => decryptSecret({ ...envelope, authTag: tag.toString("base64") }));
});

test("a different key cannot read the envelope", () => {
  // Documents the cost of rotating ENCRYPTION_KEY: every stored credential dies.
  const envelope = encryptSecret(SECRET);
  process.env.ENCRYPTION_KEY = KEY_B;
  try {
    assert.throws(() => decryptSecret(envelope));
  } finally {
    process.env.ENCRYPTION_KEY = KEY_A;
  }
});

test("a key of the wrong length fails with the length, never the value", () => {
  process.env.ENCRYPTION_KEY = Buffer.from("too short").toString("base64");
  try {
    assert.throws(() => encryptSecret(SECRET), (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, /must decode to 32 bytes/);
      assert.equal(message.includes("too short"), false);
      return true;
    });
  } finally {
    process.env.ENCRYPTION_KEY = KEY_A;
  }
});

test("an empty secret is refused rather than stored as a valid credential", () => {
  assert.throws(() => encryptSecret(""), /empty secret/);
});

test("a missing key is a legible failure, not a crypto stack trace", () => {
  const saved = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptSecret(SECRET), /ENCRYPTION_KEY/);
  } finally {
    process.env.ENCRYPTION_KEY = saved;
  }
});
