"use client";

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  changeKey,
  emptyHistory,
  gestureKey,
  record,
  redo as redoStep,
  undo as undoStep,
  type History,
} from "@/lib/canvas/history";
import { graphsEqual, type WorkflowGraph } from "@/lib/workflow/graph";

/**
 * Undo and redo, wired to the editor — Phase 29. The judgement lives in
 * `lib/canvas/history.ts`, with tests; this is the observation.
 *
 * **The history watches the graph rather than instrumenting each edit.** An edit can
 * come from React Flow (a drag, a connection, Delete), from the inspector (a field, a
 * label, a policy), or from the editor itself (a paste, a duplicate, an arrange), and a
 * history that had to be told about each would miss the next one somebody adds. So
 * every time the stored shape of the canvas changes, the layout effect below records the
 * graph from *before* the change. A change that is not structural — a selection, a
 * measurement — leaves the graph equal and records nothing (D22, D25).
 *
 * A layout effect, not a passive one, so the baseline is current before any event
 * handler can run: Undo pressed mid-drag must undo against the graph on screen.
 *
 * The stack is an external store (`useSyncExternalStore`) rather than React state.
 * Recording happens in that effect, and an effect that sets state is a second render
 * per keystroke and per drag frame; the store renders its subscribers only when *Undo
 * available* or *Redo available* actually flips.
 */

export interface CanvasHistory {
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Bumped by every undo and redo. The inspector keys its forms on it: they keep local
   * drafts so typing is never fought by the round trip (`config-form.tsx`), and a draft
   * of a value that Undo just replaced would otherwise go on showing the old text.
   */
  revision: number;
  undo: () => void;
  redo: () => void;
  /** Start again from this graph: a restored version has no past on this canvas. */
  reset: (graph: WorkflowGraph) => void;
  /** React Flow reported a drag frame. Every frame until `endGesture` is one step. */
  beginGesture: () => void;
  endGesture: () => void;
  /**
   * Label the next observed change. `null` makes it a step of its own — a paste, an
   * arrange — rather than letting the graph guess a key for it.
   */
  mark: (key: string | null) => void;
}

interface Flags {
  canUndo: boolean;
  canRedo: boolean;
}

const NONE: Flags = { canUndo: false, canRedo: false };

/** The stack, and the two booleans the UI reads from it. */
function createStore() {
  let history: History = emptyHistory();
  let flags: Flags = NONE;
  const listeners = new Set<() => void>();

  return {
    get: () => history,
    set(next: History) {
      history = next;
      const canUndo = next.past.length > 0;
      const canRedo = next.future.length > 0;
      if (canUndo === flags.canUndo && canRedo === flags.canRedo) return;
      flags = { canUndo, canRedo };
      for (const listener of listeners) listener();
    },
    flags: () => flags,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useHistory({
  graph,
  apply,
  enabled,
}: {
  /** The canvas's graph — `fromFlow(nodes, edges)` — as of this render. */
  graph: WorkflowGraph;
  /** Put a graph on the canvas. Called by undo and redo. */
  apply: (graph: WorkflowGraph) => void;
  /** Diff mode and a viewer are inert: no undo, no redo. */
  enabled: boolean;
}): CanvasHistory {
  const [store] = useState(createStore);
  const flags = useSyncExternalStore(store.subscribe, store.flags, () => NONE);
  const [revision, setRevision] = useState(0);

  /** The graph last observed — what the next change is measured against. */
  const baseline = useRef(graph);
  const gesture = useRef<{ key: string; ending: boolean } | null>(null);
  const gestures = useRef(0);
  /** `undefined`: no label, let the graph say. `null` or a key: what `mark` asked for. */
  const pending = useRef<string | null | undefined>(undefined);

  useLayoutEffect(() => {
    const before = baseline.current;
    const label = pending.current;
    pending.current = undefined;

    if (!graphsEqual(before, graph)) {
      const key = label !== undefined ? label : (gesture.current?.key ?? changeKey(before, graph));
      store.set(record(store.get(), before, key, Date.now()));
    }
    baseline.current = graph;

    // React Flow's last drag report (`dragging: false`) can still carry a position, so
    // the gesture's key is released only once that report has been recorded under it.
    if (gesture.current?.ending) gesture.current = null;
  }, [graph, store]);

  const step = useCallback(
    (direction: "undo" | "redo") => {
      if (!enabled) return;
      const result = (direction === "undo" ? undoStep : redoStep)(store.get(), baseline.current);
      if (!result) return;
      store.set(result.history);
      // The graph being applied is not an edit: the effect will find it equal.
      baseline.current = result.graph;
      apply(result.graph);
      setRevision((n) => n + 1);
    },
    [apply, enabled, store],
  );

  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);

  const reset = useCallback(
    (next: WorkflowGraph) => {
      store.set(emptyHistory());
      baseline.current = next;
      pending.current = undefined;
      gesture.current = null;
    },
    [store],
  );

  const beginGesture = useCallback(() => {
    if (gesture.current && !gesture.current.ending) return;
    gestures.current += 1;
    gesture.current = { key: gestureKey(gestures.current), ending: false };
  }, []);

  const endGesture = useCallback(() => {
    if (gesture.current) gesture.current = { ...gesture.current, ending: true };
  }, []);

  const mark = useCallback((key: string | null) => {
    pending.current = key;
  }, []);

  return {
    canUndo: enabled && flags.canUndo,
    canRedo: enabled && flags.canRedo,
    revision,
    undo,
    redo,
    reset,
    beginGesture,
    endGesture,
    mark,
  };
}
