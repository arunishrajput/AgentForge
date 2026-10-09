import { getNode } from "@/lib/nodes";
import { valuesEqual, type WorkflowGraph } from "@/lib/workflow/graph";

import type { GenerationResult } from "../generate";
import { checkReferences, type ReferenceProblem } from "../references";
import type { EvalCase } from "./cases";
import type { EditEvalCase } from "./edit-cases";

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

/**
 * **Scoring one copilot edit — Phase 35.** Everything `scoreCase` checks of a graph — required and
 * forbidden types, `unsupported` used honestly, every reference resolving — and then what only an
 * edit can get wrong: a node it should have left alone that it changed or removed, a node it should
 * have removed that is still there, a label or a value it should have set and did not.
 */
export function scoreEdit(evalCase: EditEvalCase, start: WorkflowGraph, result: GenerationResult): CaseScore {
  const base = scoreCase(
    {
      id: evalCase.id,
      prompt: evalCase.instruction,
      requires: evalCase.requires,
      forbids: evalCase.forbids,
      unsupported: evalCase.unsupported,
    },
    result,
  );
  if (!result.ok) return base;

  const failures = [...base.failures];
  const before = new Map(start.nodes.map((node) => [node.id, node]));
  const after = new Map(result.graph.nodes.map((node) => [node.id, node]));

  for (const id of evalCase.keeps ?? []) {
    const was = before.get(id);
    const now = after.get(id);
    if (!now) failures.push(`removed "${id}", which the change does not touch`);
    else if (
      was &&
      (now.type !== was.type || (now.label ?? "") !== (was.label ?? "") || !valuesEqual(now.config, was.config))
    ) {
      failures.push(`changed "${id}", which the change does not touch`);
    }
  }
  for (const id of evalCase.removes ?? []) {
    if (after.has(id)) failures.push(`kept "${id}", which the change removes`);
  }
  for (const [id, label] of Object.entries(evalCase.labels ?? {})) {
    const now = after.get(id)?.label;
    if (now !== label) failures.push(`"${id}" is labelled ${JSON.stringify(now ?? null)}, not ${JSON.stringify(label)}`);
  }
  for (const expected of evalCase.sets ?? []) {
    const value = JSON.stringify(after.get(expected.node)?.config[expected.key] ?? null);
    if (!value.includes(expected.includes)) {
      failures.push(`"${expected.node}".${expected.key} is ${value}, which does not contain ${JSON.stringify(expected.includes)}`);
    }
  }

  return { ...base, pass: failures.length === 0, failures };
}
