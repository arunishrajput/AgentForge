/**
 * **What an inbox entry and the bell say — Phase 37.** Pure and client-safe, so the words are
 * asserted rather than eyeballed, and the bell's accessible name says the same thing its badge
 * shows.
 */

/** "Invoice sync failed", or "… failed 3 times" for an entry that collapsed several. */
export function entryTitle(entry: { workflowName: string; count: number }): string {
  return entry.count > 1 ? `${entry.workflowName} failed ${entry.count} times` : `${entry.workflowName} failed`;
}

/** The bell's accessible name: the word, and the number its badge shows — never the badge alone. */
export function bellLabel(unread: number): string {
  if (unread <= 0) return "Inbox, nothing unread";
  return `Inbox, ${unread} unread`;
}

/** What the badge prints. Past 99 it stops counting, so the bell never grows wider than its slot. */
export function badgeCount(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}
