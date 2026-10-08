import { getNode } from "@/lib/nodes";

import type { GenerationResult } from "../generate";
import { checkReferences, type ReferenceProblem } from "../references";
import type { EvalCase } from "./cases";

/**
 * **Scoring one generation against one eval case — Phase 34.** Pure, so the live runner and the
 * offline replay score identically.
 *
 * A case passes only when every check does, and each check is reported on its own so a failure
 * says which kind it was. They are ordered the way a person would diagnose one: did it build at
 * all, did it start right, did it use what the request needed, did it say honestly what it could
 * not do — and **do its references resolve**, which is the check that sees a valid graph doing the
 * wrong thing (`references.ts`).
 */

export interface CaseScore {
  id: string;
  pass: boolean;
  /** A valid graph within the two attempts generation allows. */
  valid: boolean;
  /** Which attempt produced it — 1 or 2 — or null when neither did. */
  attempt: 1 | 2 | null;
  /** Every failed expectation, in words. Empty on a pass. */
  failures: string[];
  /** The node types the generated graph used, sorted. */
  types: string[];
  references: ReferenceProblem[];
}

/** `"core.branch"` or `"core.branch or core.switch"`. */
export function describeRequirement(requirement: string | string[]): string {
  return Array.isArray(requirement) ? requirement.join(" or ") : requirement;
}

export function requirementMet(requirement: string | string[], types: Set<string>): boolean {
  const options = Array.isArray(requirement) ? requirement : [requirement];
  return options.some((type) => types.has(type));
}

export function scoreCase(evalCase: EvalCase, result: GenerationResult): CaseScore {
  if (!result.ok) {
    return {
      id: evalCase.id,
      pass: false,
      valid: false,
      attempt: null,
      failures: [`no valid graph after ${result.attempts.length} attempts: ${result.issues.map((issue) => issue.message).join("; ")}`],
      types: [],
      references: [],
    };
  }

  const failures: string[] = [];
  const types = new Set(result.graph.nodes.map((node) => node.type));
  const trigger = result.graph.nodes.find((node) => getNode(node.type)?.kind === "trigger")?.type;

  if (evalCase.trigger && trigger !== evalCase.trigger) {
    failures.push(`started with ${trigger ?? "no trigger"}, expected ${evalCase.trigger}`);
  }
  for (const requirement of evalCase.requires ?? []) {
    if (!requirementMet(requirement, types)) failures.push(`missing ${describeRequirement(requirement)}`);
  }
  for (const type of evalCase.forbids ?? []) {
    if (types.has(type)) failures.push(`used ${type}, which the request did not ask for`);
  }
  if (evalCase.unsupported === true && result.unsupported.length === 0) {
    failures.push("built everything without naming what cannot be done");
  }
  if (evalCase.unsupported === false && result.unsupported.length > 0) {
    failures.push(`called part of a buildable request unsupported: ${result.unsupported.join("; ")}`);
  }

  const references = checkReferences(result.graph);
  for (const problem of references) {
    failures.push(`{{${problem.reference}}} in "${problem.nodeId}": ${problem.message}`);
  }

  return {
    id: evalCase.id,
    pass: failures.length === 0,
    valid: true,
    attempt: result.attempt,
    failures,
    types: [...types].sort(),
    references,
  };
}
