import type { Metadata } from "next";
import Link from "next/link";

import { auth, signIn, signOut } from "@/auth";
import { AcceptInvitation } from "@/components/invite/accept";
import { Wordmark } from "@/components/shell/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  canAcceptAs,
  INVITATION_TOKEN_PATTERN,
  invitationState,
  normaliseEmail,
} from "@/lib/workspace/invitations";
import { findInvitationByToken } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invitation",
  // No link to this page should ever end up in an index. It carries a bearer token.
  robots: { index: false, follow: false },
};

/**
 * The accept surface — **the only page in the product a signed-out stranger can reach
 * that is not the landing page.**
 *
 * Four states, all designed rather than defaulted, because this is the first screen a new
 * teammate ever sees of AgentForge:
 *
 *   1. the link is dead — expired, revoked, already used, or never existed. **All four say
 *      exactly the same thing**, so the page cannot be used to sort real tokens from
 *      invented ones. There is nothing to leak and nothing to probe;
 *   2. the link is good and nobody is signed in — say which workspace and which role, and
 *      offer Google. Nothing else about the workspace, and **not the address it was sent
 *      to**: the copy asks them to use the account it was sent to rather than naming it,
 *      because whoever holds the link is not necessarily that person;
 *   3. the link is good and the wrong account is signed in — say so plainly and offer to
 *      sign out. This is the single most likely failure in the whole flow: two Google
 *      accounts in one browser;
 *   4. the link is good and the right account is signed in — one button.
 *
 * The state is computed on the server with `canAcceptAs`, the same function the accept
 * route uses, so the page and the API cannot disagree about whether a link is usable.
 * The page never accepts anything by itself: a GET that joined a workspace would be
 * triggered by a link preview fetching the URL.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();
  const signedInAs = session?.user?.email ?? null;

  const found = INVITATION_TOKEN_PATTERN.test(token) ? await findInvitationByToken(token) : null;
  const usable = found && invitationState(found.invitation) === "live" ? found : null;

  async function startSignIn() {
    "use server";
    // Back to this page rather than to the workflow list, so the accept button is the
    // first thing they see after Google returns them.
    await signIn("google", { redirectTo: `/invite/${token}` });
  }

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/invite/${token}` });
  }

  return (
    <div className="min-h-dvh">
      <header className="border-line bg-surface border-b-2">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-3 sm:px-6">
          <Wordmark />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-lg px-4 py-12 sm:px-6">
        {usable === null ? (
          <Card raised className="animate-rise p-6">
            <h1 className="text-xl font-bold tracking-tight">This invitation is not valid</h1>
            <p className="text-muted mt-2 text-sm text-pretty">
              The link may have expired, been revoked, or already been used — invitations
              last seven days and work once. Ask whoever invited you for a new one.
            </p>
            <Link href="/" className="btn btn-quiet mt-5">
              Go to AgentForge
            </Link>
          </Card>
        ) : (
          <Card raised className="animate-rise p-6">
            <Badge tone="outline" icon="◆">
              Invitation
            </Badge>
            <h1 className="mt-3 text-xl font-bold tracking-tight text-pretty">
              You have been invited to {usable.workspace.name}
            </h1>
            <p className="text-muted mt-2 text-sm text-pretty">
              You would join as {usable.invitation.role === "admin" ? "an" : "a"}{" "}
              <strong className="text-ink font-semibold">{usable.invitation.role}</strong>. Everyone
              in a workspace can see its workflows and its run history, and every workflow
              that runs there uses that workspace&rsquo;s connected credentials.
            </p>

            {signedInAs === null ? (
              <div className="mt-6">
                <p className="text-faint text-2xs text-pretty">
                  Sign in with the Google account this invitation was sent to. The invitation
                  only works for that address.
                </p>
                <form action={startSignIn} className="mt-3">
                  <Button type="submit" tone="primary" size="lg">
                    Continue with Google
                  </Button>
                </form>
              </div>
            ) : canAcceptAs(usable.invitation, signedInAs).ok ? (
              <div className="mt-6">
                <p className="text-faint text-2xs">
                  Signed in as <strong className="text-ink font-semibold">{signedInAs}</strong>.
                </p>
                <AcceptInvitation token={token} workspace={usable.workspace.name} />
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                <p className="text-bad text-sm font-semibold text-pretty">
                  This invitation was sent to a different email address.
                </p>
                <p className="text-muted text-2xs text-pretty">
                  You are signed in as{" "}
                  <strong className="text-ink font-semibold">{normaliseEmail(signedInAs)}</strong>.
                  Sign out and sign back in with the account the invitation was sent to, or ask
                  for a new invitation to this address.
                </p>
                <form action={startSignOut}>
                  <Button type="submit">Sign out</Button>
                </form>
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
