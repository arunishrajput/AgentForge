/**
 * The instance's own identity — Cloud Run's metadata server, reached with `fetch`.
 *
 * **Extracted from `lib/engine/queue.ts` in Phase 21, not written fresh.** Phase 17 put
 * this here-but-inline for Cloud Tasks; Phase 21 needs the same access token for Secret
 * Manager, and two token caches on one instance is two things that can disagree about
 * whether the token has expired. One cache, one refresh, two callers.
 *
 * **No client library, still deliberately.** `google-auth-library` exists to find a
 * credential across a dozen environments; there is exactly one environment here, and on
 * it the credential is an HTTP GET away with no key material anywhere on disk.
 *
 * **Absent is a supported state, not an error.** There is no metadata server on a
 * developer machine and none in CI, so every function here answers `null` rather than
 * throwing, and every caller has a defined behaviour for `null`. That is what keeps the
 * test runner and `npm run dev` working with no cloud at all.
 */

const METADATA_ROOT = "http://metadata.google.internal/computeMetadata/v1";

/** Bounds every call so a slow metadata server cannot hold a user's request. */
const METADATA_TIMEOUT_MS = 3_000;

export async function metadata(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${METADATA_ROOT}/${path}`, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.text()).trim();
  } catch {
    // No metadata server: a developer machine, or CI. Not an error here.
    return null;
  }
}

/**
 * The project this container runs in.
 *
 * **Read from the metadata server rather than from an environment variable**, which is
 * the Phase 17 decision (D82's sibling) carried forward: a copied variable can name the
 * wrong project and the failure is a 403 three layers down, whereas this cannot be wrong.
 * `GCP_PROJECT` overrides it only so a local script can be pointed somewhere.
 */
export async function projectId(): Promise<string | null> {
  return process.env.GCP_PROJECT ?? (await metadata("project/project-id"));
}

/**
 * An access token for the instance's service account, cached for its lifetime.
 *
 * Cached because a token lasts an hour, so a cold start per instance is the only time
 * this should cost a request. Refreshed a minute early, so a token is never used in the
 * seconds around its expiry — the failure that would produce is a 401 on a request the
 * user made, which is the least debuggable shape of this bug.
 */
let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(): Promise<string | null> {
  /**
   * **The operator path, and the only reason this branch exists.** There is no metadata
   * server on a developer machine, so `scripts/rekey.mjs` could not reach Secret Manager at
   * all without it — and re-keying the whole database is an operator action by definition
   * (`lib/credentials/rekey.ts`), so "it only works on Cloud Run" would mean the root key
   * could never actually be rotated.
   *
   * The operator supplies their own short-lived token:
   *
   *     GCP_ACCESS_TOKEN=$(gcloud auth print-access-token) GCP_PROJECT=… node … scripts/rekey.mjs
   *
   * Read fresh every call rather than cached, because the caller may replace an expired one
   * mid-run, and **never set on the service** — Cloud Run has the metadata server, and an
   * access token pasted into an environment variable is a long-lived credential in a place
   * that survives restarts. It is deliberately not in the `CONTRACT.md` runtime table for
   * that reason: it is a script's input, not the application's configuration.
   */
  const supplied = process.env.GCP_ACCESS_TOKEN?.trim();
  if (supplied) return supplied;

  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const raw = await metadata("instance/service-accounts/default/token");
  if (!raw) return null;

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed.access_token) return null;

  cached = {
    token: parsed.access_token,
    expiresAt: Date.now() + Math.max(((parsed.expires_in ?? 3600) - 60) * 1000, 0),
  };
  return cached.token;
}

/** Only for tests and for a deliberate refresh; the cache is per instance otherwise. */
export function clearTokenCache(): void {
  cached = null;
}
