"use client";

import { useId } from "react";

import { cn } from "@/components/ui/cn";
import type { CanvasNode } from "@/lib/canvas/bridge";
import { categoryLook } from "@/lib/canvas/categories";
import type { NodeSummary } from "@/lib/canvas/client";
import { shortcutFor } from "@/lib/canvas/shortcuts";
import { ariaKeyShortcut, chordLabel, type Platform } from "@/lib/ui/keys";

import { NodeIcon } from "./node-icon";

/** One nudge: a step of the canvas's dot grid (`<Background gap={20}>`). */
export const NUDGE = 20;

/**
 * The inspector when more than one node is selected — Phase 29, task 3.
 *
 * Before this the panel opened only for exactly one node, so a box selection showed the
 * workflow summary as though nothing were selected at all. Now it says how many, lists
 * them, and offers what can be done to all of them at once: duplicate, copy, move and
 * delete. Every one of those is also a key (the hints say which), and every one is one
 * step of undo.
 *
 * **Move is four buttons, not only a drag.** Dragging any selected node already moves
 * the lot, but a drag needs a pointer, and "the whole flow keyboard-only" is part of the
 * phase. A focused node takes the arrow keys too; these are the version a person can
 * find without knowing that.
 *
 * A viewer sees the list and Copy — copying is reading what they may already read, and
 * pasting it is something they would do in a workflow of their own.
 */
export function SelectionInspector({
  nodes,
  registry,
  platform,
  readOnly,
  onSelectNode,
  onCopy,
  onDuplicate,
  onMove,
  onDelete,
}: {
  nodes: CanvasNode[];
  registry: Map<string, NodeSummary>;
  platform: Platform;
  readOnly: boolean;
  onSelectNode: (id: string) => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onMove: (dx: number, dy: number) => void;
  onDelete: () => void;
}) {
  const hint = (action: "copy" | "duplicate") => {
    const chord = shortcutFor(action).chords[0];
    return { label: chordLabel(chord, platform), aria: ariaKeyShortcut(chord, platform) };
  };
  const copy = hint("copy");
  const duplicate = hint("duplicate");
  // Never a literal id: `DESIGN.md` → *Traps* — a reusable component may not hardcode one.
  const nudgeHeading = useId();

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3.5">
        <section className="space-y-2">
          <h3 className="eyebrow">{readOnly ? "Copy them" : "All of them at once"}</h3>
          <div className="grid grid-cols-2 gap-2">
            {!readOnly && (
              <button
                type="button"
                onClick={onDuplicate}
                aria-keyshortcuts={duplicate.aria}
                className="btn btn-quiet justify-between"
              >
                Duplicate
                <span aria-hidden="true" className="text-faint text-3xs font-semibold">
                  {duplicate.label}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onCopy}
              aria-keyshortcuts={copy.aria}
              className={cn("btn btn-quiet justify-between", readOnly && "col-span-2")}
            >
              Copy
              <span aria-hidden="true" className="text-faint text-3xs font-semibold">
                {copy.label}
              </span>
            </button>
          </div>
          <p className="text-muted text-2xs leading-relaxed">
            A copy pastes into this workflow or another one, in this tab or a new one.
          </p>
        </section>

        {!readOnly && (
          <section className="space-y-2">
            <h3 className="eyebrow" id={nudgeHeading}>
              Move
            </h3>
            <div className="flex items-center gap-3">
              {/* Fixed tracks and `shrink-0`: as an auto grid in a flex row, the caption
                  beside it squeezed the columns narrower than the buttons, and the bottom
                  three overlapped (found on the deployed canvas). */}
              <div
                role="group"
                aria-labelledby={nudgeHeading}
                className="grid shrink-0 grid-cols-[repeat(3,2.25rem)] grid-rows-[repeat(2,2.25rem)] gap-1"
              >
                <NudgeButton label="Move up" glyph="↑" onClick={() => onMove(0, -NUDGE)} className="col-start-2" />
                <NudgeButton label="Move left" glyph="←" onClick={() => onMove(-NUDGE, 0)} className="col-start-1 row-start-2" />
                <NudgeButton label="Move down" glyph="↓" onClick={() => onMove(0, NUDGE)} className="col-start-2 row-start-2" />
                <NudgeButton label="Move right" glyph="→" onClick={() => onMove(NUDGE, 0)} className="col-start-3 row-start-2" />
              </div>
              <p className="text-muted text-2xs leading-relaxed">
                One grid step at a time. Or drag any of them — they move together.
              </p>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="eyebrow">In the selection</h3>
          <ul className="space-y-1">
            {nodes.map((node) => {
              const definition = registry.get(node.data.nodeType);
              const look = categoryLook(definition?.category);
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                    className="hover:bg-surface flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "border-line text-accent-ink grid size-6 shrink-0 place-items-center rounded-md border-2",
                        look.fill,
                      )}
                    >
                      <NodeIcon type={node.data.nodeType} category={definition?.category} className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-ui block truncate font-bold">
                        {node.data.label || definition?.label || node.data.nodeType}
                      </span>
                      <span className="text-muted block truncate font-mono text-3xs">{node.id}</span>
                    </span>
                    <span className="sr-only">— select only this node</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {!readOnly && (
        <footer className="border-line shrink-0 border-t-2 px-3 py-2.5">
          <button type="button" onClick={onDelete} className="btn btn-danger w-full">
            Delete {nodes.length} nodes
          </button>
        </footer>
      )}
    </>
  );
}

function NudgeButton({
  label,
  glyph,
  onClick,
  className,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={cn("btn btn-quiet size-9 p-0", className)}>
      <span aria-hidden="true" className="text-sm leading-none">
        {glyph}
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
