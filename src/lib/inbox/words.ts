/**
 * **What an inbox entry and the bell say — Phase 37.** Pure and client-safe, so the words are
 * asserted rather than eyeballed, and the bell's accessible name says the same thing its badge
 * shows.
 */

/** "Invoice sync failed", or "… failed 3 times" for an entry that collapsed several. */
export function entryTitle(entry: { workflowName: string; count: number }): string {
  return entry.count > 1 ? `${entry.workflowName} failed ${entry.count} times` : `${entry.workflowName} failed`;
}

/**
 * The bell's accessible name: the word, and what its badge counts — never the badge alone. Since
 * Phase 38 the badge counts requests waiting on the reader too, so the name says both.
 */
export function bellLabel(unread: number, pending = 0): string {
  const waiting = pending > 0 ? `${pending} approval${pending === 1 ? "" : "s"} waiting on you` : null;
  const read = unread > 0 ? `${unread} unread` : null;
  if (!waiting && !read) return "Inbox, nothing unread";
  return `Inbox, ${[waiting, read].filter(Boolean).join(", ")}`;
}

/** "Refunds asks for a decision" — a request waiting on the reader (Phase 38). */
export function approvalTitle(entry: { workflowName: string }): string {
  return `${entry.workflowName} asks for a decision`;
}

/** What the badge prints. Past 99 it stops counting, so the bell never grows wider than its slot. */
export function badgeCount(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}
