import type { ComponentProps } from "react";

import { cn } from "./cn";

/**
 * The Toybox button.
 *
 * Five registers, and the loudness is the whole distinction:
 *
 *   `ink`      solid near-black. The single strongest action on a screen
 *   `primary`  the grape pop fill. The expected action
 *   `quiet`    paper fill, ink outline. Everything else
 *   `ghost`    no outline, no shadow. Toolbars and icon rows, where a row of
 *              outlined objects would read as a fence
 *   `danger`   the coral pop fill. Destructive, and only destructive
 *
 * Every register but `ghost` is an outlined object sitting on a hard ink shadow,
 * and presses INTO the page: it travels down-right by exactly the shadow offset it
 * loses, so the far corner of the shadow stays put and the object appears to move.
 * That gesture lives in the `btn` utility in `globals.css` rather than here, so a
 * plain `<button className="btn btn-primary">` in a Chapter 1 screen behaves
 * identically to this component.
 *
 * `loading` sets `aria-busy` and disables the button without setting `disabled`,
 * because a `disabled` button loses its accessible name from some screen readers
 * mid-announcement and drops out of the tab order under the user's cursor. It uses
 * `aria-disabled` plus a click guard instead.
 */
export type ButtonTone = "ink" | "primary" | "quiet" | "ghost" | "danger";

const TONE: Record<ButtonTone, string> = {
  ink: "btn-ink",
  primary: "btn-primary",
  quiet: "btn-quiet",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

const SIZE = {
  sm: "px-2.5 py-1 text-2xs",
  md: "",
  lg: "px-5 py-2.5 text-sm",
} as const;

export type ButtonProps = Omit<ComponentProps<"button">, "aria-disabled"> & {
  tone?: ButtonTone;
  size?: keyof typeof SIZE;
  loading?: boolean;
};

export function Button({
  tone = "quiet",
  size = "md",
  loading = false,
  className,
  children,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={cn("btn", TONE[tone], SIZE[size], className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/**
 * The waiting indicator: three dots that bob, not a rotating ring. A spinner is
 * the one motion every product shares, and this system is meant to be recognisable
 * — `DESIGN.md` → *Motion*. `aria-hidden`, because `aria-busy` on the button is
 * what actually carries the state.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center gap-0.5", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-think size-1 rounded-full bg-current"
          style={{ animationDelay: `${i * 130}ms` }}
        />
      ))}
    </span>
  );
}
