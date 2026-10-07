"use client";

import { useSyncExternalStore } from "react";

import {
  chordLabel,
  chordSpoken,
  chordTokens,
  platformOf,
  type Chord,
  type Platform,
} from "@/lib/ui/keys";

import { cn } from "./cn";

/**
 * Keyboard chords on screen — Phase 29.
 *
 * `usePlatform` is the one place the product asks which keyboard the reader has, so ⌘
 * reaches a Mac and Ctrl reaches everyone else (`lib/ui/keys.ts` says why that matters).
 *
 * It is `useSyncExternalStore` with a server snapshot, for the reason `panel.tsx` gives at
 * length: the server cannot know the platform, so the server's HTML and the first client
 * render both say `apple` — which is also what every page printed before this phase —
 * and React re-renders once with the real answer. Reading `navigator` in a `useState`
 * initialiser would be a hydration mismatch, error #418, which this project has met.
 */

const subscribe = () => () => {};

function readPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return platformOf(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

export function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, readPlatform, () => "apple");
}

/**
 * `font-sans` on every cap: a `<kbd>` is monospace by the browser's own stylesheet, and the
 * outer one's font does not reach the inner ones — "Delete" and "Click" came out in a
 * typewriter face on the deployed `?` card.
 */
const CAP = "border-line inline-grid place-items-center rounded-md border font-sans font-bold";

/**
 * One chord as keycaps: a `<kbd>` per key inside a `<kbd>` for the whole, which is the
 * HTML spec's own markup for a key combination. `joined` draws the chord as one cap —
 * `⌘K` on a button, where two caps would be fussier than the button they sit on.
 *
 * The caps are hidden from assistive technology and the chord is spoken in words
 * instead (`chordSpoken`): "Command K", never "place of interest sign K".
 */
export function Keys({
  chord,
  platform,
  joined = false,
  className,
}: {
  chord: Chord;
  platform: Platform;
  joined?: boolean;
  className?: string;
}) {
  const caps = joined ? [chordLabel(chord, platform)] : chordTokens(chord, platform);
  return (
    <kbd className={cn("inline-flex items-center gap-0.5 font-sans", className)}>
      <span className="sr-only">{chordSpoken(chord, platform)}</span>
      {caps.map((cap) => (
        <kbd
          key={cap}
          aria-hidden="true"
          // A cap of its own is read at arm's length, so it is a size up from the ⌘K
          // button's, where the cap sits inside a label and must not outgrow it.
          className={cn(
            CAP,
            joined ? "bg-sunken text-3xs px-1 py-px" : "bg-surface text-ink text-2xs min-w-6 px-1.5 py-0.5",
          )}
        >
          {cap}
        </kbd>
      ))}
    </kbd>
  );
}
