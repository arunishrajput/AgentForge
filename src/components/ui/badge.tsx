import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

/**
 * A badge. Three registers, and the choice is a measured one rather than a stylistic
 * one.
 *
 *   `quiet`    the recessed pill, with the tone carried by the TEXT. This is the
 *              default, and it is the default because a tone tinting its own
 *              background cannot carry red at AA — the Chapter 1 measurement that
 *              `tokens.test.ts` still asserts
 *   `outline`  no fill at all: an outlined pill in `ink`, standing out by its outline
 *              and its weight. Phase 28 — see below
 *   `pop`      a bright fill with the `accent-ink` label. Loud, and legible, but it
 *              spends the colour on the fill, so the label can no longer mean anything
 *              by hue. **The fill is required**, and the type says so
 *
 * **Why `pop` demands its `fill`.** Seven badges — "private", "public link" and
 * "switched off" on a workflow card, a workspace's member count and a member's role, the
 * share page's "shared read-only", the invitation's "Invitation" — were `tone="pop"`
 * with no fill from Phase 19B on. `chip-pop` sets the near-black label a fill needs and
 * no fill of its own, so each drew a near-black word on whatever was behind it. On cream
 * that read as a deliberate outlined pill; on Toybox Night's indigo it measured **1.06:1
 * — an empty capsule**. Found in Phase 28 by a contrast audit of the signed-in pages; no
 * token gate could see it, because every token pair was legal and the component paired
 * the wrong two. Those seven are `outline` now, which renders exactly as they always did
 * in Light, and a `pop` badge without a `fill` no longer typechecks.
 *
 * `icon` is for a shape alongside the colour. Status must never be carried by
 * colour alone — `DESIGN.md` → *Never colour alone* — and on a badge the shape is
 * how that rule is kept.
 */
type Register =
  | { tone?: "quiet" | "outline"; fill?: never }
  | {
      tone: "pop";
      /** The `bg-*-pop` class the label sits on. */
      fill: string;
    };

const REGISTER = {
  quiet: "chip",
  // `chip`'s recess taken away and the label named, the way a neutral object on a fill
  // names its own (`DESIGN.md` → *Traps*). `ink` is `accent-ink` in Light — the same
  // near-black these badges always rendered — and cream in Night.
  outline: "chip bg-transparent text-ink",
  pop: "chip-pop",
} as const;

export function Badge({
  tone = "quiet",
  fill,
  icon,
  className,
  children,
  ...rest
}: Omit<ComponentProps<"span">, "children"> & {
  icon?: ReactNode;
  children?: ReactNode;
} & Register) {
  return (
    <span className={cn(REGISTER[tone], fill, className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
