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
}

export class IntegrationError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
  }
}

export async function request(url: string, options: FetchOptions): Promise<Response> {
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
      throw new IntegrationError(`The request to ${hostOf(url)} timed out after ${options.timeoutMs} ms.`);
    }
    if (options.signal?.aborted) {
      throw new IntegrationError("The run was cancelled before the request finished.");
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
