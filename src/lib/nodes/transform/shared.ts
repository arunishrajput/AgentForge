import { NodeError } from "../types";

/**
 * The three things every transform node repeats — Phase 23A.
 *
 * These nodes are the ones that read *into* data rather than passing it along, so
 * they share a path reader, a way of finding the array they operate on, and a
 * comparison that behaves the way a workflow author expects rather than the way
 * JavaScript does.
 */

/**
 * Read a dotted path out of a value: `user.email`, `items.0.name`, `` for the value
 * itself.
 *
 * **This is not an expression language and must never become one.** It reads
 * properties and array indices, and that is the whole of it — no calls, no operators,
 * no `[]` syntax to parse. A config field is exactly where arbitrary code execution
 * would sneak back into this product (`CLAUDE.md`, security rules), and the defence is
 * that there is nothing here that could evaluate one.
 *
 * Returns `undefined` for anything that does not resolve, including a path that walks
 * through `null`. Callers distinguish "missing" from "present and null" where it
 * matters; most do not need to.
 */
export function readPath(value: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (trimmed === "") return value;

  let current: unknown = value;
  for (const segment of trimmed.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      // A non-numeric segment against an array is a mistake worth failing quietly on
      // rather than returning the array's own property (`length`, or worse, `map`).
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index < 0 ? current.length + index : index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    // Own properties only. Without this, a path of `constructor` or `__proto__` walks
    // out of the data and into the prototype chain, which is never what a workflow
    // author meant and is the first step of a prototype-pollution read.
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * The array a transform node operates on: the one it was configured with, else the
 * one it was handed.
 *
 * The third case is what makes these nodes chain. Every transform node that returns a
 * list returns it as `{ items, count }` rather than as a bare array, because a bare
 * array leaves nowhere to put the count — so filter → sort → aggregate would break at
 * every join unless the next node also looks inside `items`. It does, and that is why
 * the three compose without a `core.set` between them.
 */
export function incomingArray(
  configured: readonly unknown[] | undefined,
  input: unknown,
  nodeLabel: string,
): unknown[] {
  if (configured !== undefined) return [...configured];
  if (Array.isArray(input)) return [...input];
  if (input !== null && typeof input === "object") {
    const items = (input as Record<string, unknown>).items;
    if (Array.isArray(items)) return [...items];
  }
  throw new NodeError(
    `${nodeLabel} needs a list to work on. The previous node produced ${describeKind(input)}, ` +
      `so either connect it to a node that outputs a list or fill in its "items" field.`,
  );
}

/** What the user was actually handed, in the words of the thing they can see. */
function describeKind(value: unknown): string {
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return keys.length === 0 ? "an empty object" : `an object (${keys.slice(0, 4).join(", ")})`;
  }
  return `a ${typeof value}`;
}

/**
 * A comparison key that sorts and de-duplicates the way a person expects.
 *
 * Numbers compare as numbers and everything else as text, because `[10, 9]` sorting to
 * `[10, 9]` — which is what `Array.prototype.sort`'s default string comparison does — is
 * a bug report every time.
 */
export function compareValues(left: unknown, right: unknown): number {
  const leftNumber = asComparableNumber(left);
  const rightNumber = asComparableNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  // Missing values sort last in ascending order, which keeps a half-populated list
  // readable instead of burying the rows that do have the field.
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
  if (right === null || right === undefined) return -1;
  return String(left).localeCompare(String(right));
}

/**
 * `null` for anything that is not meaningfully a number, so `compareValues` can fall
 * back to text. Note `""` and `"  "` are excluded deliberately: `Number("")` is 0, and
 * an empty cell is not a zero.
 */
function asComparableNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A stable identity for de-duplication. Objects compare by their JSON. */
export function identityKey(value: unknown): string {
  if (typeof value === "string") return `s:${value}`;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") {
    try {
      return `j:${JSON.stringify(value)}`;
    } catch {
      // A cycle cannot come from JSON input, but a node upstream could build one.
      return `j:${String(value)}`;
    }
  }
  return `p:${String(value)}`;
}
