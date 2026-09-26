"use client";

import { useState } from "react";

import {
  decodeValue,
  describeFields,
  encodeValue,
  type SchemaField,
} from "@/lib/canvas/schema";

/**
 * A node's configuration form, generated from its schema.
 *
 * `GET /api/nodes` serves each node's Zod schema as JSON Schema; `lib/canvas/schema`
 * turns that into field descriptors; this renders them. No node type is named
 * anywhere in this file, so a node added in a later phase gets a working config
 * panel for free.
 *
 * Text fields keep a local draft so typing is never fought by the value round trip
 * — `3` becoming the number 3 must not reformat what is under the cursor. The
 * parent remounts this form when the selection changes (`key={nodeId}`), which is
 * what reloads the drafts.
 */
// Every control in a generated config form. `field` is the shared control style
// from `globals.css`, so a node added in a later phase inherits it for free.
const inputClass = "field";

export function ConfigForm({
  schema,
  config,
  onChange,
}: {
  schema: unknown;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const fields = describeFields(schema);

  if (fields.length === 0) {
    return (
      <p className="text-muted text-ui">This node has no configuration.</p>
    );
  }

  const set = (key: string, value: unknown) => {
    const next = { ...config };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <Field key={field.key} field={field} value={config[field.key]} onChange={set} />
      ))}
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const caption = (
    <span className="mb-1 flex items-baseline gap-1.5">
      <span className="text-ui font-medium">{field.label}</span>
      {field.required && <span className="text-2xs text-warn">required</span>}
    </span>
  );

  // A `label` may wrap exactly one control. The record editor is a list of rows
  // with its own buttons, so it gets a group with a heading instead — wrapping it
  // would make clicking the caption focus an arbitrary row.
  if (field.kind === "record") {
    return (
      <div role="group" aria-label={field.label} className="block">
        {caption}
        <Control field={field} value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <label className="block">
      {caption}
      <Control field={field} value={value} onChange={onChange} />
    </label>
  );
}

function Control({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  switch (field.kind) {
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(field.key, event.target.checked)}
          className="accent-accent h-4 w-4 cursor-pointer align-middle"
        />
      );

    case "enum":
      return (
        <select
          value={typeof value === "string" ? value : (field.defaultValue as string) ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
          className={inputClass}
        >
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case "number":
      return (
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? value : ""}
          onChange={(event) =>
            onChange(
              field.key,
              event.target.value === "" ? undefined : Number(event.target.value),
            )
          }
          className={inputClass}
        />
      );

    case "record":
      return <RecordEditor field={field} value={value} onChange={onChange} />;

    case "text":
      return <TextControl field={field} value={value} onChange={onChange} multiline />;

    case "json":
      return <JsonControl field={field} value={value} onChange={onChange} />;

    default:
      return <TextControl field={field} value={value} onChange={onChange} />;
  }
}

/** Single-line and multi-line text, and the `z.unknown()` value editor. */
function TextControl({
  field,
  value,
  onChange,
  multiline,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(() => encodeValue(value));
  const isValue = field.kind === "value";

  const update = (text: string) => {
    setDraft(text);
    // A plain string field stores the text as typed. A `value` field may hold a
    // number, a boolean or a template, so it goes through decodeValue.
    onChange(field.key, isValue ? decodeValue(text) : text);
  };

  const shared = {
    value: draft,
    onChange: (event: { target: { value: string } }) => update(event.target.value),
    maxLength: field.maxLength,
    className: inputClass,
    placeholder: isValue ? "value, or {{input.field}}" : undefined,
  };

  return (
    <>
      {multiline ? (
        <textarea {...shared} rows={3} className={`${inputClass} resize-y font-mono`} />
      ) : (
        <input type="text" {...shared} />
      )}
      {isValue && (
        <span className="text-muted mt-1 block text-2xs">
          Literal, or a reference like <code>{"{{input.topic}}"}</code>.
        </span>
      )}
    </>
  );
}

/** Arrays and closed objects: raw JSON, validated as you type. */
function JsonControl({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const [draft, setDraft] = useState(() =>
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  const update = (text: string) => {
    setDraft(text);
    if (text.trim() === "") {
      setError(null);
      onChange(field.key, undefined);
      return;
    }
    try {
      onChange(field.key, JSON.parse(text));
      setError(null);
    } catch {
      setError("Not valid JSON — the last valid value is still saved.");
    }
  };

  return (
    <>
      <textarea
        value={draft}
        rows={4}
        onChange={(event) => update(event.target.value)}
        className={`${inputClass} resize-y font-mono`}
        placeholder="[]"
      />
      {error && <span className="mt-1 block text-2xs text-warn">{error}</span>}
    </>
  );
}

/**
 * An open map — `core.set`'s `fields` is the one the demo edits. Rows are held
 * locally so a key can be empty mid-typing without dropping the row.
 */
function RecordEditor({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const [rows, setRows] = useState<{ key: string; text: string }[]>(() =>
    Object.entries((value ?? {}) as Record<string, unknown>).map(([key, entry]) => ({
      key,
      text: encodeValue(entry),
    })),
  );

  const commit = (next: { key: string; text: string }[]) => {
    setRows(next);
    const record: Record<string, unknown> = {};
    for (const row of next) {
      if (row.key.trim() === "") continue;
      record[row.key] = decodeValue(row.text) ?? "";
    }
    onChange(field.key, record);
  };

  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="flex gap-1.5">
          <input
            type="text"
            value={row.key}
            placeholder="key"
            onChange={(event) =>
              commit(rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
            }
            className={`${inputClass} w-2/5`}
          />
          <input
            type="text"
            value={row.text}
            placeholder="value or {{input.x}}"
            onChange={(event) =>
              commit(rows.map((r, i) => (i === index ? { ...r, text: event.target.value } : r)))
            }
            className={inputClass}
          />
          <button
            type="button"
            aria-label={`Remove ${row.key || "field"}`}
            onClick={() => commit(rows.filter((_, i) => i !== index))}
            className="btn btn-ghost shrink-0 px-1.5"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, { key: "", text: "" }])}
        className="text-muted hover:text-ink text-xs underline underline-offset-4 transition-colors"
      >
        Add field
      </button>
    </div>
  );
}
