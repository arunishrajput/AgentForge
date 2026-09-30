import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM, and nothing else — **the pure half of `lib/crypto`.**
 *
 * No environment, no database, no network, no notion of what a "root key" is. That is
 * the point: the properties worth asserting about a cipher — a round trip returns the
 * input, a flipped bit in the ciphertext is *detected*, the wrong key fails rather than
 * returning rubbish — are asserted here in a millisecond with nothing mocked.
 *
 * **GCM rather than CBC because it authenticates.** A credential row edited in the
 * database, by a mistake or by somebody with a `psql` prompt, fails to decrypt instead of
 * yielding plausible bytes that then get sent to a provider as an API key. The Chapter 1
 * module made this choice and it was right; Phase 21 kept it and moved it.
 */

const ALGORITHM = "aes-256-gcm";

export const IV_BYTES = 12;
export const KEY_BYTES = 32;

/** One AES-GCM ciphertext, base64 throughout so it can live in three `text` columns. */
export interface Sealed {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypt with a caller-supplied key.
 *
 * **The IV is generated here rather than being a parameter.** Reusing an IV under GCM
 * with the same key is a key-recovery break, not a theoretical weakness — so there is no
 * signature by which a caller could supply one, correctly or otherwise.
 */
export function seal(key: Buffer, plaintext: Buffer | string): Sealed {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const input = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decrypt, or throw. A tampered ciphertext or the wrong key both land here. */
export function open(key: Buffer, sealed: Sealed): Buffer {
  assertKey(key);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
}

/** A fresh 256-bit data key. One per credential write — see `envelope.ts`. */
export function generateDataKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * Decode a base64 key and prove its length, **reporting the length and never the value**.
 *
 * Its own function because the message is the whole value of it: a 24-byte key produces
 * `Invalid key length` from OpenSSL, which tells an operator nothing about which of their
 * keys is wrong or what to do about it.
 */
export function decodeKey(encoded: string, label: string): Buffer {
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `${label} must decode to ${KEY_BYTES} bytes; got ${decoded.length}. ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return decoded;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`An AES-256 key must be ${KEY_BYTES} bytes; got ${key.length}.`);
  }
}
