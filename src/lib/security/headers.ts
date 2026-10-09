/**
 * The response headers every page and route carries (Phase 42, D193).
 *
 * `frame-ancestors 'self'` is the anti-clickjacking control: another site cannot frame the app,
 * while a same-origin frame (how the phone-width measurements are taken) still works.
 * `X-Frame-Options` says the same to a browser that predates CSP level 2.
 *
 * There is deliberately no `script-src`. Next injects inline hydration scripts, so a policy that
 * restricts scripts needs a per-request nonce — which makes every page dynamic, including the
 * static ones — and D123 forbids `unsafe-inline`. The directives below are the ones that can be
 * enforced without that cost; `SECURITY.md` → *What we do not claim* says what is missing.
 *
 * `form-action` is also absent on purpose: Chrome applies it to the redirect that follows a form
 * POST, and sign-in posts to `/api/auth/signin/google`, which redirects to accounts.google.com.
 */
export const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these; refusing them costs nothing and shrinks what an injected
  // script could ask the browser for.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];
