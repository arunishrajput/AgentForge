import type { NodeRunState } from "@/components/canvas/context";
import type { RunStatus, StepStatus } from "@/lib/engine/types";

/**
 * **A run, as the canvas paints it — one state per node.** Pure, and shared since Phase 33 by the
 * editor and a run's own page, which paint the same run the same way: a looped node shows its most
 * recent pass and how many there were, and a step still `running` inside a `waiting` run is drawn
 * paused (Phase 26).
 */
export function runStatesOf(
  run: {
    status: RunStatus;
    steps?: readonly { nodeId: string; status: StepStatus; branch: string | null; error: string | null }[];
  } | null,
): Map<string, NodeRunState> {
  const states = new Map<string, NodeRunState>();
  const waiting = run?.status === "waiting";
  for (const step of run?.steps ?? []) {
    const existing = states.get(step.nodeId);
    states.set(step.nodeId, {
      status: step.status,
      executions: (existing?.executions ?? 0) + 1,
      branch: step.branch,
      error: step.error,
      paused: waiting && step.status === "running",
    });
  }
  return states;
}
