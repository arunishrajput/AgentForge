/**
 * `{{ path }}` interpolation for node config.
 *
 * Deliberately not an expression language. There is no eval, no Function, no
 * operators — only dotted lookups into a plain object. CLAUDE.md forbids arbitrary
 * user code execution in any form, and a workflow config field is exactly the kind
 * of place a template engine would smuggle it back in.
 *
 * A value that is *only* a reference keeps its type: `"{{input.count}}"` resolves
 * to the number 7, not the string "7". Anything else is string interpolation.
 * Unresolvable references become empty strings rather than throwing, so one typo
 * in a label cannot fail a run.
 */

const REFERENCE = /\{\{\s*([\w.[\]$-]+)\s*\}\}/g;
const WHOLE_REFERENCE = /^\{\{\s*([\w.[\]$-]+)\s*\}\}$/;

/** `a.b[0].c` → `["a", "b", "0", "c"]`. */
function segments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment.length > 0);
}

function lookup(scope: unknown, path: string): unknown {
  let current = scope;
  for (const segment of segments(path)) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Resolves one value. Recurses through arrays and plain objects. */
export function resolveValue(value: unknown, scope: unknown): unknown {
  if (typeof value === "string") {
    const whole = WHOLE_REFERENCE.exec(value);
    if (whole) return lookup(scope, whole[1]);
    return value.replace(REFERENCE, (_, path: string) =>
      stringify(lookup(scope, path)),
    );
  }

  if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope));

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveValue(item, scope),
      ]),
    );
  }

  return value;
}

/** Resolves a whole node config against the run scope. */
export function resolveConfig(
  config: Record<string, unknown>,
  scope: unknown,
): Record<string, unknown> {
  return resolveValue(config, scope) as Record<string, unknown>;
}
