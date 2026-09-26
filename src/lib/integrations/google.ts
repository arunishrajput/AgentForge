import { apiErrorMessage, IntegrationError, readBody, request } from "./net";

/**
 * Google incremental authorisation — the OAuth half. No database, no session: this
 * module builds URLs, exchanges codes and refreshes tokens, so the state machine is
 * assertable without a network (D18).
 *
 * **Why a second flow rather than wider sign-in scopes.** Sign-in asks for identity
 * and nothing else. Adding `gmail.send` there would put "Send email on your behalf"
 * on the consent screen of every visitor before they had built anything, which
 * `BUILD_PLAN.md` Phase 9 names as actively harmful to the demo. So the extra scopes
 * are requested the first time the user connects the integration, through a flow this
 * app owns end to end — which is also the only way to be sure of getting a **refresh
 * token**, since Auth.js does not re-persist account tokens on a later sign-in.
 *
 * **Why the refresh token is the stored secret.** Access tokens last an hour. An
 * hour is shorter than the gap between setting a demo up and giving it, so anything
 * that stored only the access token would have expired by the time it mattered — the
 * failure `BUILD_PLAN.md` calls "the likeliest live failure". The refresh token goes
 * through the Phase 6 envelope and is exchanged for an access token per use.
 */

export const GOOGLE_CREDENTIAL_KIND = "google.oauth";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** What "connected" means. Both are requested together: two consent screens is worse. */
export const INTEGRATION_SCOPES = [SHEETS_SCOPE, GMAIL_SEND_SCOPE] as const;

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function callbackUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/integrations/google/callback`;
}

/**
 * Where the consent flow sends the browser back to, and whether the cookies it sets
 * may carry `Secure`. Both derived from `APP_BASE_URL`, never from the request.
 *
 * **Inside the Cloud Run container `request.url` is built from the bind address.**
 * `HOSTNAME=0.0.0.0` and `PORT=8080` (see the Dockerfile), so a `Response.redirect`
 * resolved against it sends the user to `http://0.0.0.0:8080/settings`, which is
 * `ERR_CONNECTION_REFUSED` in their browser — and `protocol === "https:"` is false,
 * which silently drops `Secure` from the CSRF state cookie that is the whole defence
 * in D47. Neither is visible locally, where the bind address *is* the origin.
 *
 * `APP_BASE_URL` is the same value `callbackUrl` builds the `redirect_uri` from, so
 * the flow starts, returns and sets its cookie on one origin by construction — the
 * origin Google validated.
 */
export function appReturn(
  baseUrl: string,
  path: string,
): { location: string; secure: boolean } {
  const base = new URL(baseUrl);
  return {
    location: new URL(path, base).toString(),
    secure: base.protocol === "https:",
  };
}

/**
 * The consent URL.
 *
 * `access_type=offline` with `prompt=consent` is what actually returns a refresh
 * token. Google omits `refresh_token` when the user has already granted these scopes
 * and `prompt` is left off — so a user who reconnects would get a valid-looking
 * response with nothing durable in it, and the integration would work for exactly one
 * hour. `include_granted_scopes=true` keeps the scopes sign-in already holds instead
 * of replacing them.
 */
export function authorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INTEGRATION_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  scopes: string[];
}

export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
): Promise<TokenResponse> {
  return tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(
  config: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  return tokenRequest(
    {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    },
    signal,
  );
}

async function tokenRequest(
  form: Record<string, string>,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const response = await request(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    timeoutMs: 15_000,
    signal,
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new IntegrationError(
      `Google rejected the token request: ${apiErrorMessage(body, `HTTP ${response.status}`)}`,
      response.status,
    );
  }

  const json = (body.json ?? {}) as Record<string, unknown>;
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new IntegrationError("Google returned no access token.");
  }

  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : 3600,
    scopes: parseScopes(json.scope),
  };
}

/** Google returns granted scopes space-separated in one string. */
export function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope.split(/\s+/).filter((entry) => entry.length > 0);
}

/**
 * Which of the scopes a node needs are missing from what was granted.
 *
 * Checked before every call rather than assumed, because Google's consent screen lets
 * a user **untick an individual scope**. Approving only Sheets produces a perfectly
 * valid connection whose Gmail node fails with a 403 from inside a run — a failure
 * the user cannot diagnose. Named here so the node says "reconnect Google and allow
 * sending mail" instead.
 */
export function missingScopes(granted: string[], required: string[]): string[] {
  const held = new Set(granted);
  // Full-mailbox access implies the send scope; Google grants it under its own name.
  if (held.has("https://mail.google.com/")) held.add(GMAIL_SEND_SCOPE);
  return required.filter((scope) => !held.has(scope));
}

export async function fetchEmail(
  accessToken: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await request(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
      timeoutMs: 10_000,
      signal,
    });
    if (!response.ok) return null;
    const body = await readBody(response);
    const json = (body.json ?? {}) as Record<string, unknown>;
    return typeof json.email === "string" ? json.email : null;
  } catch {
    // Cosmetic: the email is only shown on the settings page so the user can see
    // which account is connected. Never worth failing a connection over.
    return null;
  }
}
