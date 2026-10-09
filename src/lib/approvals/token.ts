import { createHash, randomBytes } from "node:crypto";

/**
 * **The approval link's token — Phase 38** (D178). The invitation's construction (D95), for the
 * invitation's reason: a link that is delivered once, into somebody's chat history, and grants
 * something — here, the decision.
 *
 *  - **256 bits of CSPRNG**, base64url, so it cannot be guessed and need not be slowed down
 *  - **stored only as SHA-256** (`approval.tokenHash`): a leaked backup or a `select *` yields no
 *    usable link. The plaintext exists in one place — the memory of the run that minted it, while
 *    its Ask path sends it — and the engine removes it from everything it writes (`engine/redact.ts`)
 *  - **in the URL's fragment**, `/approve#<token>`, never its path or query: a browser does not send a
 *    fragment, so the token is in no request line, no Cloud Run request log, no `Referer` — and a chat
 *    app's link preview, which fetches the URL, fetches a page that knows nothing. The page reads the
 *    fragment and POSTs the token in a body (`POST /api/approve/describe`, `/decide`)
 */
export function mintApprovalToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What a token must look like before the database is asked about it — one regex, not a query. */
export const APPROVAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashApprovalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The link a person is sent. The token rides in the fragment — see above. */
export function approvalUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/approve#${token}`;
}
