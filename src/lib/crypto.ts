import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { required } from "./env";

/**
 * AES-256-GCM for secrets at rest — CONTRACT.md → "Credential storage shape".
 *
 * The envelope is three base64 columns on the `credential` row (`ciphertext`, `iv`,
 * `authTag`) and the key is `ENCRYPTION_KEY`. GCM rather than CBC because it
 * authenticates: a row edited in the database fails to decrypt instead of returning
 * plausible rubbish that then gets sent to a provider as an API key.
 *
 * Deliberately separate from `credentials.ts`: this module touches no database, so
 * the round-trip property is asserted in a millisecond with no network.
 *
 * **Rotating `ENCRYPTION_KEY` makes every stored credential unreadable.** There is no
 * key-version column and no re-encryption path; that is post-hackathon (no KMS —
 * ARCHITECTURE.md).
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface SecretEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function key(): Buffer {
  const decoded = Buffer.from(required("ENCRYPTION_KEY"), "base64");
  if (decoded.length !== KEY_BYTES) {
    // Fails loudly with the length and never with the value.
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${decoded.length}. ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return decoded;
}

export function encryptSecret(plaintext: string): SecretEnvelope {
  if (plaintext.length === 0) throw new Error("Refusing to encrypt an empty secret.");

  // A fresh IV per encryption. Reusing one under GCM is a key-recovery break, so it
  // is generated here rather than being a parameter a caller could get wrong.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(envelope: SecretEnvelope): string {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
