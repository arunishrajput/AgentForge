import Link from "next/link";

import { signOut } from "@/auth";
import { cn } from "@/components/ui/cn";

import { AccountMenu } from "./account-menu";
import { CommandPalette } from "./command-palette";
import { Wordmark } from "./logo";

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
  active,
}: {
  email: string;
  workspace: { name: string; personal: boolean; role: string };
  active?: "workflows" | "settings";
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

        <WorkspaceBadge workspace={workspace} />

        <nav aria-label="Main" className="ml-3 hidden items-center gap-1 sm:flex">
          <NavLink href="/workflows" current={active === "workflows"}>
            Workflows
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
 * Which workspace everything on this page belongs to — Phase 19A.
 *
 * **Static text, not a control, and deliberately so.** Every user has exactly one
 * workspace until Phase 19B's invitations exist, and a switcher offering one option is
 * a control that teaches the user it does nothing. This is the slot that becomes the
 * switcher, and until then it answers the only question a single-workspace user can
 * have: *where does the thing I am about to save go?*
 *
 * Hidden below `sm`, where the wordmark and the nav already compete for the bar. The
 * name is not lost on a phone — the workflow list and the settings page both name the
 * workspace in their own copy.
 */
function WorkspaceBadge({
  workspace,
}: {
  workspace: { name: string; personal: boolean; role: string };
}) {
  return (
    <span
      className="border-line bg-lift text-muted ml-2 hidden max-w-[14rem] items-center gap-1.5 truncate rounded-full border-2 px-2.5 py-1 text-xs font-semibold sm:inline-flex"
      title={`Workspace: ${workspace.name}`}
    >
      {/* The label is read out but not drawn: sighted users have the bar's context,
          and a screen reader arriving at a bare name has none. */}
      <span className="sr-only">Workspace: </span>
      <span className="truncate">{workspace.name}</span>
    </span>
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
