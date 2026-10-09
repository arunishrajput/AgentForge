"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Labelled, Select, Textarea, Toggle } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { checkSubmission, HONEYPOT_FIELD, LONG_TEXT_MAX, TEXT_MAX, type FormField } from "@/lib/triggers/form";
import type { PublicForm as PublicFormView } from "@/lib/triggers/form-page";

/**
 * **A hosted form, filled in by a stranger — Phase 40** (`DESIGN.md` → *Public pages*, D189).
 *
 * The checks here are courtesy: they use `checkSubmission`, the very function the receiver applies, so
 * the page and the server cannot disagree about what is acceptable — but **the server is what
 * decides**, and a `400` from it is shown against the same fields. A submission that gets past the
 * page without its checks (a script, a stale tab) meets the receiver's.
 *
 * Four states, all designed: the form, sending, sent, and a refusal that says what to do — a field to
 * correct, a wait, or "try again". The honeypot is an input no person sees (`aria-hidden`, off-screen,
 * out of the tab order) that a script filling in every input will fill.
 */
type Values = Record<string, string | boolean>;
type Phase =
  | { kind: "filling" }
  | { kind: "sending" }
  | { kind: "sent"; message: string }
  | { kind: "refused"; message: string };

function initial(form: PublicFormView): Values {
  const values: Values = {};
  for (const field of form.fields) values[field.name] = field.type === "checkbox" ? false : "";
  return values;
}

/** The page's fields as the shared rules read them — a select's choices go back to one string. */
function asRules(form: PublicFormView): FormField[] {
  return form.fields.map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options.join(","),
  }));
}

/** What the receiver said, whether it is the product's envelope or a workflow's own `core.respond` body. */
async function readAnswer(response: Response): Promise<{ message?: string; fields?: Record<string, string> }> {
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json || typeof json !== "object") return {};
  const error = json.error as { message?: unknown; details?: { fields?: Record<string, string> } } | undefined;
  const data = json.data as { message?: unknown } | undefined;
  const pick = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : undefined);
  return {
    message: pick(error?.message) ?? pick(data?.message) ?? pick(json.message) ?? pick(json.error),
    fields: error?.details?.fields,
  };
}

