import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

/**
 * A badge. Two registers again, and here the choice is a measured one rather than
 * a stylistic one.
 *
 *   `quiet`  the recessed cream pill, with the tone carried by the TEXT. This is
 *            the default, and it is the default because a tone tinting its own
 *            background cannot carry red at AA — the Chapter 1 measurement that
 *            `tokens.test.ts` still asserts
 *   `pop`    a bright fill with an ink label. Loud, and legible, but it spends the
 *            colour on the fill, so the label can no longer mean anything by hue
 *
 * `icon` is for a shape alongside the colour. Status must never be carried by
 * colour alone — `DESIGN.md` → *Never colour alone* — and on a badge the shape is
 * how that rule is kept.
 */
export function Badge({
  tone = "quiet",
  icon,
  className,
  children,
  ...rest
}: ComponentProps<"span"> & {
  tone?: "quiet" | "pop";
  icon?: ReactNode;
}) {
  return (
    <span className={cn(tone === "pop" ? "chip-pop" : "chip", className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
