import type { RunTest } from "@/lib/engine/partial";
import type { StreamRun } from "@/lib/engine/stream";
import { formatDuration } from "@/lib/format/duration";

/**
 * **What a person is told about a test run — Phase 31.** Pure, so the words are tested rather
 * than eyeballed: the toast after *test this node* or *test up to here*, and the chip on a run
 * that was a test.
 */

export interface TestOutcome {
  tone: "ok" | "warn" | "bad";
  title: string;
  detail?: string;
}

/** The chip a test run wears in the run panel: what was tested, in a few words. */
export function testLabel(test: RunTest | null, names: ReadonlyMap<string, string>): string | null {
  if (!test) return null;
  if (test.scope === "workflow") return "Test · pinned data";
  const name = (test.nodeId && names.get(test.nodeId)) ?? test.nodeId ?? "a node";
  return test.scope === "node" ? `Test · ${name} alone` : `Test · up to ${name}`;
}

/**
 * The toast after a node or path test. A failure names the step that failed, as a full run's
 * does; a path test whose target the run never reached says so, because a green "finished"
 * for a test that did not test its node would be the misleading answer.
 */
export function testOutcome(
  run: Pick<StreamRun, "status" | "error" | "durationMs" | "steps">,
  target: string,
  names: ReadonlyMap<string, string>,
): TestOutcome {
  const name = names.get(target) ?? target;
  const steps = run.steps ?? [];

  if (run.status === "failed") {
    const failed = steps.find((step) => step.status === "failed");
    return {
      tone: "bad",
      title: failed ? `${names.get(failed.nodeId) ?? failed.nodeId} failed` : `Testing ${name} failed`,
      detail: failed?.error ?? run.error ?? "No reason was recorded.",
    };
  }

  const reached = steps.find((step) => step.nodeId === target);
  /**
   * Phase 37. The node under test failed and its on-error policy handled it, so the run succeeded —
   * but what was being tested is the node, and the node failed. Said so, with its error, in the
   * warning tone: green here would be the misleading answer.
   */
  const handled = steps.find((step) => step.status === "handled" && step.nodeId === target);
  if (handled) {
    return {
      tone: "warn",
      title: `${name} failed — its error was handled`,
      detail: handled.error ?? "No reason was recorded.",
    };
  }
  if (!reached || reached.status === "skipped") {
    return {
      tone: "warn",
      title: `${name} was not reached`,
      detail: "The run went another way before it got there — a branch, a switch or a node switched off.",
    };
  }

  const ran = steps.filter((step) => step.status === "succeeded").length;
  const pinned = steps.filter((step) => step.status === "pinned").length;
  const parts = [
    `${ran} step${ran === 1 ? "" : "s"} ran`,
    ...(pinned > 0 ? [`${pinned} used ${pinned === 1 ? "its" : "their"} pinned output`] : []),
  ];
  return {
    tone: "ok",
    title: `Tested ${name}`,
    detail: `${parts.join(", ")}${run.durationMs === null ? "" : ` in ${formatDuration(run.durationMs)}`}.`,
  };
}
