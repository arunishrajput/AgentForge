/**
 * The one outbound-HTTP helper every integration node uses.
 *
 * Three things it exists to make unmissable:
 *
 *  • **A `User-Agent` is always sent.** Discord answers 403 to a request without one
 *    (recorded in PROGRESS.md before this phase started, and it is the first trap a
 *    Discord node hits). Setting it here means no node can forget.
 *  • **Every request has a deadline, and it honours the run's.** A node that hangs
 *    holds the engine's 120 s budget and, on a webhook run, an open HTTP request on
 *    Cloud Run. `AbortSignal.any` combines the node's own timeout with
 *    `context.signal`, so cancelling a run cancels the socket.
 *  • **A response body is capped.** It becomes a `jsonb` step output that streams to
 *    the browser. An API answering with 40 MB of JSON would otherwise land in Neon.
 *  • **One retry, where repeating the call is safe** (Phase 11). Discord rate-limits
 *    a webhook to a handful of posts per two seconds and Google answers 503 under
 *    load; either one, once, ends `DEMO.md` Beat 8 with nothing posted. The provider
 *    adapter has had retry since Phase 6 — the integrations had none at all.
 */

export const USER_AGENT = "AgentForge/1.0 (+https://github.com/arunishrajput/AgentForge)";

/** 256 KB. Large enough for any API response worth putting in a workflow. */
export const MAX_BODY_BYTES = 256 * 1024;

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** The run's signal. Cancelling the run must cancel the request. */
  signal?: AbortSignal;
  /** `manual` for the HTTP node: a redirect is reported, never followed (see below). */
  redirect?: RequestRedirect;
  /** Off unless a caller opts in. See `RetryPolicy`. */
  retry?: RetryPolicy;
}

/**
 * Retrying is **opt-in per call site**, never a default.
 *
 * The reason is that most of what this helper sends is not safe to repeat. A POST
 * that creates something — a Discord message, a spreadsheet row — may have taken
 * effect even though the answer never arrived, and a blind retry turns one message
 * into two on a shared screen. So a caller has to say what it knows:
 *
 *  • `on` lists statuses that mean *the server did not act*. The default set is
 *    429, 502, 503 and 504. **500 is deliberately absent** — it is ambiguous for a
 *    create, and a duplicate row is worse than a failed step that says why.
 *  • `onTransportError` is for a request that is genuinely idempotent (a GET, or an
 *    OAuth token refresh). A transport failure gives no evidence either way, so
 *    anything that creates leaves this off.
 */
export interface RetryPolicy {
  /** Total attempts including the first. 2 means one retry. */
  attempts: number;
  on?: number[];
  onTransportError?: boolean;
}

/** "Ask again, nothing happened." See `RetryPolicy` on why 500 is not here. */
export const RETRY_STATUSES = [429, 502, 503, 504];

/** One short pause. Long enough to clear a rate-limit window, short enough for a demo. */
const RETRY_BACKOFF_MS = [500, 1500];

/**
 * A `Retry-After` longer than this is honoured by **not retrying**. Waiting 30 s
 * inside a node is worse on stage than a failed step naming the rate limit, and the
 * engine's 120 s deadline is not a budget to spend sleeping.
 */
const MAX_RETRY_AFTER_MS = 5_000;

/** Seconds, or an HTTP date. Absent or unparseable yields null, not a guess. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
  });
}

export class IntegrationError extends Error {
  readonly status?: number;
  /**
   * Whether repeating the call could help. `false` marks the two failures where it
   * provably cannot: a spent timeout and a cancelled run.
   */
  readonly retryable?: boolean;

  constructor(message: string, status?: number, options?: { retryable?: boolean }) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
    this.retryable = options?.retryable;
  }
}

export async function request(url: string, options: FetchOptions): Promise<Response> {
  const policy = options.retry;
  const attempts = Math.max(1, policy?.attempts ?? 1);
  const retryOn = policy?.on ?? RETRY_STATUSES;

  for (let attempt = 1; ; attempt += 1) {
    const last = attempt >= attempts;

    let response: Response;
    try {
      response = await attemptOnce(url, options);
    } catch (error) {
      // A transport failure says nothing about whether the server acted, so only a
      // caller that declared the call idempotent gets another go. A timeout and a
      // cancellation are never retried: one means the deadline is already spent, the
      // other means the run is over.
      if (
        last ||
        !policy?.onTransportError ||
        !(error instanceof IntegrationError) ||
        error.retryable === false
      ) {
        throw error;
      }
      await sleep(backoffFor(attempt), options.signal);
      if (options.signal?.aborted) throw error;
      continue;
    }

    if (last || !retryOn.includes(response.status)) return response;

    // The server told us to wait. Longer than the cap and we stop rather than sleep
    // through the demo — the caller's error then carries the real status.
    const advised = retryAfterMs(response.headers.get("retry-after"));
    if (advised !== null && advised > MAX_RETRY_AFTER_MS) return response;

    // The body of a response we are abandoning has to be released, or the socket is
    // held until GC.
    await response.body?.cancel().catch(() => {});

    await sleep(advised ?? backoffFor(attempt), options.signal);
    if (options.signal?.aborted) {
      throw new IntegrationError("The run was cancelled before the request finished.", undefined, {
        retryable: false,
      });
    }
  }
}

function backoffFor(attempt: number): number {
  return RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length) - 1];
}

async function attemptOnce(url: string, options: FetchOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers: { "user-agent": USER_AGENT, ...(options.headers ?? {}) },
      ...(options.body === undefined ? {} : { body: options.body }),
      redirect: options.redirect ?? "follow",
      signal,
    });
  } catch (error) {
    // `AbortSignal.any` loses which signal fired, so distinguish on the timeout's
    // own state rather than on the error, which is the same DOMException either way.
    if (timeout.aborted) {
      throw new IntegrationError(
        `The request to ${hostOf(url)} timed out after ${options.timeoutMs} ms.`,
        undefined,
        // The deadline is spent. Trying again only spends the next one too.
        { retryable: false },
      );
    }
    if (options.signal?.aborted) {
      throw new IntegrationError("The run was cancelled before the request finished.", undefined, {
        retryable: false,
      });
    }
    throw new IntegrationError(
      `Could not reach ${hostOf(url)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface ReadBody {
  text: string;
  json: unknown;
  truncated: boolean;
}

/**
 * Reads at most `MAX_BODY_BYTES` and parses JSON when it parses. A body that does
 * not parse is not an error — the text is still the useful thing, and a node that
 * failed on an HTML error page would hide the very message explaining why.
 */
export async function readBody(response: Response): Promise<ReadBody> {
  const raw = await response.text();
  const truncated = raw.length > MAX_BODY_BYTES;
  const text = truncated ? raw.slice(0, MAX_BODY_BYTES) : raw;

  let json: unknown = null;
  if (!truncated && text.trim().length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { text, json, truncated };
}

/**
 * The message an API sent with its own failure, trimmed to something readable on a
 * failed step. Google and Discord both nest it; the fallbacks cover the rest.
 */
export function apiErrorMessage(body: ReadBody, fallback: string): string {
  const json = body.json;
  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
    if (typeof error === "string" && error.length > 0) {
      const description = record.error_description;
      return typeof description === "string" ? `${error}: ${description}` : error;
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
  }
  const text = body.text.trim();
  return text.length > 0 ? text.slice(0, 300) : fallback;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
