"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

import { Menu } from "@/components/ui/menu";

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
              className="border-line bg-accent-pop text-ink text-3xs grid size-5 place-items-center rounded-md border-2 font-bold"
            >
              {email.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden max-w-[11rem] truncate sm:inline">{email}</span>
            <span className="sr-only">Account</span>
          </span>
        }
        items={[
          { id: "settings", label: "Settings", onSelect: () => router.push("/settings") },
          { id: "design", label: "Design system", onSelect: () => router.push("/design") },
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
