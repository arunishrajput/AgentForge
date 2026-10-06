"use client";

import { createContext, useContext } from "react";

import type { NodeSummary, StepStatus } from "@/lib/canvas/client";
import type { NodeDiff } from "@/lib/workflow/diff";

/**
 * What a canvas node needs to render, beyond the graph itself.
 *
 * All of these deliberately travel by context rather than inside a node's `data`:
 * `data` holds persisted fields only, so `fromFlow` is a clean inverse of `toFlow`
 * and no UI state can leak into a saved graph (see `lib/canvas/bridge.ts`). It
 * also means a status change does not have to rebuild every node object — which is
 * what Phase 5 does many times a second.
 *
 * The *presentation* tables used to live here too. They are now
 * `lib/canvas/categories.ts` and `lib/canvas/status.ts`, because neither has
 * anything to do with React and both are worth asserting: a category's two colour
 * registers and a status's five distinct looks are exactly the kind of table that
 * decays silently. Phase 16 moved them and tested them there.
 */

/** The outcome of a node's most recent step in the last run shown on the canvas. */
export interface NodeRunState {
  status: StepStatus;
  /** How many steps this node produced — greater than 1 when it ran in a loop. */
  executions: number;
  branch: string | null;
  error: string | null;
  /**
   * The step is `running` inside a run that is `waiting` — Phase 26: a long delay, paused
   * until its wake time. Drawn as "Waiting" with a clock rather than the working dots,
   * because nothing is working.
   */
  paused: boolean;
}

export interface CanvasContextValue {
  registry: Map<string, NodeSummary>;
  runStates: Map<string, NodeRunState>;
  /**
   * How each node differs between the two versions being compared, or an empty map
   * when the canvas is editing rather than comparing (Phase 18).
   *
   * It travels by context for exactly the reason `runStates` does: a diff is a
   * *projection over* the graph and must never reach a node's `data`, or `fromFlow`
   * would write it into the saved workflow. It is also what makes diff mode safe —
   * the graph React Flow renders in that mode is a union of two versions that was
   * never anybody's workflow, and nothing about it can be persisted.
   */
  diffStates: Map<string, NodeDiff>;
  /**
   * Position of each node in the graph as it was *first loaded*, used only to stagger
   * the entry animation left to right. A node added after load is absent and animates
   * with no delay — the click must feel immediate, whereas a generated graph wants to
   * assemble itself.
   */
  entryOrder: Map<string, number>;
}

export const CanvasContext = createContext<CanvasContextValue>({
  registry: new Map(),
  runStates: new Map(),
  diffStates: new Map(),
  entryOrder: new Map(),
});

export function useCanvas(): CanvasContextValue {
  return useContext(CanvasContext);
}
