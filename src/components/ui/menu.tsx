"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { cn } from "./cn";

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

  // Open, then focus the first item. The effect rather than the click handler,
  // because the items do not exist until after the render that opens the menu.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const move = (from: number, delta: number) => {
    const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    const at = enabled.indexOf(from);
    const to = enabled[(at + delta + enabled.length) % enabled.length];
    itemRefs.current[to]?.focus();
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
        className="btn btn-quiet"
      >
        {label}
        <span aria-hidden="true" className="text-3xs">
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
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                item.onSelect();
                close();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") move(index, 1);
                else if (event.key === "ArrowUp") move(index, -1);
                else if (event.key === "Home") move(-1, 1);
                else if (event.key === "End") move(0, -1);
                else if (event.key === "Escape") close();
                else if (event.key === "Tab") close(false);
                else return;
                event.preventDefault();
              }}
              className={cn(
                "text-ui flex w-full items-center rounded-lg px-2.5 py-1.5 text-left font-semibold",
                "transition-colors duration-(--dur-fast)",
                item.disabled && "cursor-not-allowed opacity-45",
                !item.disabled && item.tone === "danger"
                  ? "text-bad hover:bg-bad-pop hover:text-ink"
                  : !item.disabled && "hover:bg-accent-pop hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
