"use client";

import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import { changeLook } from "@/lib/canvas/changes";
import type { DiffSummary, NodeChange } from "@/lib/canvas/client";

/**
 * The bar across the canvas while it is showing a diff.
 *
 * It has one job beyond the counts, and it is the important one: **say plainly that
 * this is not your workflow.** The canvas in diff mode is rendering the union of two
 * versions — a graph that includes nodes deleted a week ago — and a user who does not
 * realise that will try to edit it. So the bar states the two versions by number, the
 * counts, and the way out, and the canvas underneath is inert.
 *
 * Every count carries its glyph, its colour **and its word**, which is the same rule
 * the node ribbons follow. A legend that is four coloured dots is a legend that only
 * works for some readers.
 *
 * **Phase 35 shares it with the copilot**: a proposal is a diff of the canvas against what
 * Accept would make it, and the same bar says so — with Accept and Reject where *Back to
 * editing* is for two versions. The heading and the way out are the caller's.
 */
export function DiffBar({
  heading,
  identical = "These two versions have identical graphs.",
  summary,
  children,
}: {
  /** What is being compared — "Comparing v3 → v5", or a copilot proposal (Phase 35). */
  heading: ReactNode;
  /** What to say when the two graphs are the same. */
  identical?: string;
  summary: DiffSummary;
  /** The way out, at the end of the bar: *Back to editing*, or Accept and Reject. */
  children: ReactNode;
}) {
  const counts: { change: NodeChange; count: number }[] = [
    { change: "added", count: summary.added },
    { change: "removed", count: summary.removed },
    { change: "changed", count: summary.changed },
    { change: "moved", count: summary.moved },
  ];
  const shown = counts.filter((entry) => entry.count > 0);
  const edges = summary.edgesAdded + summary.edgesRemoved;

  return (
    <div
      // `role="status"` rather than an alert: entering diff mode is the result of
      // something the user just asked for, and it should be announced without
      // interrupting whatever they are doing next.
      role="status"
      // The one loud element on the canvas while diff mode is on. A pop fill with an
      // ink label is `DESIGN.md`'s rule for a pop fill, and loud is the point: this is
      // a mode, and a mode that looks like the ordinary page is a mode people edit by
      // mistake.
      className="border-line bg-accent-pop text-accent-ink flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-2 px-3 py-2"
    >
      <span className="text-ui shrink-0 font-bold">{heading}</span>

      {shown.length === 0 && edges === 0 && summary.notes === 0 ? (
        <span className="text-2xs">{identical}</span>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          {shown.map(({ change, count }) => {
            const look = changeLook(change);
            return (
              // `chip-pop` on a fill: it sets the fill's ink label, which is the rule, and
              // its full ink border keeps it legible sitting on another pop fill. **Not on
              // `moved`**, whose ribbon is `surface` rather than a fill: `chip-pop` drew
              // `accent-ink` there — 1.06:1 in Night, an empty capsule — until Phase 30's
              // audit. That one is the quiet chip, in the ribbon's own ink.
              <span
                key={change}
                className={
                  look.fill.endsWith("-pop")
                    ? cn("chip-pop shrink-0", look.fill)
                    : cn("chip shrink-0", look.fill, look.ink)
                }
              >
                <span aria-hidden="true" className="font-bold">
                  {look.glyph}
                </span>
                {count} {look.label.toLowerCase()}
              </span>
            );
          })}
          {edges > 0 && (
            <span className="chip bg-surface text-ink shrink-0">
              <span aria-hidden="true">↔</span>
              {edges} connection{edges === 1 ? "" : "s"} rewired
            </span>
          )}
          {/* Phase 30. Without it, a comparison that only edited a note said the two
              versions were identical. */}
          {summary.notes > 0 && (
            <span className="chip bg-surface text-ink shrink-0">
              <span aria-hidden="true">✎</span>
              {summary.notes} note{summary.notes === 1 ? "" : "s"} edited
            </span>
          )}
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-2">{children}</span>
    </div>
  );
}
