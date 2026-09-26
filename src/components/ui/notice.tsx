import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";
import { TONE, liveRole, type Tone } from "./tone";

/**
 * An inline message: the anchored half of what a toast does transiently.
 *
 * It exists because Chapter 1 wrote this shape by hand in five places, each time as
 * a translucent tint plus a hairline ring (`bg-bad/10 ring-bad/25 ring-1`). That is
 * a dark-UI idiom — a tint only separates from its background when the background
 * is dark — and on cream it reads as a smudge. Toybox separates an object from the
 * page with an outline and a hard shadow, so this is an outlined card with a
 * pop-filled icon chip, and the tone is carried by the chip and the word rather
 * than by washing the whole panel in colour.
 *
 * Which of the two to reach for: a **toast** for the result of something the user
 * just did anywhere on the page, a **notice** for something about a specific
 * region — a form that cannot be submitted, a workflow that was built with gaps.
 * A notice stays until the state it describes changes, which is why it has no
 * dismiss button.
 */
export function Notice({
  tone = "info",
  title,
  action,
  className,
  children,
  ...rest
}: Omit<ComponentProps<"div">, "title"> & {
  tone?: Tone;
  title: ReactNode;
  /** A button or link that resolves the message. Rendered after the body. */
  action?: ReactNode;
}) {
  const meta = TONE[tone];

  return (
    <div
      role={liveRole(tone)}
      className={cn(
        "card animate-rise flex items-start gap-3 p-3.5",
        // The failure shake, from the motion vocabulary. Deliberately small and
        // short — it says "look here", not "your work is gone".
        tone === "bad" && "animate-wiggle",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "border-line text-ink grid size-6 shrink-0 place-items-center rounded-lg border-2 text-xs font-bold",
          meta.fill,
        )}
      >
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-ui font-bold">
          {/* The tone in words, for the live-region announcement and for anyone who
              cannot see the fill. */}
          <span className="sr-only">{meta.label}: </span>
          {title}
        </p>
        {children && <div className="text-muted text-2xs space-y-1">{children}</div>}
        {action}
      </div>
    </div>
  );
}
