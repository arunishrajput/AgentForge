"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/components/ui/cn";

/**
 * The shell both side panels wear, and the phase's answer to the layout problem.
 *
 * `BUILD_PLAN.md` Phase 16 states the constraint in measured terms: two 280px side
 * panels leave an 880px canvas at 1440px, which forces `fitView` to 0.39 and draws a
 * 224px node card at 88px — legible on a laptop, not on a projector. It also warns
 * that chunkier cards make that *worse*, so the phase "must solve the layout,
 * probably with collapsible panels, not just restyle the cards."
 *
 * This is that. **Collapsed, a panel leaves a 40px rail instead of a 240–320px
 * column**, so the canvas at 1440px goes from 880px to ~1360px and the same graph
 * lands near 0.6 zoom rather than 0.39. The rail is the important half of the idea:
 * a panel that collapses to *nothing* is a panel the user cannot find again, and a
 * canvas with no visible way back to the node list is a worse product than a
 * cramped one. The rail is a real button, carries the panel's name, and reports
 * `aria-expanded` — so the keyboard and a screen reader get the same affordance.
 *
 * **Two breakpoints, two independent behaviours, and no viewport measurement.**
 * CSS decides which is in play, never JavaScript, so there is nothing to mismatch
 * between the server render and the browser:
 *
 *   below `lg`   a drawer over the canvas, in or out by `open`. Three fixed columns
 *                do not fit a 375px screen and the canvas is the part that must
 *                survive. `collapsed` is irrelevant here.
 *   `lg` and up  a column beside the canvas, full or railed by `collapsed`.
 *                `open` is irrelevant here.
 *
 * `max-lg:invisible` rather than `hidden` on the closed drawer, because `visibility`
 * takes a closed drawer out of the tab order while still letting the panel slide
 * rather than blink.
 */
export function Panel({
  id,
  side,
  title,
  width,
  open,
  collapsed,
  onClose,
  onExpand,
  onCollapse,
  header,
  children,
}: {
  id: string;
  side: "left" | "right";
  /** Names the panel in its rail, its heading and its two buttons. */
  title: string;
  /** The column width at `lg` and up, as a Tailwind class. */
  width: string;
  /** Drawer state, below `lg`. */
  open: boolean;
  /** Column state, at `lg` and up. */
  collapsed: boolean;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  /** Rendered inside the panel's own heading row, beside the title. */
  header?: ReactNode;
  children: ReactNode;
}) {
  const left = side === "left";

  return (
    <>
      {/* The rail. `lg` and up only — below that the drawer's own toggle in the
          canvas header is the way in, and a rail would eat 40px of a 375px screen. */}
      {collapsed && (
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={false}
          aria-controls={id}
          className={cn(
            "border-line bg-surface hover:bg-canvas text-muted hover:text-ink hidden w-10 shrink-0 cursor-pointer flex-col items-center gap-2 py-3 transition-colors lg:flex",
            left ? "border-r-2" : "border-l-2",
          )}
        >
          <span aria-hidden="true" className="text-xs leading-none font-bold">
            {left ? "»" : "«"}
          </span>
          <span className="text-2xs font-bold tracking-wide [writing-mode:vertical-rl]">
            {title}
          </span>
        </button>
      )}

      <aside
        id={id}
        aria-label={title}
        className={cn(
          "border-line bg-canvas flex shrink-0 flex-col transition-[transform,visibility] duration-200 ease-out",
          "max-lg:fixed max-lg:inset-y-0 max-lg:z-30 max-lg:shadow-drawer",
          left
            ? "border-r-2 max-lg:left-0 max-lg:w-[min(19rem,85vw)]"
            : "border-l-2 max-lg:right-0 max-lg:w-[min(23rem,90vw)]",
          width,
          open
            ? "max-lg:translate-x-0"
            : cn("max-lg:invisible", left ? "max-lg:-translate-x-full" : "max-lg:translate-x-full"),
          // At `lg` and up the rail above stands in for the whole column.
          collapsed && "lg:hidden",
        )}
      >
        <div className="border-line flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5">
          <h2 className="text-ui min-w-0 flex-1 truncate font-bold">{title}</h2>
          {header}
          <button
            type="button"
            onClick={onCollapse}
            aria-expanded
            aria-controls={id}
            className="btn btn-ghost shrink-0 px-2 py-1 max-lg:hidden"
          >
            <span aria-hidden="true" className="text-xs leading-none font-bold">
              {left ? "«" : "»"}
            </span>
            <span className="sr-only">Collapse {title.toLowerCase()}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost shrink-0 px-2 py-1 lg:hidden"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              ✕
            </span>
            <span className="sr-only">Close {title.toLowerCase()}</span>
          </button>
        </div>

        {children}
      </aside>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Whether a panel is railed, remembered across visits.

   Someone who works on a laptop collapses the palette once and wants it collapsed
   every time; someone on a large display never touches it. A preference is the only
   honest answer to that, and it is per-panel because the two are not one choice.

   `useSyncExternalStore` rather than `useState` plus an effect, and that is the
   whole design of what follows. `localStorage` is an external store, and the two
   obvious alternatives are both wrong:

     reading it in a `useState` initialiser  disagrees with the HTML the server
                                             already sent — a hydration mismatch,
                                             which this project has hit before
     reading it in an effect and setting     a cascading render, and the thing
     state                                   `react/set-state-in-effect` exists
                                             to catch

   `getServerSnapshot` returns the fallback, so the server's HTML and the first
   client render always agree; React then reads the real value and re-renders once,
   which is exactly the handshake the API is for.

   Every access is guarded. `localStorage` throws outright in a Safari private
   window and when site data is blocked, and a canvas that would not load because a
   *panel preference* could not be read would be an absurd way to lose the product.
   `memory` is why a blocked store still leaves a working button rather than a dead
   one: the preference stops surviving the visit, and nothing else changes.
   --------------------------------------------------------------------------- */

/** Last resort when `localStorage` is unreachable. Lives as long as the tab. */
const memory = new Map<string, boolean>();

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // `storage` fires for writes from OTHER tabs; same-tab writes go through
  // `notify`. Together they mean two tabs on one canvas agree about the layout.
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function read(key: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Unreachable store. Fall through to whatever this tab has been told.
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: boolean) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // The preference will not survive the visit. The panel still works.
  }
  notify();
}

export function useCollapsed(
  key: string,
  fallback = false,
): [boolean, (next: boolean) => void] {
  const storageKey = `agentforge:canvas:${key}`;

  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(storageKey) ?? fallback,
    () => fallback,
  );

  const set = useCallback((next: boolean) => write(storageKey, next), [storageKey]);

  return [collapsed, set];
}
