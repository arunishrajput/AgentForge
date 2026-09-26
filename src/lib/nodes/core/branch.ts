import { z } from "zod";

import { defineNode } from "../types";

/**
 * Two-way conditional. Compares two resolved values with a fixed operator set —
 * not an expression language, because a workflow config field is exactly where
 * arbitrary code execution would sneak back in (CLAUDE.md, security rules).
 *
 * Edges leave through `sourceHandle` "true" or "false"; whichever side is not
 * taken is recorded as skipped.
 */
const operators = [
  "equals",
  "not_equals",
  "contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
] as const;

type Operator = (typeof operators)[number];

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Loose equality by design: `{{input.count}}` against a configured "3" should match. */
function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  if (typeof left === "object" || typeof right === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return String(left) === String(right);
}

export function evaluate(operator: Operator, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "equals":
      return looseEquals(left, right);
    case "not_equals":
      return !looseEquals(left, right);
    case "contains":
      return Array.isArray(left)
        ? left.some((item) => looseEquals(item, right))
        : String(left ?? "").includes(String(right ?? ""));
    case "greater_than":
      return asNumber(left) > asNumber(right);
    case "less_than":
      return asNumber(left) < asNumber(right);
    case "is_empty":
      return isEmpty(left);
    case "is_not_empty":
      return !isEmpty(left);
  }
}

export const branchNode = defineNode({
  type: "core.branch",
  label: "Branch",
  description:
    "Compares two values and sends the run down the 'true' or 'false' output. Values usually reference earlier data, e.g. left = {{input.status}}, operator = equals, right = ok.",
  kind: "branch",
  category: "logic",
  outputs: [
    { key: "true", label: "True" },
    { key: "false", label: "False" },
  ],
  // Not agent-callable (Phase 6, D19). A branch node's whole purpose is the
  // `sourceHandle` the run leaves through; called as a tool there is no edge to
  // take, so the model would get a boolean it could have worked out itself. An
  // agent that needs to route decides in its own output and a branch node reads it.
  agentCallable: false,
  configSchema: z.object({
    left: z.unknown(),
    operator: z.enum(operators).default("equals"),
    right: z.unknown().optional(),
  }),
  async execute({ config, input, context }) {
    const taken = evaluate(config.operator, config.left, config.right);
    context.log(`Condition ${config.operator} evaluated to ${taken}.`);
    return {
      output: { matched: taken, input: input ?? null },
      branch: taken ? "true" : "false",
    };
  },
});
