"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "./cn";
import { TONE, liveRole, type Tone } from "./tone";

/**
 * Toasts.
 *
 * Three rules shape this, and all three are accessibility rather than taste:
 *
 *   1. The live region is rendered ALWAYS, empty, not created when the first toast
 *      arrives. A screen reader only announces changes to a live region it was
 *      already observing, so a region that appears together with its first message
 *      announces nothing — the single most common way a toast system is silently
 *      broken for the people who need it most.
 *   2. An error is `role="alert"` (assertive); everything else is `status`
 *      (polite). A failure interrupts, a "saved" does not.
 *   3. Every toast has a close button and a generous default life. WCAG 2.2.1
 *      wants the user in control of a timed message; `duration: null` keeps one up
 *      until it is dismissed, which is what a failure worth acting on should do.
 */
/** The tone table is shared with `Notice` — see `./tone.ts`. */
export type ToastTone = Tone;

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
};

type ToastInput = Omit<Toast, "id"> & { duration?: number | null };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/**
 * `useToast()` returns the push function. It throws outside a provider rather than
 * no-opping: a toast that silently does not appear is a bug that survives review.
 */
export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast() needs a <ToastProvider> above it");
  return push;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    ({ duration = 6000, ...toast }: ToastInput) => {
      const id = next.current++;
      setToasts((current) => [...current, { ...toast, id }]);
      if (duration !== null) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  // A stable identity, so a consumer's `useCallback` deps do not churn every render.
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Rendered unconditionally — see rule 1 above. `pointer-events-none` on the
          stack with `pointer-events-auto` on each toast, so the empty region never
          swallows a click on whatever is underneath it. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TONE[toast.tone];
  return (
    <div
      role={liveRole(toast.tone)}
      className={cn(
        "card-raised animate-rise pointer-events-auto flex w-[min(26rem,calc(100vw-2rem))] items-start gap-3 p-3",
        toast.tone === "bad" && "animate-wiggle",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "border-line text-accent-ink grid size-6 shrink-0 place-items-center rounded-lg border-2 text-xs font-bold",
          tone.fill,
        )}
      >
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1">
        {/* The tone is in the text as well as the fill, for anyone who cannot see
            the colour and for the live-region announcement. */}
        <p className="text-ui font-bold">
          <span className="sr-only">{tone.label}: </span>
          {toast.title}
        </p>
        {toast.detail && <p className="text-muted text-2xs mt-0.5">{toast.detail}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="btn btn-ghost -mt-1 -mr-1 shrink-0 px-1.5 py-1"
      >
        <span aria-hidden="true" className="text-sm leading-none">
          ×
        </span>
      </button>
    </div>
  );
}
