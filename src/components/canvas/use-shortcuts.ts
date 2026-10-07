"use client";

import { useEffect, useRef } from "react";

import { isTypingTarget, matchShortcut, type ShortcutAction } from "@/lib/canvas/shortcuts";

/**
 * The canvas's key handler — Phase 29. Which key means what is `lib/canvas/shortcuts.ts`,
 * one table shared with the `?` dialog; this file only listens.
 *
 * On the document, as ⌘K's is: a shortcut has to work wherever focus happens to be on
 * the page — a node, the pane, a toolbar button, nothing at all.
 *
 * Three things a key press must get past before it does anything:
 *
 *   a handled event      something nearer the target already acted on it (`defaultPrevented`)
 *   an open dialog       a modal `<dialog>` holds focus while it is open; its keys are its own,
 *                        and ⌘Z must not undo a canvas the reader cannot see
 *   a text field         `matchShortcut` lets every key but ⌘S through to what is being typed
 *
 * An action with no handler — Undo for a viewer, anything in diff mode — is not claimed,
 * so the browser's own behaviour for that key survives. Nor is one whose handler returns
 * `false`: ⌘C with text selected in the run panel is the browser's copy, not the canvas's.
 *
 * The handlers are read through a ref so the listener is attached once, not re-attached
 * on every render the editor does while a node is dragged.
 */
export type ShortcutHandlers = Partial<Record<ShortcutAction, () => boolean | void>>;

export function useShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("dialog")) return;

      const action = matchShortcut(event, isTypingTarget(target as HTMLElement | null));
      const handler = action ? latest.current[action] : undefined;
      if (!handler) return;

      if (handler() !== false) event.preventDefault();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
