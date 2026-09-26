"use client";

import { createContext, useContext } from "react";

import type { NodeSummary, StepStatus } from "@/lib/canvas/client";

/**
 * What a canvas node needs to render, beyond the graph itself.
 *
 * All of these deliberately travel by context rather than inside a node's `data`:
 * `data` holds persisted fields only, so `fromFlow` is a clean inverse of `toFlow`
 * and no UI state can leak into a saved graph (see `lib/canvas/bridge.ts`). It
 * also means a status change does not have to rebuild every node object — which is
 * what Phase 5 does many times a second.
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
  /**
   * Position of each node in the graph as it was *first loaded*, used only to stagger
   * the entry animation left to right. A node added after load is absent and animates
   * with no delay — the click must feel immediate, whereas a generated graph wants to
   * assemble itself (`DEMO.md` Beat 3).
   */
  entryOrder: Map<string, number>;
}

export const CanvasContext = createContext<CanvasContextValue>({
  registry: new Map(),
  runStates: new Map(),
  entryOrder: new Map(),
});

export function useCanvas(): CanvasContextValue {
  return useContext(CanvasContext);
}

/**
 * Palette grouping, and the accent a node carries on the canvas.
 *
 * Every class here is a literal string so Tailwind's scanner finds it; a category
 * colour built by concatenation would compile to nothing. The tokens themselves are
 * declared in `globals.css` — this file names them, it does not invent colours.
 */
export const CATEGORY_STYLE: Record<
  string,
  { label: string; dot: string; ring: string }
> = {
  trigger: {
    label: "Triggers",
    dot: "bg-cat-trigger",
    ring: "ring-cat-trigger/50",
  },
  logic: {
    label: "Logic",
    dot: "bg-cat-logic",
    ring: "ring-cat-logic/50",
  },
  transform: {
    label: "Transform",
    dot: "bg-cat-transform",
    ring: "ring-cat-transform/50",
  },
  integration: {
    label: "Integrations",
    dot: "bg-cat-integration",
    ring: "ring-cat-integration/50",
  },
  agent: {
    label: "Agents",
    dot: "bg-cat-agent",
    ring: "ring-cat-agent/50",
  },
};

export const CATEGORY_ORDER = ["trigger", "agent", "logic", "transform", "integration"];

/** An unregistered node type. Red, because it is the one case that must look wrong. */
export const UNKNOWN_CATEGORY_STYLE = {
  label: "Unknown",
  dot: "bg-bad",
  ring: "ring-bad/60",
};

/**
 * The four step outcomes, as a `chip`.
 *
 * The pill is the recessed neutral rather than a tint of its own tone, and that is a
 * contrast decision, not a taste one: a translucent wash of a colour *under* text of
 * the same colour compresses the ratio, and at any alpha subtle enough to look right
 * the red "Failed" chip fell short of WCAG AA (measured in `src/app/tokens.test.ts`,
 * 3.3:1 at 15%). Against `sunken` the same four tones clear 7.4:1 and up, and the
 * identity is carried by the text and the hairline ring the `chip` utility draws from
 * `currentcolor`.
 */
export const STATUS_STYLE: Record<StepStatus, { label: string; className: string }> = {
  running: { label: "Running", className: "bg-sunken text-live" },
  succeeded: { label: "Succeeded", className: "bg-sunken text-ok" },
  failed: { label: "Failed", className: "bg-sunken text-bad" },
  skipped: { label: "Skipped", className: "bg-sunken text-muted" },
};
