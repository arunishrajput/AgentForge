/**
 * What an inbox entry can be about — Phase 37. A column rather than a table per kind, because the
 * plan was for Phase 38's approvals to join the same list.
 *
 * **Phase 38 decided otherwise** (D180): an approval request is not an entry. Entries are
 * notifications — written once per reader, collapsed while unread, marked read — and a request is a
 * to-do whose state is its decision. So the inbox reads pending requests live from the `approval`
 * table beside its entries (`store.ts` → `readInbox`), and `run_failed` stays the only kind.
 */
export const INBOX_KINDS = ["run_failed"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
