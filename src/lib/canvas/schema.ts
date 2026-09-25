/**
 * JSON Schema → config form fields.
 *
 * The palette and every config form are built from `GET /api/nodes`, which serves
 * each node's Zod schema as JSON Schema. Hardcoding a form per node type would
 * mean every Phase 9 integration needs UI work — which is precisely what the
 * registry design exists to prevent (BUILD_PLAN.md → Phase 4 implementation
 * notes). So this file reads the schema instead.
 *
 * It handles the shapes the registry actually emits and falls back to a raw JSON
 * editor for anything it does not recognise, so an unfamiliar node is still
 * configurable rather than unreachable.
 */

export type FieldKind =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "record"
  | "value"
  | "json";

export interface SchemaField {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  maxLength?: number;
  min?: number;
  max?: number;
  defaultValue?: unknown;
}

interface JsonSchema {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: unknown;
  items?: JsonSchema;
  default?: unknown;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

/** `maxIterations` → "Max iterations". Node authors name config keys, not labels. */
export function humanise(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function kindOf(property: JsonSchema): FieldKind {
  // `z.unknown()` emits `{}` — no type at all. These are the fields that most often
  // hold a `{{ }}` reference, so they get the value editor rather than a JSON box.
  if (property.type === undefined && property.enum === undefined) return "value";
  if (property.enum !== undefined) return "enum";
  if (property.type === "boolean") return "boolean";
  if (property.type === "number" || property.type === "integer") return "number";
  if (property.type === "string") {
    return (property.maxLength ?? 0) > 200 ? "text" : "string";
  }
  // An open map (`z.record`) is a key/value editor; a closed object is raw JSON.
  if (property.type === "object") {
    const hasNamedProperties = Object.keys(property.properties ?? {}).length > 0;
    return !hasNamedProperties && property.additionalProperties !== undefined
      ? "record"
      : "json";
  }
  return "json";
}

export function describeFields(schema: unknown): SchemaField[] {
  const root = (schema ?? {}) as JsonSchema;
  const properties = root.properties ?? {};
  const required = new Set(root.required ?? []);

  return Object.entries(properties).map(([key, property]) => ({
    key,
    label: humanise(key),
    kind: kindOf(property),
    required: required.has(key),
    ...(property.enum === undefined
      ? {}
      : { options: property.enum.map((option) => String(option)) }),
    ...(property.maxLength === undefined ? {} : { maxLength: property.maxLength }),
    ...(property.minimum === undefined ? {} : { min: property.minimum }),
    ...(property.maximum === undefined ? {} : { max: property.maximum }),
    ...(property.default === undefined ? {} : { defaultValue: property.default }),
  }));
}

/**
 * The config a freshly dropped node starts with. Only schema defaults — a required
 * field with no default (Branch's `left`) is deliberately left absent so the node
 * reports `invalid_config` until it is filled in. The workflow still saves; it
 * just is not runnable yet, which is the honest state to show.
 */
export function defaultConfig(schema: unknown): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of describeFields(schema)) {
    if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
  }
  return config;
}

/** A stored config value, as text for an input. Objects and arrays render as JSON. */
export function encodeValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Editor text back to a stored value.
 *
 * Text stays text unless it is unambiguously a JSON literal, so `{{input.topic}}`
 * survives as the template string the engine expects while `3` becomes the number
 * 3 and `[1,2]` becomes an array. A string containing `{{` is never parsed — a
 * template reference is the one thing that must not be reinterpreted.
 */
export function decodeValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (trimmed.includes("{{")) return text;

  const looksLikeJson =
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{");

  if (!looksLikeJson) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}
