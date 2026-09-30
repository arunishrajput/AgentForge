"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Menu } from "@/components/ui/menu";
import { api, ApiRequestError, type WorkspaceSummary } from "@/lib/canvas/client";

/**
 * Which workspace everything on this page belongs to, and how to change it — Phase 19B.
 *
 * **Phase 19A left this slot as static text on purpose** and said why: every user had
 * exactly one workspace, and a switcher offering one option teaches the user that the
 * control does nothing. Invitations make the choice real, so the badge becomes a menu.
 *
 * With one workspace it is still a menu rather than a label, and that is the designed
 * single-workspace state rather than a default: the one thing it offers is
 * **New workspace**, which is the only useful action somebody with one workspace can
 * take here. A user who never makes a second one sees their workspace's name in a control
 * that does exactly one thing, instead of a dead pill.
 *
 * **It is visible on a phone, where Phase 19A's badge was not**, and that is a
 * functional change rather than a styling one: the badge was static text that the
 * workflow list and the settings page both repeated in their own copy, so hiding it on a
 * narrow bar cost nothing. This is now the only control that changes workspace — hidden
 * at 375 px, a member of two workspaces on a phone is stuck in whichever one the cookie
 * happens to name. The label truncates harder instead.
 *
 * Switching is a `fetch` that sets an httpOnly cookie, then `router.refresh()`. The
 * refresh is not optional: every page resolves its workspace on the server, so the cookie
 * changing means nothing until the server components re-run. `useTransition` keeps the
 * old page interactive while they do, which matters because this is a whole-page reload
 * of data in all but name.
 */
export function WorkspaceSwitcher({
  active,
  workspaces,
}: {
  active: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const switchTo = (id: string) => {
    if (id === active.id) return;
    setError(null);
    startTransition(async () => {
      try {
        await api.switchWorkspace(id);
        router.refresh();
      } catch (caught) {
        // A workspace that has gone, or a membership removed in another tab. Saying so
        // beats a menu item that silently does nothing.
        setError(
          caught instanceof ApiRequestError
            ? caught.message
            : "That workspace could not be opened.",
        );
      }
    });
  };

  return (
    <div className="ml-1 flex min-w-0 items-center sm:ml-2">
      <Menu
        align="start"
        className="min-w-0 max-w-[12rem] sm:max-w-[16rem]"
        panelClassName="max-w-[12.5rem] sm:max-w-[20rem]"
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Read out but not drawn: sighted users have the bar's context, and a screen
                reader arriving at a bare name has none. */}
            <span className="sr-only">Workspace: </span>
            {/* `min-w-0` so the name can truncate when the header squeezes the trigger,
                rather than holding the button open past its wrapper — see `Menu`. */}
            <span className="min-w-0 max-w-[7rem] truncate font-semibold sm:max-w-[10rem]">
              {active.name}
            </span>
            {pending && <span className="text-faint text-3xs">switching…</span>}
          </span>
        }
        items={[
          ...workspaces.map((workspace) => ({
            id: workspace.id,
            label: (
              <span className="flex w-full min-w-0 items-center gap-2">
                {/* The tick, not colour, marks the current one — DESIGN.md → Never colour
                    alone. `aria-hidden` because the name is already announced as current
                    through the menu item's own text below. */}
                <span aria-hidden="true" className="text-3xs w-3 shrink-0">
                  {workspace.id === active.id ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {/* `own`, not `personal`: a personal workspace somebody invited you into
                    is not yours, and labelling it PERSONAL to a guest is how this read
                    before a browser walk caught it. Their workspace is labelled by the
                    role you hold in it, which is the useful fact anyway. */}
                <span className="text-faint text-3xs shrink-0 font-semibold uppercase">
                  {workspace.own ? "personal" : workspace.role}
                </span>
                {workspace.id === active.id && <span className="sr-only">(current)</span>}
              </span>
            ),
            onSelect: () => switchTo(workspace.id),
          })),
          {
            id: "manage",
            label: workspaces.length > 1 ? "Manage workspaces…" : "New workspace…",
            onSelect: () => router.push("/settings?tab=workspace"),
          },
        ]}
      />

      {error && (
        // A live region rather than a toast: the header has no toast provider on every
        // page, and this failure is about the control the user just used.
        <span role="status" className="text-bad ml-2 max-w-[12rem] truncate text-2xs font-semibold">
          {error}
        </span>
      )}
    </div>
  );
}
