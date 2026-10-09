import type { RunFacts } from "@/lib/generate/evidence";
import type { GraphDiff, NodeField } from "@/lib/workflow/diff";

/**
 * **How to run it again once a fix is accepted — Phase 36, task 3 (D171).**
 *
 * *Retry from the failed step* (Phase 33) is the natural next step after a fix, and it is right
 * exactly when the fix is somewhere a retry will actually execute. A retry does not run again the
 * steps that finished before the failure: it carries them over as `reused`, outputs and all (D152),
 * and starts at the failed step with the input it had. So a fix to the failed step, or to anything
 * after it, takes effect — and a fix to a step *before* it does not: the retry would reuse the old
 * step's old output and fail the same way, which is the one outcome a fix must never have.
 *
 *   retry   the fix changes only the failed step or what comes after it
 *   rerun   the fix changes what a retry would reuse — a step that already ran, or what feeds the
 *           failed step — or removes the failed step, so it starts again from the trigger. Said in
 *           words, because a re-run repeats the steps before the failure, sends included
 *   test    the run was a test of part of the workflow: run the same test again
 *
 * Pure, so every case is asserted. The diff is the canvas before the fix against after it.
 */
export type AfterFix =
  | { kind: "retry" }
  /** `nodes`: the steps whose change a retry would miss, or the one that is gone. Empty for a test. */
  | { kind: "rerun"; why: "ran" | "gone" | "test"; nodes: string[] };

/** The fields that change what a step does when it runs. A new label or retry policy does not. */
const RUNS_DIFFERENTLY: ReadonlySet<NodeField> = new Set(["type", "config", "disabled"]);

export function afterFix(facts: Pick<RunFacts, "failedNodeId" | "ran" | "partialTest">, diff: Pick<GraphDiff, "nodes" | "edges">): AfterFix {
  if (facts.partialTest) return { kind: "rerun", why: "test", nodes: [] };

  const failed = facts.failedNodeId;
  if (failed !== null && diff.nodes.some((node) => node.id === failed && node.change === "removed")) {
    return { kind: "rerun", why: "gone", nodes: [failed] };
  }

  const ran = new Set(facts.ran);
  const stale = new Set<string>();
  for (const node of diff.nodes) {
    if (!ran.has(node.id)) continue;
    if (node.change === "removed" || (node.change === "changed" && node.fields.some((field) => RUNS_DIFFERENTLY.has(field)))) {
      stale.add(node.id);
    }
  }
  // A connection into a step that already ran, or into the failed one, changes what it is given —
  // and a retry hands the failed step the input it had last time, through the old connection.
  for (const edge of diff.edges) {
    if (edge.change !== "unchanged" && (ran.has(edge.target) || edge.target === failed)) stale.add(edge.target);
  }

  return stale.size === 0 ? { kind: "retry" } : { kind: "rerun", why: "ran", nodes: [...stale] };
}
