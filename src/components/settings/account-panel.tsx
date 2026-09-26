import Link from "next/link";

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The account tab.
 *
 * Phase 15 adds it because "settings" that hold only two integrations answer the
 * question "what have I configured?" and never the one a stranger signing into a
 * hosted tool actually asks, which is "what does this thing know about me?". So the
 * middle card is an inventory, written from `src/db/schema.ts` rather than from
 * memory, and it is deliberately specific about the parts that are encrypted and
 * the parts that are not.
 *
 * A server component, so the sign-out action can be defined next to the button that
 * uses it. Signing out has to clear an httpOnly cookie, which no client fetch can
 * do — it is a form post, not a click handler, on purpose.
 */
export function AccountPanel({ name, email }: { name?: string | null; email: string }) {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span
          aria-hidden="true"
          className="border-line bg-accent-pop text-ink grid size-12 shrink-0 place-items-center rounded-2xl border-2 text-lg font-bold"
        >
          {(name ?? email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          {name && <p className="text-base font-bold">{name}</p>}
          <p className="text-muted truncate text-sm">{email}</p>
          <p className="text-faint mt-0.5 text-2xs">Signed in with Google</p>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-bold">What AgentForge stores about you</h2>
        <ul className="text-muted mt-3 space-y-2 text-sm">
          <li>
            <span className="text-ink font-semibold">Your identity from Google</span> — name,
            email address and avatar URL. Nothing else is requested at sign-in.
          </li>
          <li>
            <span className="text-ink font-semibold">Your workflows and their runs</span> —
            the graph, and a record of every step each run took, including its logs.
          </li>
          <li>
            <span className="text-ink font-semibold">Credentials you connect</span> — your
            provider key, a Discord webhook URL, a Google refresh token. Each one is
            encrypted with AES-256-GCM before it is written, and no API route returns any
            of them to the browser, in whole or in part.
          </li>
        </ul>
        <p className="text-faint mt-3 text-2xs text-pretty">
          Deleting a workflow deletes its runs with it. Disconnecting an integration deletes
          the stored credential.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-bold">This session</h2>
        <p className="text-muted mt-2 text-sm text-pretty">
          Signing out clears the session cookie in this browser. It leaves your workflows,
          your runs and your connected credentials exactly as they are.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <form action={signOutAction}>
            <Button type="submit" tone="danger">
              Sign out
            </Button>
          </form>
          <Link href="/design" className="btn btn-quiet">
            Design system
          </Link>
          <a
            href="https://github.com/arunishrajput/AgentForge"
            target="_blank"
            rel="noreferrer"
            className="btn btn-quiet"
          >
            Source on GitHub
          </a>
        </div>
      </Card>
    </div>
  );
}
