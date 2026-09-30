import { decodeKey, generateDataKey, open, seal, type Sealed } from "./aes";
import { currentRootKey, ENV_KEY_VERSION, type KeyVersion, rootKey } from "./root-key";

/**
 * **Envelope encryption — the point of Phase 21.**
 *
 * Chapter 1 encrypted every secret directly under `ENCRYPTION_KEY`, and wrote the honest
 * warning that followed from it: *rotating this destroys all stored credentials.* That is
 * true of any scheme where the key an operator can rotate is the key the data is under.
 * The fix is one layer of indirection:
 *
 * ```
 *   secret  --AES-256-GCM-->  ciphertext          key: a fresh 256-bit DEK, per credential
 *   DEK     --AES-256-GCM-->  wrappedKey          key: the root key, versioned
 * ```
 *
 * Seven columns on the row: `ciphertext`/`iv`/`authTag` for the secret, `wrappedKey`/
 * `wrapIv`/`wrapAuthTag` for the data key, and `keyVersion` naming the root key that
 * wrapped it. **Rotating the root key rewrites 60 bytes per credential and never touches
 * the ciphertext** — which is why `rewrap` below exists and why it cannot corrupt a
 * secret even if it fails halfway: the plaintext it would have to get wrong is never in
 * scope.
 *
 * **A fresh DEK per write, always.** Two credentials never share a data key, and neither
 * do a credential and its own previous value — so rotating a secret in place leaves no key
 * material in common with what it replaced, which is most of what "rotation" is supposed
 * to buy. It costs 32 bytes of CSPRNG per write.
 *
 * ### The legacy shape, and why it stays
 *
 * A row with `wrappedKey = null` is a **Chapter 1 row**: its ciphertext is directly under
 * `ENCRYPTION_KEY`, with no DEK. `openEnvelope` reads both shapes, and that is not
 * politeness towards old data — it is what let migration `0009` be purely additive, so
 * the previous revision kept serving while it was applied and the deployed database was
 * never in a state neither revision could read.
 *
 * `rewrap` converts a legacy row into an enveloped one, which is the migration. **The
 * reverse also exists** (`rewrap` to `env` with `legacy: true`), because the alternative
 * is a one-way door: once the deployed rows are enveloped, rolling Cloud Run back to a
 * revision that predates this file would make every credential unreadable. A rollback you
 * cannot perform is not a rollback, so the reverse is implemented and rehearsed rather
 * than described.
 */

/** The seven columns, as they sit on a `credential` row. */
export interface Envelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedKey: string | null;
  wrapIv: string | null;
  wrapAuthTag: string | null;
  keyVersion: string | null;
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

/**
 * Whether a row is still in the Chapter 1 shape. Exported because the vault reports it:
 * "3 of 4 credentials are enveloped" is the only way an operator can tell a re-key
 * actually did something.
 */
export function isLegacyEnvelope(envelope: Pick<Envelope, "wrappedKey">): boolean {
  return envelope.wrappedKey === null;
}

/** Encrypt a secret under a fresh data key, wrapped by the current root key. */
export async function sealSecret(plaintext: string): Promise<Envelope> {
  if (plaintext.length === 0) throw new EnvelopeError("Refusing to encrypt an empty secret.");

  const { version, key } = await currentRootKey();
  return sealSecretWith(plaintext, version, key);
}

/**
 * The same, under a root key the caller has already resolved.
 *
 * Exists for the re-key loop, which seals hundreds of rows under one version and must not
 * resolve it hundreds of times — on Secret Manager that would be one access operation per
 * credential against a free tier of 10,000 a month.
 */
export function sealSecretWith(plaintext: string, version: KeyVersion, key: Buffer): Envelope {
  if (plaintext.length === 0) throw new EnvelopeError("Refusing to encrypt an empty secret.");

  const dataKey = generateDataKey();
  const body = seal(dataKey, plaintext);
  const wrapped = seal(key, dataKey);

  // The DEK is not kept beyond this function. Zeroing it is not a real defence in a
  // garbage-collected runtime — `seal` has already copied it into OpenSSL — but it does
  // mean a heap snapshot taken later is one buffer less likely to hold it.
  dataKey.fill(0);

  return {
    ciphertext: body.ciphertext,
    iv: body.iv,
    authTag: body.authTag,
    wrappedKey: wrapped.ciphertext,
    wrapIv: wrapped.iv,
    wrapAuthTag: wrapped.authTag,
    keyVersion: version,
  };
}

/**
 * Decrypt, whichever shape the row is in.
 *
 * A failure here is deliberately **not** collapsed into one message. `RootKeyError` means
 * the key could not be reached — an outage, a missing IAM grant, a wrong
 * `ROOT_KEY_SECRET` — and the data is fine. Anything else means the row does not decrypt
 * under the key it names, which is corruption or a re-key that was not finished. An
 * operator needs to know which, and a single "could not decrypt" would send them to
 * inspect data that was never wrong.
 */
