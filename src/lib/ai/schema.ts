/**
 * JSON Schema → Gemini `Schema`.
 *
 * Gemini's `functionDeclarations.parameters` is **not** JSON Schema. It is a narrow
 * subset of OpenAPI 3.0, and an unknown key is a hard 400, not a warning. Measured
 * against the live API on 2026-09-26 with a schema Zod produces for a real node:
 *
 *   400 INVALID_ARGUMENT — Invalid JSON payload received.
 *   Unknown name "additionalProperties" at
 *   'tools[0].function_declarations[1].parameters.properties…'
 *
 * `z.toJSONSchema()` emits `$schema`, `additionalProperties` and `propertyNames` for
 * the registry's own node configs, so every agent tool would have been rejected. The
 * failure would have surfaced the first time an agent node ran — on the deployed app,
 * with a real key, which is to say during the demo.
 *
 * So this is an **allow-list**, not a deny-list: a key Gemini does not document is
 * dropped rather than passed through and hoped for. A new node with an exotic config
 * therefore degrades to a slightly vaguer tool signature instead of breaking the
 * agent.
 */

/** Keys Gemini's Schema accepts and we pass through unchanged. */
const SCALAR_KEYS = [
  "description",
  "title",
  "format",
  "nullable",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
] as const;

const TYPES = ["string", "number", "integer", "boolean", "array", "object", "null"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A `z.unknown()` field produces `{}` — no type at all, which Gemini cannot express.
 * Declaring it a string keeps the tool callable and says so in the description,
 * rather than dropping the field and leaving the model unable to fill a required
 * argument.
 */
const UNTYPED_NOTE = "Any JSON value, given as a string.";

export function toGeminiSchema(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return { type: "string", description: UNTYPED_NOTE };

  const out: Record<string, unknown> = {};

  for (const key of SCALAR_KEYS) {
    if (input[key] !== undefined) out[key] = input[key];
  }

  const type = typeof input.type === "string" && TYPES.includes(input.type)
    ? input.type
    : null;

  // `default` is dropped — it is not in the documented subset — but the value is
  // real information for the model, so it moves into the description instead.
  if (input.default !== undefined) {
    const note = `Defaults to ${JSON.stringify(input.default)}.`;
    out.description = out.description ? `${out.description} ${note}` : note;
  }

  if (type === "object") {
    out.type = "object";
    const properties = isRecord(input.properties) ? input.properties : {};
    const mapped: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(properties)) {
      mapped[name] = toGeminiSchema(value);
    }
    // An object with no properties is rejected by Gemini as an empty schema, so it
    // is described as a free-form JSON string instead — honest about what the model
    // can actually put there.
    if (Object.keys(mapped).length === 0) {
      return {
        type: "string",
        description: [out.description, "A JSON object, given as a string."]
          .filter(Boolean)
          .join(" "),
      };
    }
    out.properties = mapped;
    const required = Array.isArray(input.required)
      ? input.required.filter(
          (name): name is string => typeof name === "string" && name in mapped,
        )
      : [];
    if (required.length > 0) out.required = required;
    return out;
  }

  if (type === "array") {
    out.type = "array";
    out.items = toGeminiSchema(input.items);
    return out;
  }

  if (type) {
    out.type = type;
    return out;
  }

  // No usable type: `z.unknown()`, or an `anyOf`/`$ref` we deliberately do not chase.
  out.type = "string";
  out.description = out.description ? `${out.description} ${UNTYPED_NOTE}` : UNTYPED_NOTE;
  return out;
}

/**
 * A tool declaration's top-level `parameters`.
 *
 * Distinct from `toGeminiSchema` because the top level has one rule the nested case
 * does not: a tool with no configurable fields must omit `parameters` altogether.
 * Gemini rejects an object schema with no properties, and the nested fallback — call
 * it a JSON string — would be a lie about a tool that takes no arguments at all.
 */
export function toToolParameters(input: unknown): Record<string, unknown> | undefined {
  if (!isRecord(input)) return undefined;
  const properties = isRecord(input.properties) ? input.properties : {};
  if (Object.keys(properties).length === 0) return undefined;

  const schema = toGeminiSchema({ ...input, type: "object" });
  return schema.type === "object" ? schema : undefined;
}
