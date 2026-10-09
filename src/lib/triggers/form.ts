import { z } from "zod";

import type { WorkflowGraph, WorkflowNode } from "@/lib/workflow/graph";

/**
 * **The form trigger's rules — Phase 40** (D189, `CONTRACT.md` → *Trigger shapes* → *Form*).
 *
 * A form is a hosted page at `/f/<token>` that a stranger fills in, and a route that checks what
 * they sent and starts a run. Everything about *what a submission may be* lives here, in one pure
 * module with no database and no node registry, so the page, the route, the node and the tests all
 * read the same rules — and the page's checks, which are courtesy, can never disagree with the
 * route's, which are the law. **The server validates; the page only helps.**
 *
 * The token is the workflow's `webhookToken` column (D41): a workflow has exactly one trigger, so the
 * same 192 bits serve whichever of the two public surfaces its trigger node selects, and rotating
 * it kills the link whichever it is.
 */

export const FORM_TRIGGER_TYPE = "core.form_trigger";

export const FORM_FIELD_TYPES = ["text", "longtext", "email", "number", "select", "checkbox", "date"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const MAX_FORM_FIELDS = 20;

/**
 * The hidden input a person never sees and a script fills in. A submission that carries it filled is
 * answered exactly like a good one and starts nothing — a bot is told it worked, and learns nothing
 * from the difference. A declared field may not take the name, so a real answer can never be mistaken
 * for the trap.
 */
export const HONEYPOT_FIELD = "hp_website";

/**
 * What the route will read. A submission becomes the trigger's output, is written to the run row and
 * to a step row, and is interpolated into every `{{trigger.x}}` downstream — so an unbounded body
 * from a page with no session is an unbounded write to Neon (the webhook's reasoning, with a lower
 * cap: twenty fields of at most 5,000 characters is under 32 KB only by a margin, which is the point).
 */
export const MAX_FORM_BODY_BYTES = 32 * 1024;

/** The longest a text answer may be. A long-text answer may be ten times this. */
export const TEXT_MAX = 500;
export const LONG_TEXT_MAX = 5_000;
const EMAIL_MAX = 254;

export const formFieldSchema = z.object({
  /** What `{{trigger.<name>}}` reaches, and the key in the submission. Letters, digits and underscores. */
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, "A field name starts with a letter and uses letters, digits and underscores"),
  /** What the visitor reads above the input. */
  label: z.string().trim().min(1).max(120),
  type: z.enum(FORM_FIELD_TYPES).default("text"),
  required: z.boolean().default(false),
  /** A select's choices, separated by commas or new lines. Ignored by every other type. */
  options: z.string().max(1_000).default(""),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formConfigSchema = z
  .object({
    title: z.string().trim().max(120).default(""),
    description: z.string().trim().max(1_000).default(""),
    fields: z.array(formFieldSchema).max(MAX_FORM_FIELDS).default([]),
    submitLabel: z.string().trim().min(1).max(40).default("Submit"),
    successMessage: z.string().trim().min(1).max(500).default("Thanks — your response was received."),
    failureMessage: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .default("Something went wrong, and your response may not have been received. Please try again in a moment."),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.fields.forEach((field, index) => {
      const key = field.name.toLowerCase();
      if (field.name === HONEYPOT_FIELD) {
        ctx.addIssue({ code: "custom", path: ["fields", index, "name"], message: `"${HONEYPOT_FIELD}" is reserved` });
      }
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["fields", index, "name"], message: `Two fields are called "${field.name}"` });
      }
      seen.add(key);
      if (field.type === "select" && optionsOf(field).length === 0) {
        ctx.addIssue({ code: "custom", path: ["fields", index, "options"], message: `"${field.label}" is a choice with no choices` });
      }
    });
  });
export type FormConfig = z.infer<typeof formConfigSchema>;

/** A select's choices, trimmed, de-duplicated and in the order written. */
export function optionsOf(field: Pick<FormField, "options">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of field.options.split(/[\n,]/)) {
    const option = raw.trim();
    if (option === "" || seen.has(option)) continue;
    seen.add(option);
    out.push(option);
  }
  return out;
}

export function formTriggerNode(graph: WorkflowGraph): WorkflowNode | undefined {
  return graph.nodes.find((node) => node.type === FORM_TRIGGER_TYPE);
}

/**
 * The form's config parsed through the node's own schema, or null when it cannot be — a half-typed
 * `{{ }}` reference, a field with no choices. **A form that cannot be read is not served**: the page
 * and the route both answer as if there were no form, rather than render something other than what
 * the author configured.
 */
export function readFormConfig(node: WorkflowNode): FormConfig | null {
  const parsed = formConfigSchema.safeParse(node.config ?? {});
  return parsed.success ? parsed.data : null;
}

export function formUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/f/${token}`;
}

export type SubmissionResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/**
 * Check a submission against the declared fields and return the values the run will start with.
 *
 * **Only declared fields get through** — anything else in the body is dropped, never passed on, so a
 * stranger cannot put a key of their choosing into `{{trigger.…}}`. **Every declared field is in the
 * result**, empty when it was left blank (`""`, `null` for a number, `false` for a checkbox): a
 * reference to a field nobody filled in then resolves to something, instead of the successful run
 * with a blank cell that D58 warned about.
 */
export function checkSubmission(fields: readonly FormField[], body: Record<string, unknown>): SubmissionResult {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const raw = Object.hasOwn(body, field.name) ? body[field.name] : undefined;
    const blank = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    const fail = (message: string) => {
      errors[field.name] = message;
    };

    if (field.type === "checkbox") {
      const checked = raw === true;
      if (raw !== undefined && raw !== null && typeof raw !== "boolean") fail("Tick or untick this box.");
      else if (field.required && !checked) fail("This box has to be ticked.");
      values[field.name] = checked;
      continue;
    }

    if (blank) {
      if (field.required) fail("This is required.");
      values[field.name] = field.type === "number" ? null : "";
      continue;
    }

    if (field.type === "number") {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
      if (!Number.isFinite(n)) fail("Enter a number.");
      else values[field.name] = n;
      continue;
    }

    if (typeof raw !== "string") {
      fail("Enter text.");
      continue;
    }
    const text = raw.trim();

    switch (field.type) {
      case "text":
        if (text.length > TEXT_MAX) fail(`Keep this under ${TEXT_MAX} characters.`);
        else values[field.name] = text;
        break;
      case "longtext":
        if (text.length > LONG_TEXT_MAX) fail(`Keep this under ${LONG_TEXT_MAX} characters.`);
        else values[field.name] = text;
        break;
      case "email":
        if (text.length > EMAIL_MAX || !EMAIL.test(text)) fail("Enter an email address like name@example.com.");
        else values[field.name] = text;
        break;
      case "select":
        if (!optionsOf(field).includes(text)) fail("Choose one of the options.");
        else values[field.name] = text;
        break;
      case "date":
        if (!isDate(text)) fail("Enter a date like 2026-10-31.");
        else values[field.name] = text;
        break;
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/**
 * Per-instance limits (`lib/ratelimit.ts` says why that is all it is). A whole form takes 120
 * submissions in ten minutes, and one address 12 of them — the second so that one spammer cannot use
 * up the first and shut everybody else out, which a per-form limit alone would let them do.
 */
export const FORM_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const FORM_LIMIT_PER_FORM = 120;
export const FORM_LIMIT_PER_ADDRESS = 12;
