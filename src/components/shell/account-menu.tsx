"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

import { Menu } from "@/components/ui/menu";
import { useTheme } from "@/components/ui/theme";
import { THEME_CHOICES } from "@/lib/ui/theme";

/**
 * The account control in the header.
 *
 * Signing out is a **server action**, passed in as a prop rather than called from
 * here: it has to clear an httpOnly session cookie, which a fetch from this
 * component cannot do. A menu item is a button with an `onSelect`, so the action is
 * reached by submitting a hidden form — `requestSubmit()` rather than `submit()`,
 * because only `requestSubmit` runs the form's own submit handling, which is what
 * Next hooks the action to.
 *
 * The keyboard behaviour (arrows, Home/End, Escape, click-outside, focus return)
 * all comes from the `Menu` primitive.
 *
 * **The theme lives here too (Phase 27)**, as a radio set: the account menu is where a
 * reader looks for "my settings", and it is on every signed-in page except the canvas
 * — which has the ⌘K palette instead. Choosing one applies it at once, before the menu
 * has finished closing.
 */
export function AccountMenu({
  email,
  signOutAction,
}: {
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { preference, setPreference } = useTheme();

  return (
    <>
      {/* Hidden, but present in the DOM: `requestSubmit` needs a real form. */}
      <form ref={form} action={signOutAction} className="hidden" />

      <Menu
        align="end"
        label={
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="border-line bg-accent-pop text-accent-ink text-3xs grid size-5 place-items-center rounded-md border-2 font-bold"
            >
              {email.slice(0, 1).toUpperCase()}
            </span>
            {/* **Dropped at `lg`, where the nav appears — Phase 23A.**
                The shell bar is capped at `max-w-5xl`, so it is 1024 px wide at *every*
                viewport above that and the space is a fixed budget rather than a
                growing one. Measured on the deployed build: with the nav shown, the
                wordmark, the switcher, four links, Search and this email need ~1062 px
                of a 976 px content box — and the workspace switcher, as the only item
                carrying `min-w-0`, absorbed the whole 86 px deficit and collapsed from
                ~200 px to 62 px, rendering the workspace name as "A…".

                This address is the least informative thing on the bar for the person
                reading it — they know their own email — and the workspace name is the
                most, because Phase 19B made it something that changes. So this yields
                and the name survives. It is still in the menu below, so nothing is
                lost.

                **From `md`, not `sm` — Phase 37.** The inbox bell joined this bar, and between
                640 and 767 px it overlapped the workspace switcher by 7 px (measured in a 640 px
                frame), the switcher being the one item that shrinks. The address yields again, for
                the same reason as above; below `md` the account shows its letter, as on a phone. */}
            <span className="hidden max-w-[11rem] truncate md:inline lg:hidden">{email}</span>
            <span className="sr-only">Account</span>
          </span>
        }
        items={[
          // Carries the address the trigger stops showing at `lg`. `disabled` because it
          // is a label rather than an action — it takes no focus and does nothing when
          // clicked, which is what stops it behaving like a fourth menu item.
          { id: "who", label: email, onSelect: () => {}, disabled: true },
          { id: "settings", label: "Settings", onSelect: () => router.push("/settings") },
          { id: "design", label: "Design system", onSelect: () => router.push("/design") },
          ...THEME_CHOICES.map((choice) => ({
            id: `theme:${choice.value}`,
            label: choice.label,
            group: "Theme",
            checked: preference === choice.value,
            onSelect: () => setPreference(choice.value),
          })),
          {
            id: "sign-out",
            label: "Sign out",
            tone: "danger",
            onSelect: () => form.current?.requestSubmit(),
          },
        ]}
      />
    </>
  );
}
