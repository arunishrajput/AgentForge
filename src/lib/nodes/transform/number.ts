import { z } from "zod";

import { defineNode, NodeError } from "../types";

const operations = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "round",
  "floor",
  "ceil",
  "absolute",
  "percent_of",
] as const;

type Operation = (typeof operations)[number];

/** Operations that ignore `operand` entirely. */
const UNARY: ReadonlySet<Operation> = new Set(["round", "floor", "ceil", "absolute"]);

/**
 * Arithmetic, as an enumerated operation rather than an expression.
 *
 * The same rule as `transform.text`: the workflows that want "add 1" should not have to
 * go through a code node to get it, and this product does not have a code node to go
 * through. What this deliberately is *not* is a calculator — there is no parser here
 * and nothing to inject into.
 */
export const numberNode = defineNode({
  type: "transform.number",
  label: "Do maths",
  description:
    "Performs one arithmetic operation on a number: add, subtract, multiply, divide, round, floor, ceil, absolute value, or what percentage one number is of another. Both values may reference earlier data.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "{ value: the result, operation }. Use output.value.",
  docs: {
    summary:
      "One arithmetic step. Useful for turning a raw count into something worth saying — a percentage, a rounded average, a running total added to an earlier one.",
    accepts: "The previous node's output as a number, when `value` is not configured.",
    examples: [
      { title: "Round an average to a whole number", body: "value: {{steps.avg.output.value}} · operation: round" },
      { title: "What share passed", body: "value: {{steps.passed.output.count}} · operation: percent_of · operand: {{steps.all.output.count}}" },
      { title: "Add VAT", body: "operation: multiply · operand: 1.2 · precision: 2" },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    /** Defaults to the incoming input. */
    value: z.unknown().optional(),
    operation: z.enum(operations).default("add"),
    operand: z.unknown().optional(),
    /** Decimal places for the result. Omit to leave it alone. */
    precision: z.number().int().min(0).max(10).optional(),
  }),
  async execute({ config, input, context }) {
    const left = requireNumber(config.value === undefined ? input : config.value, "value");
    const right = UNARY.has(config.operation)
      ? 0
      : requireNumber(config.operand, "operand", config.operation);

    let result: number;
    switch (config.operation) {
      case "add":
        result = left + right;
        break;
      case "subtract":
        result = left - right;
        break;
      case "multiply":
        result = left * right;
        break;
      case "divide":
        if (right === 0) {
          throw new NodeError("Do maths cannot divide by zero. Check the operand.");
        }
        result = left / right;
        break;
      case "percent_of":
        if (right === 0) {
          throw new NodeError(
            "Do maths cannot work out a percentage of zero. Check the operand — it is the total to compare against.",
          );
        }
        result = (left / right) * 100;
        break;
      // At `precision` decimal places when one is given — "round to two decimals" — and to a
      // whole number otherwise. Until Phase 34 these went to a whole number first and applied
      // `precision` to the integer, so 294.9882 rounded "to 2 places" was 295.
      case "round":
        result = atPrecision(Math.round, left, config.precision);
        break;
      case "floor":
        result = atPrecision(Math.floor, left, config.precision);
        break;
      case "ceil":
        result = atPrecision(Math.ceil, left, config.precision);
        break;
      case "absolute":
        result = Math.abs(left);
        break;
    }

    if (config.precision !== undefined) {
      // `Number(toFixed())` rather than a multiply-round-divide, which reintroduces
      // the float error it was meant to remove at around 15 significant digits.
      result = Number(result.toFixed(config.precision));
    }

    context.log(`${config.operation} produced ${result}.`);
    return { output: { value: result, operation: config.operation } };
  },
});

/** `Math.round` and friends at `places` decimal places; `toFixed` below cleans the float error. */
function atPrecision(step: (value: number) => number, value: number, places: number | undefined): number {
  if (places === undefined || places === 0) return step(value);
  const factor = 10 ** places;
  return step(value * factor) / factor;
}

/**
 * Strict on purpose. `Number(null)` is 0 and `Number("")` is 0, so a missing field
 * would quietly arithmetic against zero and produce a plausible wrong answer — the
 * exact failure Phase 22 found in its own latency coercion and fixed there too.
 */
function requireNumber(value: unknown, field: string, operation?: Operation): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === "boolean") return value ? 1 : 0;

  const forWhat = operation ? ` for "${operation}"` : "";
  throw new NodeError(
    value === null || value === undefined
      ? `Do maths needs a number in "${field}"${forWhat}, but nothing was supplied. Check the reference feeding it.`
      : `Do maths needs a number in "${field}"${forWhat}, but got ${JSON.stringify(value)?.slice(0, 80) ?? "a value"} instead.`,
  );
}
