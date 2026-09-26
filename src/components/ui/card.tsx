import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

/**
 * A card. Two elevations, and the difference is what the thing IS:
 *
 *   `flat`    a region of the page — a settings section, a list item
 *   `raised`  an object on the page — a node, a popover, a dialog
 *
 * Both carry the ink outline. In Toybox the outline is what separates an object
 * from its background, not a difference in lightness: the surfaces are within a few
 * percent of each other on purpose (`tokens.test.ts` asserts that ordering and
 * refuses to assert a large step). Taking the outline off a card does not make it
 * subtle, it makes it invisible.
 */
export function Card({
  raised = false,
  className,
  children,
  ...rest
}: ComponentProps<"div"> & { raised?: boolean }) {
  return (
    <div className={cn(raised ? "card-raised" : "card", className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * A card's header strip, optionally in a category or status colour.
 *
 * The strip is the one piece of chrome allowed to use a `-pop` fill across a wide
 * area, and it is where a node card will carry its category in Phase 16. Its label
 * is always ink — every pop fill in the palette clears AA against ink, which
 * `tokens.test.ts` asserts, and none of them clears it against white.
 */
export function CardHeader({
  title,
  aside,
  fill,
  className,
  ...rest
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  aside?: ReactNode;
  /** A `bg-*-pop` class. Omitted, the strip is paper. */
  fill?: string;
}) {
  return (
    <div
      className={cn(
        "border-line flex items-center justify-between gap-3 border-b-2 px-4 py-2.5",
        fill ? `${fill} text-ink` : "bg-surface",
        className,
      )}
      {...rest}
    >
      <span className="text-ui truncate font-bold">{title}</span>
      {aside}
    </div>
  );
}