export async function openSecret(envelope: Envelope): Promise<string> {
  const body: Sealed = {
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    authTag: envelope.authTag,
  };

  if (isLegacyEnvelope(envelope)) return openLegacy(body);

  const key = await rootKey(envelope.keyVersion ?? ENV_KEY_VERSION);
  const dataKey = unwrap(envelope, key);
  try {
    return open(dataKey, body).toString("utf8");
  } catch {
    throw new EnvelopeError(
      `This secret does not decrypt under root key version ${envelope.keyVersion}. ` +
        `The row may have been edited, or a re-key may not have completed.`,
    );
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Move a row to a different root key **without decrypting the secret**.
 *
 * This is the whole payoff. For an enveloped row the ciphertext is not read, not
 * rewritten and not even in scope — only the 32-byte data key is unwrapped and wrapped
 * again, so a re-key cannot damage a secret, cannot leak one into a log, and costs the
 * same whether the secret is a 40-character API key or a 2 KB refresh token.
 *
 * A **legacy** row is the one case that must decrypt: it has no data key to re-wrap, so
 * one is generated and the secret is sealed under it. That is a conversion rather than a
 * re-wrap, and it is the only path in this file that ever holds a plaintext it did not
 * receive as an argument.
 *
 * `legacy: true` goes the other way — back to a single-layer Chapter 1 row under
 * `ENCRYPTION_KEY` — which is what makes rolling the deployment back to a pre-Phase-21
 * revision survivable.
 */
export async function rewrap(
  envelope: Envelope,
  target: { version: KeyVersion; key: Buffer; legacy?: boolean },
): Promise<{ envelope: Envelope; changed: boolean }> {
  if (target.legacy) {
    if (isLegacyEnvelope(envelope)) return { envelope, changed: false };
    const plaintext = await openSecret(envelope);
    const body = seal(target.key, plaintext);
    return {
      envelope: {
        ciphertext: body.ciphertext,
        iv: body.iv,
        authTag: body.authTag,
        wrappedKey: null,
        wrapIv: null,
        wrapAuthTag: null,
        keyVersion: null,
      },
      changed: true,
    };
  }

  if (isLegacyEnvelope(envelope)) {
    const plaintext = openLegacy({
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
    });
    return { envelope: sealSecretWith(plaintext, target.version, target.key), changed: true };
  }

  if (envelope.keyVersion === target.version) return { envelope, changed: false };

  const previous = await rootKey(envelope.keyVersion ?? ENV_KEY_VERSION);
  const dataKey = unwrap(envelope, previous);
  try {
    const wrapped = seal(target.key, dataKey);
    return {
      envelope: {
        // Untouched, and that is the property the whole design is for.
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
        authTag: envelope.authTag,
        wrappedKey: wrapped.ciphertext,
        wrapIv: wrapped.iv,
        wrapAuthTag: wrapped.authTag,
        keyVersion: target.version,
      },
      changed: true,
    };
  } finally {
    dataKey.fill(0);
  }
}

function unwrap(envelope: Envelope, key: Buffer): Buffer {
  if (!envelope.wrappedKey || !envelope.wrapIv || !envelope.wrapAuthTag) {
    throw new EnvelopeError("This credential has a partial envelope and cannot be opened.");
  }
  try {
    return decodeKey(
      open(key, {
        ciphertext: envelope.wrappedKey,
        iv: envelope.wrapIv,
        authTag: envelope.wrapAuthTag,
      }).toString("base64"),
      `The data key of a credential wrapped under ${envelope.keyVersion}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("must decode to")) throw error;
    throw new EnvelopeError(
      `The data key does not unwrap under root key version ${envelope.keyVersion}. ` +
        `Either that is the wrong version for this row, or the wrapped key has been altered.`,
    );
  }
}

/** A Chapter 1 row: the secret straight under `ENCRYPTION_KEY`, no data key. */
function openLegacy(body: Sealed): string {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) {
    throw new EnvelopeError(
      "This credential predates envelope encryption and ENCRYPTION_KEY is not set, " +
        "so it cannot be read. See SECURITY.md → Re-keying.",
    );
  }
  try {
    return open(decodeKey(encoded, "ENCRYPTION_KEY"), body).toString("utf8");
  } catch (error) {
    if (error instanceof Error && error.message.includes("must decode to")) throw error;
    throw new EnvelopeError(
      "This credential predates envelope encryption and does not decrypt under the current " +
        "ENCRYPTION_KEY. It was stored under a different one. See SECURITY.md → Re-keying.",
    );
  }
}
