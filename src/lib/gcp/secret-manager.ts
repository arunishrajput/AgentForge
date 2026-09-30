import { accessToken, projectId } from "./metadata";

/**
 * Secret Manager, reached over its REST API with `fetch` — **Phase 21**.
 *
 * It holds one thing: the **root key** that wraps every credential's data key
 * (`lib/crypto/envelope.ts`). Nothing else belongs here, and in particular no user's
 * secret does: a stored credential lives in Postgres because it is per-workspace data
 * with a lifecycle the product manages, and Secret Manager's free tier is **six active
 * versions** — a per-credential secret would leave the free tier on the seventh
 * credential in the product's life.
 *
 * **Secret Manager and not Cloud KMS**, which is the textbook answer for envelope
 * encryption and is *not free*: a KMS key ring costs ~$0.06 per key per month plus
 * operations, and the zero-cost ceiling binds (`CLAUDE.md` → *Cost rules*). What KMS
 * would buy is that the root key never leaves Google's HSM; what we get instead is a
 * root key that this process holds in memory for the life of the instance. That is a
 * real difference and `SECURITY.md` states it rather than hiding it.
 *
 * **Two calls, and only one of them is on a hot path:**
 *
 *   `latest`      resolves to the newest *enabled* version, and the response names which
 *                 one it was — so sealing needs no separate `versions.list`, which is the
 *                 whole reason this file has no list function
 *   `versions/N`  a specific version, for opening a DEK wrapped under an older root key
 *
 * **A version's bytes are immutable**, which is what a version *is*, so they are cached
 * for the life of the instance and the cache can never be stale. `latest` is cached for
 * a short window instead, because what it resolves *to* changes the moment somebody adds
 * a version — that window is how long a rotation takes to reach a warm instance.
 *
 * The free tier is 10,000 access operations a month. With this caching a warm instance
 * spends **one per root key version it has ever needed**, plus one per `LATEST_TTL_MS`
 * while it is actually sealing. `DEPLOYMENT.md` → *Secret Manager* has the arithmetic.
 */

const API = "https://secretmanager.googleapis.com/v1";
const TIMEOUT_MS = 10_000;

/** How long a resolved `latest` is trusted. The lag between a rotation and a warm instance. */
const LATEST_TTL_MS = 5 * 60 * 1000;

/**
 * Which secret holds the root key. **Optional**: unset means this deployment has no
 * Secret Manager and `ENCRYPTION_KEY` is the root key (`lib/crypto/root-key.ts`), which
 * is how a developer machine and CI work with no cloud at all.
 */
export function rootKeySecretName(): string | null {
  const name = process.env.ROOT_KEY_SECRET?.trim();
  return name && name.length > 0 ? name : null;
}

export interface SecretVersion {
  /** The numeric version, as Secret Manager names it. */
  version: string;
  /** The raw secret payload. */
  value: string;
}

export type SecretFailure =
  | { ok: false; reason: "unconfigured" }
  | { ok: false; reason: "unauthenticated" }
  | { ok: false; reason: "rejected"; detail: string };

export type SecretResult = ({ ok: true } & SecretVersion) | SecretFailure;

/**
 * The version number out of a resource name.
 *
 * `projects/733000675212/secrets/agentforge-root-key/versions/3` → `3`. Parsed rather
 * than assumed, because accessing `latest` returns the *resolved* name and that number
 * is the only thing that tells us which version to record on the row. Getting this wrong
 * produces a credential nothing can ever unwrap, so it is a pure function with a test.
 */
export function versionFromName(name: string): string | null {
  const match = /\/versions\/(\d+)$/.exec(name);
  return match ? match[1]! : null;
}

const versionCache = new Map<string, SecretVersion>();
let latestCache: { at: number; version: SecretVersion } | null = null;

/**
 * Read one version of the root key secret. `version` is a number, or `latest`.
 *
 * Never logs the payload, and never includes it in a failure — a `rejected` detail
 * carries Google's own message, which for a 403 is the useful half (it names the missing
 * `secretmanager.versions.access` permission).
 */
export async function readRootKeyVersion(version: string): Promise<SecretResult> {
  const secret = rootKeySecretName();
  if (!secret) return { ok: false, reason: "unconfigured" };

  if (version === "latest") {
    if (latestCache && latestCache.at + LATEST_TTL_MS > Date.now()) {
      return { ok: true, ...latestCache.version };
    }
  } else {
    const hit = versionCache.get(version);
    if (hit) return { ok: true, ...hit };
  }

  const project = await projectId();
  if (!project) return { ok: false, reason: "unconfigured" };

  const token = await accessToken();
  if (!token) return { ok: false, reason: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch(
      `${API}/projects/${project}/secrets/${encodeURIComponent(secret)}/versions/${encodeURIComponent(version)}:access`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch (error) {
    return {
      ok: false,
      reason: "rejected",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, reason: "rejected", detail: `${response.status} ${detail.slice(0, 500)}` };
  }

  const body = (await response.json().catch(() => ({}))) as {
    name?: string;
    payload?: { data?: string };
  };

  const resolved = body.name ? versionFromName(body.name) : null;
  const data = body.payload?.data;
  if (!resolved || !data) {
    return { ok: false, reason: "rejected", detail: "Secret Manager returned no payload." };
  }

  const found: SecretVersion = {
    version: resolved,
    // Secret Manager returns the payload base64-encoded over JSON; the stored value is
    // itself base64 of 32 bytes, so this decodes one layer and leaves the other.
    value: Buffer.from(data, "base64").toString("utf8").trim(),
  };

  versionCache.set(found.version, found);
  if (version === "latest") latestCache = { at: Date.now(), version: found };
  return { ok: true, ...found };
}

/** Only for tests and for a deliberate refresh; the caches are per instance otherwise. */
export function clearSecretCache(): void {
  versionCache.clear();
  latestCache = null;
}
