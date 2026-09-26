import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The CSRF state for the Google incremental-consent flow.
 *
 * The callback is a `GET` that a third party can cause the browser to make, so
 * without this an attacker could deliver *their* authorization code to a signed-in
 * user's callback and have the user's account store a refresh token for the
 * attacker's Google account — after which every Sheets row and every sent mail goes
 * to the attacker's data. That is the whole reason `state` exists, and why a flow
 * that merely ignores it is broken rather than merely untidy.
 *
 * The value lives in a short-lived host-only cookie rather than in the database:
 * it proves the callback arrived in the same browser that started the flow, which is
 * precisely the property needed, and it expires by itself.
 *
 * `SameSite=Lax` is required, not chosen — the callback is a cross-site top-level
 * navigation from accounts.google.com, and `Strict` would withhold the cookie and
 * break every connection attempt.
 */

export const STATE_COOKIE = "agentforge-google-oauth";
const MAX_AGE_SECONDS = 600;

export function mintState(): string {
  return randomBytes(24).toString("base64url");
}

export function stateCookie(state: string, secure: boolean): string {
  return [
    `${STATE_COOKIE}=${state}`,
    "Path=/api/integrations/google",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Sent with every terminal response of the flow, success or failure. */
export function clearedStateCookie(secure: boolean): string {
  return [
    `${STATE_COOKIE}=`,
    "Path=/api/integrations/google",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Reads one cookie out of a request's `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/**
 * Length-independent, constant-time comparison. `timingSafeEqual` throws on a length
 * mismatch, so the lengths are compared first — and a mismatch is a mismatch, which
 * is not a secret.
 */
export function stateMatches(expected: string | null, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
