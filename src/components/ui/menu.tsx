"use client";

import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { cn } from "./cn";
import { firstFocusable, lastFocusable, stepFocus } from "./menu-focus";

/**
 * A dropdown menu.
 *
 * Hand-rolled rather than built on the native `popover` attribute, and the reason is
 * positioning: `popover` promotes the element to the top layer, where it no longer
 * sits inside a `relative` parent, so anchoring it to its button needs CSS anchor
 * positioning — which is not yet something to rely on across the browsers this has
 * to work in. An absolutely positioned list in a relative wrapper works everywhere,
 * and the behaviours `popover` would have given for free are the ones below.
 *
 * What is implemented, because a menu without it is a mouse-only menu:
 *
 *   - Down/Up moves between items and wraps; Home/End jump
 *   - opening with the keyboard focuses the first item, opening with Enter on the
 *     button does the same, and Escape closes and returns focus to the button
 *   - a click anywhere outside closes it (pointerdown, so it fires before a click
 *     on another control is lost)
 *   - `aria-haspopup` / `aria-expanded` on the button, `role="menu"` on the list
 */
export type MenuItem = {
  /** A stable identity. Required rather than optional: keying a menu on its index
      re-mounts every item below a removed one, which drops focus mid-keyboard-walk. */
  id: string;
  label: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  /**
   * Set — `true` or `false` — and the item is a `menuitemradio` reporting
   * `aria-checked`, one of a set where exactly one is chosen (the theme, Phase 27).
   * Left out, it is an ordinary `menuitem`.
   */
  checked?: boolean;
  /**
   * Consecutive items sharing a `group` are wrapped in a `role="group"` named by it,
   * with the name shown above them. A radio set needs it: "Dark, checked" means
   * nothing without "Theme" around it.
   */
  group?: string;
};

export function Menu({
  label,
  items,
  className,
  panelClassName,
  align = "start",
}: {
  label: ReactNode;
  items: MenuItem[];
  className?: string;
  /**
   * Classes for the open panel, which sizes itself to its content and can therefore run
   * off a narrow screen. The workspace switcher sits a third of the way across a 375 px
   * header, so its panel needs a cap the account menu — anchored to the right edge —
   * does not. Measured in a browser rather than guessed: it overflowed by 63 px.
   */
  panelClassName?: string;
  align?: "start" | "end";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  // Open, then focus the first item that can take focus — not item 0, which in the
  // account menu is a disabled address that refuses it (`menu-focus.ts`, Phase 28). The
  // effect rather than the click handler, because the items do not exist until after
  // the render that opens the menu.
  useEffect(() => {
    if (!open) return;
    const first = firstFocusable(items);
    if (first !== null) itemRefs.current[first]?.focus();
    // `items` is deliberately not a dependency: a parent re-rendering with a new array
    // while the menu is open must not pull focus back to the top mid-walk.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const focusItem = (index: number | null) => {
    if (index !== null) itemRefs.current[index]?.focus();
  };

  return (
    <div ref={wrap} className={cn("relative inline-flex", className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            setOpen(true);
            event.preventDefault();
          }
        }}
        /**
         * **`min-w-0` — Phase 22, and it fixes a latent bug rather than a cosmetic one.**
         *
         * A flex child's `min-width` defaults to `auto`, so without this the trigger
         * refuses to shrink below its own content and simply **overflows its wrapper**,
         * drawing on top of whatever sits next to it. The workspace switcher passes this
         * component a `max-w-[16rem]` and a label that truncates, intending exactly that
         * squeeze; it could not happen, and the overflow only became visible when the
         * shell header gained a third navigation link and the bar ran out of room.
         *
         * `min-w-0` here means the trigger shrinks when — and only when — a parent
         * constrains it. Every other menu in the product sits in an unconstrained parent
         * and is unaffected.
         */
        className="btn btn-quiet min-w-0"
      >
        {label}
        <span aria-hidden="true" className="text-3xs shrink-0">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={id}
          role="menu"
          aria-label={typeof label === "string" ? label : undefined}
          className={cn(
            "card-raised animate-pop absolute top-[calc(100%+0.5rem)] z-40 min-w-48 p-1.5",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {segments(items).map((segment) => {
            const rows = segment.items.map(({ item, index }) => (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  item.onSelect();
                  close();
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") focusItem(stepFocus(items, index, 1));
                  else if (event.key === "ArrowUp") focusItem(stepFocus(items, index, -1));
                  else if (event.key === "Home") focusItem(firstFocusable(items));
                  else if (event.key === "End") focusItem(lastFocusable(items));
                  else if (event.key === "Escape") close();
                  else if (event.key === "Tab") close(false);
                  else return;
                  event.preventDefault();
                }}
                className={cn(
                  "text-ui flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-semibold",
                  "transition-colors duration-(--dur-fast)",
                  item.disabled && "cursor-not-allowed opacity-45",
                  !item.disabled && item.tone === "danger"
                    ? "text-bad hover:bg-bad-pop hover:text-accent-ink"
                    : !item.disabled && "hover:bg-accent-pop hover:text-accent-ink",
                )}
              >
                {/* The chosen one is marked with a glyph as well as `aria-checked`,
                    so the state is not carried by an attribute a sighted reader never
                    sees. The slot is kept for the others, so the labels line up. */}
                {item.checked !== undefined && (
                  <span aria-hidden="true" className="w-3 shrink-0 text-center text-2xs">
                    {item.checked ? "●" : ""}
                  </span>
                )}
                {item.label}
              </button>
            ));

            return segment.group ? (
              <div
                key={`group:${segment.group}`}
                role="group"
                aria-label={segment.group}
                className="border-line-soft my-1 border-y py-1 first:mt-0 first:border-t-0 first:pt-0 last:mb-0 last:border-b-0 last:pb-0"
              >
                <div aria-hidden="true" className="eyebrow px-2.5 pt-1 pb-0.5">
                  {segment.group}
                </div>
                {rows}
              </div>
            ) : (
              <Fragment key={segment.items[0].item.id}>{rows}</Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Runs of consecutive items, split where `group` changes. The index each item had in
 * the flat list is kept, because the keyboard walk is over the flat list — a group is
 * a heading drawn around some items, not a second level to navigate.
 */
function segments(items: MenuItem[]) {
  const out: { group?: string; items: { item: MenuItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = out.at(-1);
    if (last && last.group === item.group) last.items.push({ item, index });
    else out.push({ group: item.group, items: [{ item, index }] });
  });
  return out;
}
