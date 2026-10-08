/**
 * **When a dialog that is opened by a subject should start fresh** — Phase 32.
 *
 * The list keeps its dialogs mounted and opens one by handing it a subject — the workflow being
 * tagged or exported — and closes it by handing it `null`. A dialog that resets its fields only
 * when the subject's *id* changes keeps them across a close and a reopen on the same workflow:
 * Phase 32's browser walk reopened *Export* on the same workflow and found "Include pinned
 * outputs" still ticked from the time before, which is exactly the default D146 says it never
 * has. So a dialog resets whenever it is opened — whenever the subject goes from nothing, or from
 * another subject, to this one.
 *
 * Compared by identity on purpose: the list hands over the card object it was asked about, and
 * keeps that object while the dialog is open, so a refresh of the list underneath cannot reset a
 * dialog somebody is filling in.
 */
export function opened<T>(previous: T | null, next: T | null): boolean {
  return next !== null && next !== previous;
}
