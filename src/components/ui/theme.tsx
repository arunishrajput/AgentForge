"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";

import { THEME_LABEL } from "@/lib/design/palette";
import {
  applyTheme,
  parseSnapshot,
  readPreference,
  SERVER_SNAPSHOT,
  snapshot,
  subscribe,
  THEME_CHOICES,
  THEME_COLOR,
  type ThemePreference,
  writePreference,
} from "@/lib/ui/theme";

import { cn } from "./cn";

/**
 * The theme, for React. Phase 27.
 *
 * The decisions are in `src/lib/ui/theme.ts`; this is the wiring. Three places offer
 * the choice — the account menu, *Settings → Account → Appearance*, and the ⌘K palette
 * — plus the `/design` gallery, which a signed-out visitor can reach and which has to
 * show both themes.
 */

/**
 * The reader's preference and the palette it resolves to.
 *
 * Through `useSyncExternalStore`, as the canvas panels read theirs (D74): reading
 * `localStorage` in a `useState` initialiser is a hydration mismatch, and reading it
 * in an effect is a cascading render. Hydration starts from Light — what the server
 * rendered — and settles on the stored value in the same pass; the PAGE is right from
 * the first paint regardless, because the head script set it, so the only thing that
 * can lag is which radio is drawn checked.
 */
export function useTheme(): {
  preference: ThemePreference;
  theme: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
} {
  const value = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
  return { ...parseSnapshot(value), setPreference: writePreference };
}

/**
 * Mounted once, in the root layout. Renders nothing.
 *
 * It applies the store's own value — never a hook's snapshot, which during hydration
 * is the server's Light and would flash a Night reader back to cream — and keeps
 * listening, so a choice made in another tab, or the device switching under System,
 * reaches this page even when no switch is on screen.
 *
 * The apply-on-mount also undoes React's development-only Strict Mode remount, which
 * resets `<html>` to the attributes JSX manages and drops the one the head script set.
 * In production it is a no-op.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme(readPreference());
    return subscribe(() => {});
  }, []);
  return null;
}

/** A thumbnail of each choice: the page colour it gives, split for System. */
function Thumbnail({ value }: { value: ThemePreference }) {
  const background =
    value === "system"
      ? `linear-gradient(135deg, ${THEME_COLOR.light} 50%, ${THEME_COLOR.dark} 50%)`
      : THEME_COLOR[value];
  return (
    <span
      aria-hidden="true"
      className="border-line size-4 shrink-0 rounded-md border-2"
      style={{ background }}
    />
  );
}

/**
 * The choice as a radio group: Light, Dark, System.
 *
 * Real `<input type="radio">`s in a `<fieldset>`, visually hidden inside labels drawn
 * as buttons. A native group is keyboard-complete for free — Tab enters on the checked
 * option, the arrow keys move AND select, Space selects — and a screen reader announces
 * "radio button, 2 of 3, checked". The checked option is pressed in, the way a selected
 * tab is (`ui/tabs.tsx`), so the state is in the position as well as the colour. The
 * focus ring is drawn on the label, because the input itself is not visible
 * (`focus-ring-within` in `globals.css`).
 */
export function ThemeSwitch({
  className,
  legend = "Theme",
  showLegend = true,
}: {
  className?: string;
  legend?: string;
  /** The legend is always the group's accessible name; this only decides whether it is seen. */
  showLegend?: boolean;
}) {
  const { preference, theme, setPreference } = useTheme();
  const name = useId();
  const hintId = useId();

  return (
    <fieldset className={cn("min-w-0", className)} aria-describedby={hintId}>
      <legend className={showLegend ? "eyebrow mb-2" : "sr-only"}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {THEME_CHOICES.map((choice) => {
          const checked = preference === choice.value;
          return (
            <label
              key={choice.value}
              className={cn(
                "btn focus-ring-within relative cursor-pointer",
                checked
                  ? "btn-primary translate-x-[2px] translate-y-[2px] shadow-(--shadow-press)"
                  : "btn-quiet",
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={checked}
                onChange={() => setPreference(choice.value)}
                className="sr-only"
              />
              <Thumbnail value={choice.value} />
              {choice.label}
            </label>
          );
        })}
      </div>
      <p id={hintId} className="text-muted mt-2 text-2xs text-pretty">
        {preference === "system"
          ? `Following this device — ${THEME_LABEL[theme]} right now.`
          : THEME_CHOICES.find((c) => c.value === preference)?.hint}{" "}
        Kept in this browser only.
      </p>
    </fieldset>
  );
}
