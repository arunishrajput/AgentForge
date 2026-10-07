"use client";

import { ControlButton } from "@xyflow/react";

import { shortcutFor, type ShortcutAction } from "@/lib/canvas/shortcuts";
import { ariaKeyShortcut, chordLabel, type Platform } from "@/lib/ui/keys";

/**
 * Undo, Redo, Auto-arrange and the `?` card — Phase 29 — as buttons in the canvas's own
 * control stack, under React Flow's zoom and fit.
 *
 * **On the canvas, not in the toolbar**, and that is a measured decision rather than a
 * taste. The toolbar is two rows on a 375 px phone since Phase 28 (151 → 104 px), and
 * four more buttons would make it three again; the control stack sits over the canvas
 * and costs it nothing. It is also where the tools this one is measured against keep the
 * same buttons — undo beside zoom, a tidy-up beside fit — so a reader who has used one
 * looks here first.
 *
 * Each button carries its shortcut in its tooltip and in `aria-keyshortcuts`, so the
 * pointer path teaches the keyboard path. A viewer and diff mode get only `?`: there is
 * nothing for them to undo, and nothing to arrange.
 */
export function EditControls({
  editable,
  canUndo,
  canRedo,
  canArrange,
  platform,
  onUndo,
  onRedo,
  onArrange,
  onShortcuts,
}: {
  editable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canArrange: boolean;
  platform: Platform;
  onUndo: () => void;
  onRedo: () => void;
  onArrange: () => void;
  onShortcuts: () => void;
}) {
  const keyed = (action: ShortcutAction, name: string) => {
    const chord = shortcutFor(action).chords[0];
    return {
      "aria-label": name,
      "aria-keyshortcuts": ariaKeyShortcut(chord, platform),
      title: `${name} (${chordLabel(chord, platform)})`,
    };
  };

  return (
    <>
      {editable && (
        <>
          <ControlButton
            onClick={onUndo}
            disabled={!canUndo}
            className="control-group-start"
            {...keyed("undo", "Undo")}
          >
            <svg viewBox="0 0 16 16" className="control-icon" aria-hidden="true">
              <path d="M5.5 3 2.5 6l3 3" />
              <path d="M2.5 6h7a3.5 3.5 0 0 1 0 7H7" />
            </svg>
          </ControlButton>
          <ControlButton onClick={onRedo} disabled={!canRedo} {...keyed("redo", "Redo")}>
            <svg viewBox="0 0 16 16" className="control-icon" aria-hidden="true">
              <path d="m10.5 3 3 3-3 3" />
              <path d="M13.5 6h-7a3.5 3.5 0 0 0 0 7H9" />
            </svg>
          </ControlButton>
          <ControlButton
            onClick={onArrange}
            disabled={!canArrange}
            aria-label="Auto-arrange"
            title="Auto-arrange — lay the graph out left to right"
          >
            <svg viewBox="0 0 16 16" className="control-icon" aria-hidden="true">
              <rect x="1.5" y="6.5" width="4" height="3" rx="0.75" />
              <rect x="10.5" y="2" width="4" height="3" rx="0.75" />
              <rect x="10.5" y="11" width="4" height="3" rx="0.75" />
              <path d="M5.5 8H8M8 3.5v9M8 3.5h2.5M8 12.5h2.5" />
            </svg>
          </ControlButton>
        </>
      )}
      <ControlButton
        onClick={onShortcuts}
        aria-haspopup="dialog"
        className={editable ? undefined : "control-group-start"}
        {...keyed("help", "Keyboard shortcuts")}
      >
        <span aria-hidden="true" className="text-xs leading-none font-bold">
          ?
        </span>
      </ControlButton>
    </>
  );
}
