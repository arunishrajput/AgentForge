"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { Button } from "./button";
import { cn } from "./cn";

/**
 * A modal dialog, built on the native `<dialog>` element and `showModal()`.
 *
 * That choice buys four things this project is not going to hand-roll better: the
 * focus trap, Escape to close, the inert background (the browser makes everything
 * behind it unreachable to the pointer, the keyboard AND the accessibility tree),
 * and the top layer, which means no z-index arithmetic anywhere in the app.
 *
 * What it costs is that `open` cannot be a declarative prop — an `open` attribute
 * produces a NON-modal dialog with none of the above, so the element has to be
 * driven imperatively from an effect. That is the one piece of ceremony here.
 *
 * Two details that are easy to get wrong and are handled:
 *
 *   - `<dialog>` fires `cancel` on Escape and `close` when it closes for any
 *     reason. Only `close` is listened to, so every exit path reports once.
 *   - clicking the backdrop does nothing by default. The click handler compares
 *     the target to the dialog itself, which is true only for the backdrop,
 *     because the panel inside swallows its own clicks.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = () => onClose();
    el.addEventListener("close", handle);
    return () => el.removeEventListener("close", handle);
  }, [onClose]);

  return (
    /* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions --
       Both rules ask for a keyboard equivalent to this click. `<dialog>` already
       has one and the browser provides it: Escape fires `cancel` and then `close`,
       which the effect above listens to. Adding a key handler here would give the
       dialog a second, redundant close path, and `<dialog>` is not in fact a
       non-interactive element. This is a pointer AFFORDANCE for behaviour the
       keyboard already has, which is the case the rules do not model. */
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        // `<dialog>` centres itself in the top layer; `max-h` plus the inner scroll
        // keeps a long dialog usable on a phone in landscape.
        "card-raised animate-pop m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-3rem)] p-0",
        "backdrop:bg-ink/35 open:flex open:flex-col",
        className,
      )}
    >
      <div className="border-line flex items-start justify-between gap-3 border-b-2 px-5 py-3.5">
        <div className="space-y-1">
          <h2 id="dialog-title" className="text-base font-bold">
            {title}
          </h2>
          {description && <p className="text-muted text-2xs">{description}</p>}
        </div>
        <Button
          tone="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close"
          className="-mt-0.5 -mr-1.5 shrink-0"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ×
          </span>
        </Button>
      </div>

      {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}

      {footer && (
        <div className="border-line bg-canvas flex flex-wrap justify-end gap-2 border-t-2 px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