export function PublicForm({ token, form }: { token: string; form: PublicFormView }) {
  const [values, setValues] = useState<Values>(() => initial(form));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "filling" });
  const [trap, setTrap] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  // Hand focus to the outcome, so a screen reader hears it and a keyboard user is not left on a
  // button that has gone.
  useEffect(() => {
    if (phase.kind === "sent") resultRef.current?.focus();
  }, [phase.kind]);

  const focusFirst = (found: Record<string, string>) => {
    const name = form.fields.find((field) => found[field.name])?.name;
    if (!name) return;
    const element = formRef.current?.elements.namedItem(name);
    if (element instanceof HTMLElement) element.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phase.kind === "sending") return;

    const checked = checkSubmission(asRules(form), values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setPhase({ kind: "filling" });
      focusFirst(checked.errors);
      return;
    }
    setErrors({});
    setPhase({ kind: "sending" });

    try {
      const response = await fetch(`/api/form/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, [HONEYPOT_FIELD]: trap }),
        referrerPolicy: "no-referrer",
      });
      const answer = await readAnswer(response);

      if (response.ok) {
        setPhase({ kind: "sent", message: answer.message ?? form.successMessage });
        return;
      }
      if (response.status === 400 && answer.fields && Object.keys(answer.fields).length > 0) {
        setErrors(answer.fields);
        setPhase({ kind: "filling" });
        focusFirst(answer.fields);
        return;
      }
      if (response.status === 429) {
        const wait = Number(response.headers.get("retry-after"));
        setPhase({
          kind: "refused",
          message: `Too many submissions just now. Please try again in ${wait > 0 ? `${Math.ceil(wait / 60) <= 1 ? "a minute" : `${Math.ceil(wait / 60)} minutes`}` : "a little while"}.`,
        });
        return;
      }
      setPhase({ kind: "refused", message: answer.message ?? form.failureMessage });
    } catch {
      setPhase({ kind: "refused", message: "Could not reach the form. Check your connection and try again." });
    }
  };

  if (phase.kind === "sent") {
    return (
      <Card raised className="animate-rise p-6">
        <Badge tone="outline" icon="✓">
          Sent
        </Badge>
        <h1 ref={resultRef} tabIndex={-1} className="mt-3 text-xl font-bold tracking-tight text-pretty">
          {phase.message}
        </h1>
        <Button
          className="mt-5"
          onClick={() => {
            setValues(initial(form));
            setTrap("");
            setPhase({ kind: "filling" });
          }}
        >
          Send another response
        </Button>
      </Card>
    );
  }

  const sending = phase.kind === "sending";

  return (
    <Card raised className="animate-rise p-5 sm:p-6">
      {form.title && <h1 className="text-xl font-bold tracking-tight text-pretty">{form.title}</h1>}
      {form.description && (
        <p className="text-muted mt-2 text-sm leading-relaxed text-pretty whitespace-pre-wrap">{form.description}</p>
      )}

      <form ref={formRef} onSubmit={submit} noValidate className="relative mt-5 space-y-4">
        {form.fields.length === 0 && (
          <p className="text-muted text-sm">This form has nothing to fill in — pressing the button below sends it.</p>
        )}

        {form.fields.map((field) => {
          const label = (
            <>
              {field.label}
              {!field.required && field.type !== "checkbox" && <span className="text-muted font-normal"> (optional)</span>}
            </>
          );
          const common = {
            name: field.name,
            "aria-invalid": errors[field.name] ? (true as const) : undefined,
            disabled: sending,
          };
          const set = (value: string | boolean) => {
            setValues((current) => ({ ...current, [field.name]: value }));
            if (errors[field.name]) setErrors(({ [field.name]: _gone, ...rest }) => rest);
          };

          if (field.type === "checkbox") {
            return (
              <div key={field.name} className="space-y-1.5">
                <Toggle
                  {...common}
                  label={<>{field.label}{!field.required && <span className="text-muted font-normal"> (optional)</span>}</>}
                  checked={values[field.name] === true}
                  onChange={(event) => set(event.target.checked)}
                />
                {errors[field.name] && <p className="text-bad text-2xs animate-wiggle font-semibold">{errors[field.name]}</p>}
              </div>
            );
          }

          return (
            <Labelled key={field.name} label={label} error={errors[field.name]}>
              {field.type === "longtext" ? (
                <Textarea {...common} rows={5} maxLength={LONG_TEXT_MAX} value={String(values[field.name])} onChange={(event) => set(event.target.value)} />
              ) : field.type === "select" ? (
                <Select {...common} value={String(values[field.name])} onChange={(event) => set(event.target.value)}>
                  <option value="">Choose…</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  {...common}
                  type={field.type === "email" ? "email" : field.type === "date" ? "date" : "text"}
                  inputMode={field.type === "number" ? "decimal" : field.type === "email" ? "email" : undefined}
                  autoComplete={field.type === "email" ? "email" : "off"}
                  maxLength={field.type === "text" ? TEXT_MAX : undefined}
                  value={String(values[field.name])}
                  onChange={(event) => set(event.target.value)}
                />
              )}
            </Labelled>
          );
        })}

        {/* The honeypot: no person sees it, reaches it by keyboard, or hears it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Leave this empty
            <input
              type="text"
              name={HONEYPOT_FIELD}
              value={trap}
              onChange={(event) => setTrap(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>

        {phase.kind === "refused" && <Notice tone="bad" title={phase.message} />}

        <Button type="submit" tone="primary" size="lg" loading={sending} className="w-full sm:w-auto">
          {sending ? "Sending…" : form.submitLabel}
        </Button>
      </form>
    </Card>
  );
}
