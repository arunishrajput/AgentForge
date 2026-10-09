/**
 * What an inbox entry can be about — Phase 37. A column rather than a table per kind, because
 * Phase 38 adds approvals to the same inbox and a reader wants one list, newest first.
 */
export const INBOX_KINDS = ["run_failed"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
