"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import { api, type Inbox, type InboxEntry } from "@/lib/canvas/client";
import { formatUtcShort } from "@/lib/format/date";
import { badgeCount, bellLabel, entryTitle } from "@/lib/inbox/words";

/**
 * **The inbox — Phase 37** (D177, `DESIGN.md` → *The inbox*).
 *
 * A bell in the header with the number of unread entries, and a panel of the newest: each a failed
 * run of a workflow the reader may see, that nobody was watching when it failed. **It never asks the
 * server for anything on its own.** The page hands it the inbox it read while rendering, and the
 * only requests it makes are the ones a person causes — opening an entry, *Mark all read* — whose
 * answer is the inbox as the server now has it. A failure that happens while somebody is reading a
 * page is in the bell on their next navigation; that is the zero-cost rule, said out loud.
 *
 * **A disclosure, not a menu**: the panel holds a heading, links and a button, and a person Tabs
 * through it. Escape closes it and returns focus to the bell, as do a click outside and following an
 * entry. The badge is never the only place the number is: the bell's name says it in words.
 */
export function InboxBell({ initial }: { initial: Inbox }) {
  const router = useRouter();
  const panelId = useId();
  const headingId = useId();
  const [inbox, setInbox] = useState(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);

  // A navigation renders the header again with a fresh read; take it — adjusted while rendering,
  // React's own pattern for state that follows a prop, rather than an effect that renders twice.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setInbox(initial);
  }

  // Focus stays on the bell when it opens — the disclosure pattern: the panel follows it in the
  // document, so the next Tab is the panel's first control.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape from the bell or from anywhere in the panel closes it and hands focus back to the bell.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !wrap.current?.contains(document.activeElement)) return;
      event.preventDefault();
      setOpen(false);
      bell.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** Mark read, take the server's inbox, and never let a failed write stop somebody reading. */
  const mark = async (which: { ids: string[] } | { all: true }) => {
    try {
      const { marked: _marked, ...next } = await api.markInboxRead(which);
      setInbox(next);
    } catch {
      // The entry still opens; it stays unread until the next try. Nothing here is worth an error.
    }
  };

  const openEntry = async (entry: InboxEntry, event: React.MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window is somebody keeping the inbox open: leave the link to the browser.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setOpen(false);
    // Marked before the next page renders the header, so that header reads it as read.
    if (!entry.read) await mark({ ids: [entry.id] });
    router.push(hrefOf(entry));
  };

  const badge = badgeCount(inbox.unread);

  return (
    <div ref={wrap} className="relative inline-flex">
      <button
        ref={bell}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={bellLabel(inbox.unread)}
        onClick={() => setOpen((value) => !value)}
        className="btn btn-quiet relative min-w-0 px-2.5"
      >
        <BellIcon className="size-4" />
        {badge && (
          <span
            aria-hidden="true"
            className="border-line bg-bad-pop text-accent-ink text-3xs absolute -top-2 -right-2 min-w-5 rounded-full border-2 px-1 text-center leading-4 font-bold tabular-nums"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          className={cn(
            "card-raised animate-pop z-40 p-1.5",
            // Anchored to the bell from `sm` up; on a phone the bell sits a third of the way in,
            // so the panel takes the width of the screen less its gutters instead of running off it.
            "fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:top-[calc(100%+0.5rem)] sm:right-0 sm:w-[22rem]",
          )}
        >
          <div className="flex items-baseline gap-2 px-2.5 pt-1.5 pb-2">
            <h2 id={headingId} className="text-sm font-bold">
              Inbox
            </h2>
            <span className="text-muted text-2xs">
              {inbox.unread > 0 ? `${inbox.unread} unread` : "all read"}
            </span>
            {inbox.unread > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await mark({ all: true });
                  setBusy(false);
                }}
                className="text-muted hover:text-ink ml-auto inline-flex min-h-6 items-center text-2xs font-semibold underline decoration-dotted underline-offset-2"
              >
                Mark all read
              </button>
            )}
          </div>

          {inbox.entries.length === 0 ? (
            <div className="border-line-soft border-t px-2.5 py-4">
              <p className="text-sm font-semibold">Nothing needs you</p>
              <p className="text-muted mt-1 text-2xs leading-relaxed text-pretty">
                When a workflow that runs by itself — from a webhook or a schedule — fails, it lands
                here for everybody who can see it.
              </p>
            </div>
          ) : (
            // Positioned, as every scroll container is (D166): an `sr-only` word inside escapes an
            // unpositioned scroller and stretches the page.
            <ul className="border-line-soft relative max-h-[min(24rem,60vh)] overflow-y-auto border-t pt-1">
              {inbox.entries.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={hrefOf(entry)}
                    onClick={(event) => void openEntry(entry, event)}
                    className="hover:bg-canvas flex gap-2 rounded-lg px-2.5 py-2"
                  >
                    {/* Unread is a dot AND bold type AND the word for a screen reader — never the
                        dot alone (`DESIGN.md` → *Never colour alone*). */}
                    <span aria-hidden="true" className={cn("mt-0.5 w-2 shrink-0 text-2xs", entry.read ? "" : "text-bad")}>
                      {entry.read ? "" : "●"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-xs", entry.read ? "text-muted font-medium" : "font-bold")}>
                        {!entry.read && <span className="sr-only">Unread: </span>}
                        {entryTitle(entry)}
                      </span>
                      {entry.detail && (
                        <span className="text-muted mt-0.5 line-clamp-2 block text-2xs break-words">{entry.detail}</span>
                      )}
                      <span className="text-faint mt-0.5 block font-mono text-3xs">{formatUtcShort(entry.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="border-line-soft border-t px-2.5 pt-2 pb-1">
            <Link
              href="/runs?status=failed"
              onClick={() => setOpen(false)}
              className="text-muted hover:text-ink inline-flex min-h-6 items-center text-2xs font-semibold underline underline-offset-2"
            >
              Every failed run<span aria-hidden="true">&nbsp;→</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** An entry opens its run; one whose run was since pruned opens its workflow's history. */
function hrefOf(entry: InboxEntry): string {
  return entry.runId ? `/runs/${entry.runId}` : `/runs?workflow=${encodeURIComponent(entry.workflowId)}`;
}

/** A bell, drawn in the ink of whatever holds it — no icon library (`ARCHITECTURE.md`, A16). */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}
