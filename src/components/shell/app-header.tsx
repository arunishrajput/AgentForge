import Link from "next/link";

import { signOut } from "@/auth";
import { cn } from "@/components/ui/cn";

import type { WorkspaceSummary } from "@/lib/canvas/client";

import { AccountMenu } from "./account-menu";
import { CommandPalette } from "./command-palette";
import { Wordmark } from "./logo";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * The signed-in shell's header: the same bar on every page that is not the canvas.
 *
 * A server component, so the sign-out action can be defined here and handed to the
 * account menu, and so the current page is a prop rather than a `usePathname()`
 * subscription — a header that re-renders on the client to work out which of two
 * links to underline is a strange amount of machinery for a static fact the page
 * already knows.
 *
 * The canvas keeps its own full-bleed header. Phase 16 owns that screen, and
 * stacking a second bar above a viewport-height graph would cost the canvas the
 * space it is shortest of.
 */
export function AppHeader({
  email,
  workspace,
  workspaces,
  active,
}: {
  email: string;
  workspace: WorkspaceSummary;
  /** Every workspace this account is in — the switcher's list (Phase 19B). */
  workspaces: WorkspaceSummary[];
  active?: "workflows" | "runs" | "templates" | "analytics" | "settings";
}) {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className="border-line bg-surface sticky top-0 z-30 border-b-2">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 sm:px-6">
        <Link href="/workflows" aria-label="AgentForge — workflows" className="rounded-lg">
          <Wordmark />
        </Link>

        <WorkspaceSwitcher active={workspace} workspaces={workspaces} />

        {/* **`lg`, not `sm` — Phase 23A, and it fixes a bug that predates the fourth link.**
            Measured on the deployed build, at a 768 px viewport: the page's content box came
            to 938 px, so the whole document scrolled sideways, and it did so at every width
            from 640 px (where `sm:flex` revealed the nav) to just under 1000 px. **With three
            links it was 839 px — still overflowing** — so adding *Templates* widened a broken
            range rather than creating one, which is only visible if you measure the width you
            are NOT changing.

            Above 1024 px the shortage takes the other form, because the bar is capped at
            `max-w-5xl`: no page overflow, but a fixed 976 px content box the contents exceed,
            which the workspace switcher silently absorbed. See `account-menu.tsx` for that
            half and what was given up to fix it.

            Below `lg` the destinations are all in the command palette, which sits in this
            header at every width — the same pattern that already served every viewport under
            640 px. Phase 22 fixed the switcher's trigger refusing to shrink; this is the
            outer half of the same problem, and squeezing the switcher further was measured
            as worse: `flex-shrink: 0` on its wrapper reintroduced the overflow at six
            widths. */}
        <nav aria-label="Main" className="ml-3 hidden items-center gap-1 lg:flex">
          <NavLink href="/workflows" current={active === "workflows"}>
            Workflows
          </NavLink>
          <NavLink href="/runs" current={active === "runs"}>
            Runs
          </NavLink>
          <NavLink href="/templates" current={active === "templates"}>
            Templates
          </NavLink>
          <NavLink href="/analytics" current={active === "analytics"}>
            Analytics
          </NavLink>
          <NavLink href="/settings" current={active === "settings"}>
            Settings
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <CommandPalette />
          <AccountMenu email={email} signOutAction={signOutAction} />
        </div>
      </div>
    </header>
  );
}

/**
 * The current page is marked three ways: `aria-current`, a different fill, and the
 * pressed position — a tab that has already been clicked sits where a pressed
 * object sits. `DESIGN.md` → *Never colour alone*.
 */
function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "btn",
        current
          ? "btn-quiet translate-x-[2px] translate-y-[2px] shadow-(--shadow-press)"
          : "btn-ghost",
      )}
    >
      {children}
    </Link>
  );
}
