# 0010 — Anti-framing and a partial CSP, with no `script-src`

**Status:** Accepted · **Date:** 2026-10-10 · **Phase:** 42 · **Decision:** D193

## Context

The app sent no framing protection, so another site could frame it (clickjacking). A
Content-Security-Policy would also limit what an injected script could do — but Next injects inline
hydration scripts, so a `script-src` needs a per-request nonce, which makes every page dynamic
(including the static ones), and D123 forbids `unsafe-inline`.

## Decision

Send, on every response: `Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; object-src 'none'`,
`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, a `Referrer-Policy` and a
`Permissions-Policy` refusing camera, microphone, geolocation and payment. **`form-action` is left
out on purpose:** Chrome applies it to the redirect after a form POST, and sign-in posts to
`/api/auth/signin/google`, which redirects to Google.

## Consequences

Clickjacking is closed; a same-origin frame still works (how phone widths are measured). The policy
does **not** stop an injected script, and `SECURITY.md` says so. A full policy is a future phase:
nonces for dynamic pages and hashes for the static ones.

## Alternatives

- **`unsafe-inline` in `script-src`.** A policy that looks present and prevents nothing.
- **Nonces everywhere now.** Turns the static pages dynamic and costs cold-start latency; not
  justified by a product with no user-supplied HTML.
