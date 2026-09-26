import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

/**
 * Form controls: the quiet register of the system.
 *
 * `BUILD_PLAN.md` Phase 14 is explicit that "a cartoon look earns goodwill on the
 * landing page and gets in the way in a settings form". These are the settings
 * form. They keep the thick outline and the fat radius, because those are what make
 * the language coherent, and they drop the hard shadow and the squish, because a
 * text input is a hole in the page rather than an object on it. The `field` utility
 * expresses that with an INSET shadow — the one place in the system the light comes
 * from the other direction, so a well and a button can never be confused.
 */

/**
 * A labelled control. The label is a real `<label>` wrapping the child, so there is
 * no id to wire up and no way to ship an unlabelled input by forgetting one.
 *
 * `hint` is described rather than labelled: `aria-describedby` would need an id, so
 * instead the hint sits inside the same `<label>`, which screen readers read as part
 * of the accessible name. That is slightly verbose and never silently missing.
 */
export function Labelled({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-ui block font-semibold">{label}</span>
      {hint && <span className="text-muted text-2xs block">{hint}</span>}
      {children}
      {error && (
        <span className="text-bad text-2xs animate-wiggle block font-semibold">{error}</span>
      )}
    </label>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn("field", className)} {...rest} />;
}

export function Textarea({ className, rows = 4, ...rest }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn("field resize-y", className)} {...rest} />;
}

/**
 * A native `<select>`, deliberately. A hand-rolled listbox is the single most
 * commonly broken "accessible" component on the web — typeahead, Home/End, screen
 * reader modes and a phone's native picker all come free here and all have to be
 * rebuilt otherwise. The cost is that the open list is drawn by the OS and cannot
 * be Toybox; the closed control, which is what a user looks at, can be.
 *
 * `appearance-none` plus a background chevron rather than a positioned span, so the
 * arrow cannot drift out of alignment when the control is resized.
 */
export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "field cursor-pointer appearance-none bg-[length:0.7rem] bg-[right_0.75rem_center] bg-no-repeat pr-9",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5l5-5' fill='none' stroke='%23131722' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

/**
 * A checkbox and a switch, both from a real `<input type="checkbox">`.
 *
 * The class lists are constants because three components render them — the two bare
 * controls below and `Toggle`, which is what a call site normally wants.
 *
 * The checkbox tick is drawn with the element's own borders rather than a background
 * image, because a background image cannot inherit `currentColor` and the tick has to
 * stay ink when the box fills with grape.
 */
const CHECKBOX_CLASS = [
  "border-line squish size-5 shrink-0 cursor-pointer appearance-none rounded-md border-2",
  "bg-sunken shadow-flat checked:bg-accent-pop",
  "after:mt-[1px] after:ml-[5px] after:block after:h-[9px] after:w-[5px] after:rotate-45",
  "after:border-ink after:border-r-2 after:border-b-2 after:opacity-0 after:transition-opacity",
  "checked:after:opacity-100",
].join(" ");

const SWITCH_CLASS = [
  "border-line bg-sunken shadow-flat relative h-6 w-11 shrink-0 cursor-pointer",
  "appearance-none rounded-full border-2 transition-colors checked:bg-ok-pop",
  "after:bg-elevated after:border-line after:absolute after:top-[2px] after:left-[2px]",
  "after:size-4 after:rounded-full after:border-2 after:transition-transform",
  "after:duration-(--dur) after:ease-(--ease-spring) checked:after:translate-x-5",
].join(" ");

export function Checkbox({ className, ...rest }: ComponentProps<"input">) {
  return <input type="checkbox" className={cn(CHECKBOX_CLASS, className)} {...rest} />;
}

/**
 * A switch. The same native checkbox with `role="switch"`, because the semantics a
 * screen reader needs are "on/off", not "checked".
 */
export function Switch({ className, ...rest }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      /* oxlint-disable-next-line jsx-a11y/role-has-required-aria-props --
         The rule is wrong for this element. ARIA in HTML explicitly allows
         `role="switch"` on `input[type=checkbox]`, and the HTML-AAM mapping makes the
         element's own `checked` state the accessible checked state — so `aria-checked`
         here would be a SECOND source of truth this uncontrolled input could not keep
         in sync, which is worse than absent. */
      role="switch"
      className={cn(SWITCH_CLASS, className)}
      {...rest}
    />
  );
}

/**
 * A labelled toggle — what a call site almost always wants.
 *
 * It exists so the `<input>` sits literally inside the `<label>` in the JSX. Wrapping
 * `<Checkbox>` in a `<label>` at the call site is equally correct at runtime and
 * cannot be seen through a component boundary by a linter or a reviewer, so every
 * such site would need a suppression. One component, no suppressions, and a toggle
 * can never ship unlabelled by accident.
 */
export function Toggle({
  label,
  kind = "checkbox",
  className,
  ...rest
}: ComponentProps<"input"> & { label: ReactNode; kind?: "checkbox" | "switch" }) {
  return (
    <label className={cn("text-ui flex items-center gap-2.5 font-semibold", className)}>
      <input
        type="checkbox"
        role={kind === "switch" ? "switch" : undefined}
        aria-checked={kind === "switch" ? rest.checked : undefined}
        className={kind === "switch" ? SWITCH_CLASS : CHECKBOX_CLASS}
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}
