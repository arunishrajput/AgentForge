"use client";

import { useState, type ReactNode } from "react";

import { Input, Labelled, Textarea, Toggle } from "@/components/ui/field";
import type { ManualField } from "@/lib/nodes/core/manual-trigger";

/**
 * **What a run is started with — the trigger input, as a form or as JSON (Phase 31).**
 *
 * When the manual trigger declares fields, the panel asks for them by name, typed, with the
 * required ones marked; otherwise — and always, behind *Edit as JSON* — it is the raw box it
 * has been since Phase 8. **Both views edit one string**, the JSON the editor sends, so moving
 * between them loses nothing and there is one source of truth for "what will this run with".
 *
 * A required field is marked here and enforced twice over: by the editor before the run
 * starts, and by the trigger itself when it runs (`checkManualInput`).
 */
export function RunInput({
  fields,
  value,
  onChange,
  pinnedTrigger,
}: {
  /** The manual trigger's declared fields; empty when there are none. */
  fields: readonly ManualField[];
  /** The input as JSON text — the editor's single source of truth. */
  value: string;
  onChange: (value: string) => void;
  /** The trigger stands in with a pin (Phase 31), so a run starts from that instead. */
  pinnedTrigger: boolean;
}) {
  const [raw, setRaw] = useState(false);
  const useForm = fields.length > 0 && !raw;

  return (
    <section className="space-y-2">
      {pinnedTrigger && (
        <p className="text-muted text-2xs leading-relaxed">
          The trigger holds a pinned output, so Run starts from that and this input is not used.
        </p>
      )}
      {useForm ? (
        <FieldsForm fields={fields} value={value} onChange={onChange} />
      ) : (
        <JsonInput value={value} onChange={onChange} />
      )}
      {fields.length > 0 && (
        <button
          type="button"
          onClick={() => setRaw(!raw)}
          className="text-muted hover:text-ink text-xs underline underline-offset-4 transition-colors"
        >
          {raw ? "Use the form" : "Edit as JSON"}
        </button>
      )}
    </section>
  );
}

/** The input as an object, whatever the box holds — anything else reads as empty. */
function asObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = value.trim() === "" ? {} : JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function FieldsForm({
  fields,
  value,
  onChange,
}: {
  fields: readonly ManualField[];
  value: string;
  onChange: (value: string) => void;
}) {
  const values = asObject(value);
  const set = (name: string, next: unknown) => {
    const updated = { ...values };
    if (next === undefined) delete updated[name];
    else updated[name] = next;
    onChange(Object.keys(updated).length === 0 ? "" : JSON.stringify(updated, null, 2));
  };

  return (
    <fieldset className="min-w-0 space-y-3 border-0 p-0">
      <legend className="eyebrow mb-2">Run with</legend>
      {fields.map((field) => {
        const label = (
          <>
            {field.name}
            {field.required && <span className="text-warn text-2xs ml-1.5 font-medium">required</span>}
          </>
        );
        const current = values[field.name];
        switch (field.type) {
          case "boolean":
            return (
              <Toggle
                key={field.name}
                label={label}
                checked={current === true}
                onChange={(event) => set(field.name, event.target.checked)}
              />
            );
          case "number":
            return (
              <Labelled key={field.name} label={label}>
                <Input
                  type="number"
                  required={field.required}
                  value={typeof current === "number" ? current : ""}
                  onChange={(event) =>
                    set(field.name, event.target.value === "" ? undefined : Number(event.target.value))
                  }
                />
              </Labelled>
            );
          case "json":
            return (
              <JsonField
                key={field.name}
                label={label}
                required={field.required}
                value={current}
                onChange={(next) => set(field.name, next)}
              />
            );
          default:
            return (
              <Labelled key={field.name} label={label}>
                <Input
                  type="text"
                  required={field.required}
                  value={typeof current === "string" ? current : ""}
                  onChange={(event) => set(field.name, event.target.value === "" ? undefined : event.target.value)}
                />
              </Labelled>
            );
        }
      })}
    </fieldset>
  );
}

/** A `json` field: a box of its own, kept as typed until it parses. */
function JsonField({
  label,
  required,
  value,
  onChange,
}: {
  label: ReactNode;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(() => (value === undefined ? "" : JSON.stringify(value, null, 2)));
  const invalid = draft.trim() !== "" && !parses(draft);
  return (
    <Labelled label={label} error={invalid ? "Not valid JSON yet." : undefined}>
      <Textarea
        rows={3}
        required={required}
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (event.target.value.trim() === "") onChange(undefined);
          else if (parses(event.target.value)) onChange(JSON.parse(event.target.value));
        }}
        className="font-mono text-2xs"
      />
    </Labelled>
  );
}

function JsonInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const invalid = value.trim() !== "" && !parses(value);
  return (
    <Labelled
      label="Trigger input"
      hint={
        <>
          JSON handed to the trigger. Reach it with <code className="font-mono">{"{{input.x}}"}</code>.
        </>
      }
      error={invalid ? "Not valid JSON — the run will be blocked until this parses." : undefined}
    >
      <Textarea
        value={value}
        rows={3}
        spellCheck={false}
        placeholder={'{ "subject": "launch" }'}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-2xs"
      />
    </Labelled>
  );
}

function parses(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
