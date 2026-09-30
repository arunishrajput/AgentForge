import { readRootKeyVersion, rootKeySecretName } from "@/lib/gcp/secret-manager";

import { decodeKey } from "./aes";

/**
 * The root key, and **which version of it** — Phase 21.
 *
 * A root key wraps per-credential data keys and never touches a user's secret directly
 * (`envelope.ts`). That indirection is the entire reason this file can talk about
 * *versions* at all: rotating the root key re-wraps a few hundred bytes per credential
 * instead of re-encrypting every secret in the database, so it is an operation somebody
 * will actually perform rather than one the docs warn you never to attempt.
 *
 * **Two providers, and the fallback is not a degraded mode — it is how this runs
 * locally.**
 *
 *   `env`   `ENCRYPTION_KEY`, the Chapter 1 key. Used when `ROOT_KEY_SECRET` is unset,
 *           which is a developer machine, CI, and any deployment that has not been given
 *           a Secret Manager secret. There is exactly one version of it, called `env`,
 *           because an environment variable has no versions — changing it *is* the
 *           rotation, and the re-key path is what makes that survivable
 *   `sm:N`  version N of the Secret Manager secret named by `ROOT_KEY_SECRET`. Plural
 *           versions, added without a deploy, and a credential row records which one
 *           wrapped it
 *
 * **A version label is written onto every credential row and must never be reinterpreted.**
 * `env` means "the bytes in `ENCRYPTION_KEY` right now" — so an operator who changes that
 * variable without re-keying first has made every `env`-labelled row unreadable, which is
 * precisely the Chapter 1 hazard this phase exists to remove. `sm:N` cannot suffer that:
 * N names immutable bytes.
 */

export const ENV_KEY_VERSION = "env";

const SM_PREFIX = "sm:";

/** A version label as it is stored on a credential row. */
export type KeyVersion = string;

export function isSecretManagerVersion(version: KeyVersion): boolean {
  return version.startsWith(SM_PREFIX);
}

export function secretManagerVersionNumber(version: KeyVersion): string | null {
  if (!isSecretManagerVersion(version)) return null;
  const number = version.slice(SM_PREFIX.length);
  return /^\d+$/.test(number) ? number : null;
}

export function secretManagerVersion(number: string): KeyVersion {
  return `${SM_PREFIX}${number}`;
}

/**
 * Thrown when a root key cannot be reached. Its own class because the caller has to tell
 * it apart from "this ciphertext is corrupt": one is an outage or a missing IAM grant and
 * is fixable without touching data, the other is not.
 */
export class RootKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootKeyError";
  }
}

const envCache = new Map<string, Buffer>();

/**
 * The key bytes for a version label. Throws `RootKeyError` if they cannot be had.
 *
 * `env` is decoded from the environment every call and memoised on its own string, so an
 * operator who *does* change `ENCRYPTION_KEY` in a long-lived process sees the new value
 * rather than a cached one — the cache is keyed on the encoded text, not on the label.
 */
export async function rootKey(version: KeyVersion): Promise<Buffer> {
  if (version === ENV_KEY_VERSION) return envRootKey();

  const number = secretManagerVersionNumber(version);
  if (!number) throw new RootKeyError(`Unknown root key version “${version}”.`);

  const result = await readRootKeyVersion(number);
  if (!result.ok) throw rootKeyFailure(result.reason, version, failureDetail(result));
  return decodeKey(result.value, `Root key version ${version}`);
}

/**
 * The version new secrets are sealed under, and its key.
 *
 * Returns both, because resolving `latest` is what tells us the version number and
 * throwing it away would mean a second access operation to learn what we just read.
 */
export async function currentRootKey(): Promise<{ version: KeyVersion; key: Buffer }> {
  if (!rootKeySecretName()) return { version: ENV_KEY_VERSION, key: envRootKey() };

  const result = await readRootKeyVersion("latest");
  if (!result.ok) throw rootKeyFailure(result.reason, "latest", failureDetail(result));

  return {
    version: secretManagerVersion(result.version),
    key: decodeKey(result.value, `Root key version ${result.version}`),
  };
}

/**
 * Whether this deployment has a versioned root key at all. Surfaced by `/api/health` and
 * by the vault, because the alternative is a product that silently runs on the
 * environment key and reports a re-key as a success that changed nothing.
 */
export function rootKeyProvider(): "secret-manager" | "environment" {
  return rootKeySecretName() ? "secret-manager" : "environment";
}

/** Only `rejected` carries a detail, and narrowing it here keeps the message builder total. */
function failureDetail(result: { reason: string; detail?: string }): { detail?: string } {
  return result.detail === undefined ? {} : { detail: result.detail };
}

function envRootKey(): Buffer {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) {
    throw new RootKeyError(
      "Missing ENCRYPTION_KEY, which is this deployment's root key. See CONTRACT.md.",
    );
  }
  const hit = envCache.get(encoded);
  if (hit) return hit;

  const key = decodeKey(encoded, "ENCRYPTION_KEY");
  envCache.set(encoded, key);
  return key;
}

/**
 * One message per reason, and each one says what to do. A root key failure reaches a user
 * as "this credential could not be read", so the operator's half has to be in the log.
 */
function rootKeyFailure(
  reason: "unconfigured" | "unauthenticated" | "rejected",
  version: string,
  result: { detail?: string | undefined },
): RootKeyError {
  if (reason === "unconfigured") {
    return new RootKeyError(
      `ROOT_KEY_SECRET names no reachable secret, so root key version ${version} cannot be read. ` +
        `Set it to the Secret Manager secret holding the root key, or unset it to use ENCRYPTION_KEY.`,
    );
  }
  if (reason === "unauthenticated") {
    return new RootKeyError(
      `No service-account token is available, so root key version ${version} cannot be read. ` +
        `This is expected off Cloud Run; on it, check the metadata server.`,
    );
  }
  return new RootKeyError(
    `Secret Manager refused root key version ${version}. ` +
      `Check roles/secretmanager.secretAccessor on the service account. ${result.detail ?? ""}`.trim(),
  );
}
