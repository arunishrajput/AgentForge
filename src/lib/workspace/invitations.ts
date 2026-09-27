import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { INVITABLE_ROLES, type InvitableRole, type WorkspaceRole } from "./roles";

/**
 * The invitation token, and every rule about one that does not need a database —
 * Phase 19B.
 *
 * **Nothing here touches the database on purpose**, which is what makes the rules
 * testable at all: an expired invitation, a revoked one, one addressed to a different
 * address and one whose token is simply wrong are four different refusals, and each is
 * asserted directly rather than through an HTTP round trip (D18's argument, applied to
 * the surface where a mistake is most expensive). `./store.ts` holds the queries.
 *
 * The threat model is the webhook trigger's, restated: **the link is an unauthenticated
 * bearer token that will be pasted into a chat window.** So it is CSPRNG, it expires, it
 * is single use, only its hash is stored, and possession of it is never on its own
 * enough — the accept path also demands a signed-in account whose *verified* email
 * matches the address invited.
 */

/**
 * 32 bytes, base64url: 256 bits of CSPRNG in 43 URL-safe characters.
 *
 * Wider than the webhook token's 192 bits (`lib/triggers/webhook.ts`) for a reason
 * worth stating rather than as reflex: a webhook token grants the ability to *start one
 * workflow*, and this grants membership of a workspace and everything in it, including
 * the credentials. Both are far beyond guessable; the cost of the extra nine characters
 * is nothing, and the two are deliberately not the same size so neither can be mistaken
 * for the other in a log.
 */
export function mintInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What a token must look like before the database is asked about it. */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

/**
 * How a token becomes the value the database holds.
 *
 * Plain SHA-256, **not** a password hash, and that is the right choice rather than a
 * lazy one: bcrypt and argon2 exist to make a *low-entropy* secret expensive to guess.
 * This secret has 256 bits of entropy, so there is nothing to slow down — an attacker
 * who cannot guess the token cannot guess it more slowly. What the hash buys is that a
 * leaked backup, a stray log line or a `select *` in a console yields no usable link.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compare two hashes without leaking where they first differ.
 *
 * Belt and braces — the lookup is an indexed equality on the hash, so the comparison
 * that matters already happened inside Postgres — but the accept path also re-checks,
 * and a timing-safe compare there costs nothing.
 */
export function invitationTokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashInvitationToken(token), "hex");
  // `Buffer.from(x, "hex")` does not throw on rubbish — it stops at the first invalid
  // character, so anything that is not 32 bytes of hex fails the length test below
  // rather than reaching `timingSafeEqual`, which throws on a length mismatch.
  const expected = Buffer.from(storedHash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * How long a link stays live.
 *
 * Seven days rather than a month, because an invitation is delivered by hand here —
 * there is no email provider on a zero-cost budget, so the inviter copies the link into
 * whatever they already use. A link pasted into a group chat outlives anybody's memory
 * of it, and the shorter the window the smaller the number of live bearer tokens lying
 * around in other people's message history. Re-inviting is one click.
 */
export const INVITATION_TTL_DAYS = 7;

export function invitationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The address, normalised.
 *
 * Lower-cased and trimmed, and nothing cleverer. Stripping dots or `+tags` the way
 * Gmail does would be **wrong** here: those are provider-specific rules, this has to
 * match whatever the identity provider reports as the verified email, and a
 * normalisation the provider does not share would silently refuse a legitimate accept.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Zod's own email format rather than a hand-rolled pattern, and `z.email()` rather than
 * the deprecated `z.string().email()` — Zod 4 moved every format to a top-level schema.
 * The address is not delivered to, so this is a typo guard: it stops "ada" and "ada@"
 * from becoming an invitation nobody can ever accept, and it does not try to be RFC 5322.
 *
 * **Normalise first, then validate** — the order is not stylistic. Zod 4 runs the format
 * check before a trailing `.trim()`, so `z.email().trim()` refuses `" ada@example.com "`,
 * which a copy-and-paste out of a chat window produces about half the time. A test asserts
 * the padded case for exactly that reason.
 */
export const invitationEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.email());

export const issueInvitationSchema = z.object({
  email: invitationEmailSchema,
  role: z.enum(INVITABLE_ROLES).default("editor"),
});

/** Why an invitation cannot be used. `live` is the only one that can be accepted. */
export type InvitationState = "live" | "expired" | "revoked" | "accepted";

export interface InvitationFacts {
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Which of the four states an invitation row is in.
 *
 * **The order of the tests is part of the answer.** Revoked is checked before expired
 * and accepted before either, so a link that is both revoked and expired reports the
 * decision a person made rather than the one the clock made — which is what the person
 * revoking it wants to see in the list.
 */
export function invitationState(invitation: InvitationFacts, now = new Date()): InvitationState {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "expired";
  return "live";
}

/** Why an accept was refused, or `ok` when it may proceed. */
export type AcceptCheck =
  | { ok: true }
  | { ok: false; state: InvitationState }
  | { ok: false; state: "wrong_email" };

/**
 * May this signed-in account accept this invitation?
 *
 * **Two independent facts, and both are required.** The token proves the holder was sent
 * the link; the session proves who they are. Matching on the email from the identity
 * provider rather than on anything in the URL is the whole of the second half — a
 * `?email=` parameter would make the address a claim by the attacker, and the link would
 * become a way to join a workspace as anybody.
 *
 * A signed-in account with no email address cannot accept. That cannot happen with
 * Google as the only provider, and refusing is still the right default: an absent
 * address is not a match, and `undefined === undefined` must never be one.
 */
export function canAcceptAs(
  invitation: InvitationFacts,
  sessionEmail: string | null | undefined,
  now = new Date(),
): AcceptCheck {
  const state = invitationState(invitation, now);
  if (state !== "live") return { ok: false, state };

  const signedInAs = sessionEmail ? normaliseEmail(sessionEmail) : "";
  if (signedInAs.length === 0 || signedInAs !== normaliseEmail(invitation.email)) {
    return { ok: false, state: "wrong_email" };
  }
  return { ok: true };
}

/** The link an inviter copies. One shape, so the page and the API cannot disagree. */
export function invitationUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/invite/${token}`;
}

/**
 * What an invitation looks like to the workspace that issued it.
 *
 * **The token is absent, and it cannot be recovered** — only its hash was stored. That
 * is the deliberate cost of hashing: the link is shown once, when it is issued, and
 * "send it again" is re-issuing, which rotates the token. The alternative was storing
 * something that could be handed back, which is the thing worth avoiding.
 */
export function describeInvitation(invitation: InvitationFacts & { id: string; createdAt: Date }) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    state: invitationState(invitation),
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  };
}

export type InvitationSummary = ReturnType<typeof describeInvitation>;

/**
 * What the accept page may say to somebody holding a link, **before** they sign in.
 *
 * The workspace's name and the role, and nothing else. No member list, no member count,
 * no inviter, and not the address the invitation was sent to — the holder of a valid
 * link was sent it, so the name tells them which invitation this is and helps them pick
 * the right Google account; anything more would be describing a workspace to whoever
 * ended up with the link. A wrong or spent token yields no object at all, so the page
 * cannot distinguish "never existed" from "already used" and neither can a prober.
 */
export function describeInvitationForHolder(invitation: {
  role: WorkspaceRole;
  workspaceName: string;
}) {
  return { workspace: invitation.workspaceName, role: invitation.role };
}

export type { InvitableRole };
