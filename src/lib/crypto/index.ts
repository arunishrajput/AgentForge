/**
 * Secrets at rest — CONTRACT.md → *Credential storage shape*.
 *
 * **Phase 21 replaced the single `lib/crypto.ts` with this directory**, and the split is
 * along the line that decides what can be tested:
 *
 *   `aes.ts`        AES-256-GCM and nothing else. No environment, no network. The
 *                   cipher's properties are asserted here in a millisecond
 *   `root-key.ts`   which key, and which *version* of it — Secret Manager, or
 *                   `ENCRYPTION_KEY` when there is no Secret Manager
 *   `envelope.ts`   the two-layer scheme: a per-credential data key under a versioned
 *                   root key, so the root can rotate without re-encrypting anything
 *   `rekey.ts`      the loop that moves the database from one root key version to another
 *
 * `@/lib/crypto` still resolves, so every Chapter 1 import kept working through the move.
 *
 * **What Chapter 1 had, and what changed.** One key, `ENCRYPTION_KEY`, encrypting every
 * secret directly, with the accurate warning that rotating it destroyed all of them.
 * Everything that key protected is still protected the same way; what is new is that the
 * key an operator rotates is no longer the key the data is under.
 */

export {
  generateDataKey,
  IV_BYTES,
  KEY_BYTES,
  decodeKey,
  open,
  seal,
  type Sealed,
} from "./aes";

export {
  type Envelope,
  EnvelopeError,
  isLegacyEnvelope,
  openSecret,
  rewrap,
  sealSecret,
  sealSecretWith,
} from "./envelope";

export {
  currentRootKey,
  ENV_KEY_VERSION,
  type KeyVersion,
  rootKey,
  RootKeyError,
  rootKeyProvider,
  secretManagerVersion,
  secretManagerVersionNumber,
} from "./root-key";
