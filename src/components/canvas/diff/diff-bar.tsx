"use client";

import { Button } from "@/components/ui/button";
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
 */
export function DiffBar({
  from,
  to,
  summary,
  onExit,
}: {
  from: number;
  to: number;
  summary: DiffSummary;
  onExit: () => void;
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
      className="border-line bg-accent-pop text-ink flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-2 px-3 py-2"
    >
      <span className="text-ui shrink-0 font-bold">
        Comparing v{from} <span aria-hidden="true">→</span>
        <span className="sr-only">with</span> v{to}
      </span>

      {shown.length === 0 && edges === 0 ? (
        <span className="text-2xs">These two versions have identical graphs.</span>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          {shown.map(({ change, count }) => {
            const look = changeLook(change);
            return (
              // `chip-pop`, not `chip`: it takes its fill from the call site and sets
              // an ink label, which is the rule, and its full ink border is what keeps
              // it legible sitting on another pop fill.
              <span key={change} className={cn("chip-pop shrink-0", look.fill)}>
                <span aria-hidden="true" className="font-bold">
                  {look.glyph}
                </span>
                {count} {look.label.toLowerCase()}
              </span>
            );
          })}
          {edges > 0 && (
            <span className="chip-pop bg-surface shrink-0">
              <span aria-hidden="true">↔</span>
              {edges} connection{edges === 1 ? "" : "s"} rewired
            </span>
          )}
        </span>
      )}

      <Button tone="ink" size="sm" onClick={onExit} className="ml-auto shrink-0">
        Back to editing
      </Button>
    </div>
  );
}
