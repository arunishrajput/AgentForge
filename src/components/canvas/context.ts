"use client";

import { createContext, useContext } from "react";

import type { NodeSummary, StepStatus } from "@/lib/canvas/client";

/**
 * What a canvas node needs to render, beyond the graph itself.
 *
 * Both of these deliberately travel by context rather than inside a node's `data`:
 * `data` holds persisted fields only, so `fromFlow` is a clean inverse of `toFlow`
 * and no UI state can leak into a saved graph (see `lib/canvas/bridge.ts`). It
 * also means a status change does not have to rebuild every node object — which is
 * what Phase 5 will be doing many times a second.
 */

/** The outcome of a node's most recent step in the last run shown on the canvas. */
export interface NodeRunState {
  status: StepStatus;
  /** How many steps this node produced — greater than 1 when it ran in a loop. */
  executions: number;
  branch: string | null;
  error: string | null;
}

export interface CanvasContextValue {
  registry: Map<string, NodeSummary>;
  runStates: Map<string, NodeRunState>;
}

export const CanvasContext = createContext<CanvasContextValue>({
  registry: new Map(),
  runStates: new Map(),
});

export function useCanvas(): CanvasContextValue {
  return useContext(CanvasContext);
}

/** Palette grouping, and the accent a node carries on the canvas. */
export const CATEGORY_STYLE: Record<string, { label: string; dot: string; ring: string }> = {
  trigger: { label: "Triggers", dot: "bg-emerald-400", ring: "ring-emerald-400/40" },
  logic: { label: "Logic", dot: "bg-sky-400", ring: "ring-sky-400/40" },
  transform: { label: "Transform", dot: "bg-violet-400", ring: "ring-violet-400/40" },
  integration: { label: "Integrations", dot: "bg-amber-400", ring: "ring-amber-400/40" },
  agent: { label: "Agents", dot: "bg-fuchsia-400", ring: "ring-fuchsia-400/40" },
};

export const CATEGORY_ORDER = ["trigger", "agent", "logic", "transform", "integration"];

export const STATUS_STYLE: Record<StepStatus, { label: string; className: string }> = {
  running: { label: "Running", className: "bg-sky-400/15 text-sky-300 ring-sky-400/40" },
  succeeded: {
    label: "Succeeded",
    className: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/40",
  },
  failed: { label: "Failed", className: "bg-red-400/15 text-red-300 ring-red-400/40" },
  skipped: { label: "Skipped", className: "bg-muted/10 text-muted ring-muted/30" },
};
