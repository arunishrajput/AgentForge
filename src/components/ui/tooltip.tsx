"use client";

import { type ReactNode, useEffect, useId, useState } from "react";

import { cn } from "./cn";

/**
 * A tooltip.
 *
 * Deliberately a small amount of JavaScript rather than a pure CSS `group-hover`
 * trick, for one reason: WCAG 2.1.4 requires content that appears on hover or focus
 * to be dismissible without moving the pointer, and CSS cannot hear Escape.
 *
 * It shows on hover AND on keyboard focus — a tooltip only reachable by pointer is
 * decoration, not help — and it is wired with `aria-describedby`, so the text is
 * read as a description of the control rather than as a second label.
 *
 * A tooltip is never the only place information lives. `DESIGN.md` → *When not to
 * use a tooltip*: if a control needs explaining in order to be used, the
 * explanation belongs on the page.
 */
export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "card-raised animate-pop text-2xs pointer-events-none absolute left-1/2 z-40",
            "-translate-x-1/2 px-2 py-1 font-semibold whitespace-nowrap",
            side === "top" ? "bottom-[calc(100%+0.6rem)]" : "top-[calc(100%+0.6rem)]",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
