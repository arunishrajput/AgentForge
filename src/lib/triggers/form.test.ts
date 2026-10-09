import assert from "node:assert/strict";
import { test } from "node:test";

import { formTrigger } from "@/lib/nodes/core/form-trigger";
import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

import {
  checkSubmission,
  formConfigSchema,
  formTriggerNode,
  formUrl,
  HONEYPOT_FIELD,
  LONG_TEXT_MAX,
  optionsOf,
  readFormConfig,
  TEXT_MAX,
  type FormField,
} from "./form";

/**
 * **The form trigger's rules — Phase 40, D189.** The receiver and the page both apply
 * `checkSubmission`, so what a stranger may submit is asserted here, once, field type by field type.
 */

const field = (overrides: Partial<FormField> & { name: string }): FormField => ({
  label: overrides.name,
  type: "text",
  required: false,
  options: "",
  ...overrides,
});

test("a required field that is missing or blank is refused, naming that field only", () => {
  const fields = [field({ name: "name", required: true }), field({ name: "note" })];
  for (const body of [{}, { name: "" }, { name: "   " }, { name: null }]) {
    const result = checkSubmission(fields, body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(Object.keys(result.errors), ["name"]);
  }
});

test("only declared fields get through — a stranger cannot put a key of their choosing into the run", () => {
  const result = checkSubmission([field({ name: "name" })], { name: "Ada", admin: true, __proto__: { x: 1 }, constructor: "no" });
  assert.deepEqual(result, { ok: true, values: { name: "Ada" } });
});

test("every declared field is in the result, empty when left blank, so a reference always resolves", () => {
  const fields = [
    field({ name: "a" }),
    field({ name: "n", type: "number" }),
    field({ name: "c", type: "checkbox" }),
    field({ name: "s", type: "select", options: "x, y" }),
    field({ name: "d", type: "date" }),
  ];
  assert.deepEqual(checkSubmission(fields, {}), { ok: true, values: { a: "", n: null, c: false, s: "", d: "" } });
});

test("text is trimmed and capped; long text allows ten times as much", () => {
  assert.deepEqual(checkSubmission([field({ name: "t" })], { t: "  hi  " }), { ok: true, values: { t: "hi" } });
  assert.equal(checkSubmission([field({ name: "t" })], { t: "x".repeat(TEXT_MAX + 1) }).ok, false);
  assert.equal(checkSubmission([field({ name: "t", type: "longtext" })], { t: "x".repeat(TEXT_MAX + 1) }).ok, true);
  assert.equal(checkSubmission([field({ name: "t", type: "longtext" })], { t: "x".repeat(LONG_TEXT_MAX + 1) }).ok, false);
});

test("a non-string where text is expected is refused rather than coerced", () => {
  for (const type of ["text", "longtext", "email", "select", "date"] as const) {
    const result = checkSubmission([field({ name: "v", type, options: "a" })], { v: { nested: true } });
    assert.equal(result.ok, false, type);
  }
});

test("email: a plausible address passes, the rest do not", () => {
  const fields = [field({ name: "e", type: "email" })];
  assert.equal(checkSubmission(fields, { e: "ada@example.com" }).ok, true);
  for (const bad of ["ada", "ada@", "@example.com", "ada@example", "a b@example.com", `${"x".repeat(250)}@e.co`]) {
    assert.equal(checkSubmission(fields, { e: bad }).ok, false, bad);
  }
});

test("number: a number or a numeric string becomes a number; anything else is refused", () => {
  const fields = [field({ name: "n", type: "number" })];
  assert.deepEqual(checkSubmission(fields, { n: 4.5 }), { ok: true, values: { n: 4.5 } });
  assert.deepEqual(checkSubmission(fields, { n: " 12 " }), { ok: true, values: { n: 12 } });
  for (const bad of ["abc", "1e999", Number.NaN, Infinity, [], true]) {
    assert.equal(checkSubmission(fields, { n: bad as never }).ok, false, String(bad));
  }
});

test("select: only a listed option is accepted", () => {
  const fields = [field({ name: "plan", type: "select", options: "Free, Team\nEnterprise" })];
  assert.equal(checkSubmission(fields, { plan: "Team" }).ok, true);
  assert.equal(checkSubmission(fields, { plan: "Enterprise" }).ok, true);
  assert.equal(checkSubmission(fields, { plan: "team" }).ok, false);
  assert.equal(checkSubmission(fields, { plan: "Platinum" }).ok, false);
});

test("checkbox: true or false, and a required one has to be ticked", () => {
  const optional = [field({ name: "c", type: "checkbox" })];
  assert.deepEqual(checkSubmission(optional, { c: true }), { ok: true, values: { c: true } });
  assert.deepEqual(checkSubmission(optional, { c: false }), { ok: true, values: { c: false } });
  assert.equal(checkSubmission(optional, { c: "yes" as never }).ok, false);
  const required = [field({ name: "c", type: "checkbox", required: true })];
  assert.equal(checkSubmission(required, { c: false }).ok, false);
  assert.equal(checkSubmission(required, {}).ok, false);
  assert.equal(checkSubmission(required, { c: true }).ok, true);
});

test("date: a real calendar date in YYYY-MM-DD", () => {
  const fields = [field({ name: "d", type: "date" })];
  assert.equal(checkSubmission(fields, { d: "2026-10-31" }).ok, true);
  assert.equal(checkSubmission(fields, { d: "2028-02-29" }).ok, true);
  for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "31/10/2026", "2026-1-1", "tomorrow"]) {
    assert.equal(checkSubmission(fields, { d: bad }).ok, false, bad);
  }
});

test("a message per bad field, so the page can show each beside its input", () => {
  const fields = [field({ name: "a", required: true }), field({ name: "b", type: "email" }), field({ name: "c" })];
  const result = checkSubmission(fields, { b: "nope" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(Object.keys(result.errors).sort(), ["a", "b"]);
});

test("the config: defaults, no duplicate names, a reserved honeypot name, a choice needs choices", () => {
  const parsed = formConfigSchema.parse({});
  assert.equal(parsed.submitLabel, "Submit");
  assert.ok(parsed.successMessage.length > 0 && parsed.failureMessage.length > 0);
  assert.deepEqual(parsed.fields, []);

  const issue = (fields: unknown) => formConfigSchema.safeParse({ fields });
  assert.equal(issue([{ name: "a", label: "A" }, { name: "A", label: "Again" }]).success, false);
  assert.equal(issue([{ name: HONEYPOT_FIELD, label: "x" }]).success, false);
  assert.equal(issue([{ name: "pick", label: "Pick", type: "select", options: " , " }]).success, false);
  assert.equal(issue([{ name: "pick", label: "Pick", type: "select", options: "a, b" }]).success, true);
  assert.equal(issue([{ name: "1st", label: "x" }]).success, false);
  assert.equal(issue([{ name: "__proto__", label: "x" }]).success, false);
  assert.equal(issue(Array.from({ length: 21 }, (_, i) => ({ name: `f${i}`, label: "x" }))).success, false);
});

test("a select's options are trimmed, de-duplicated and kept in order", () => {
  assert.deepEqual(optionsOf({ options: "b, a,\n b ,,c" }), ["b", "a", "c"]);
});

test("the node's own schema is the one the receiver reads — they cannot disagree", () => {
  assert.equal(formTrigger.configSchema, formConfigSchema);
});

const graphOf = (config: Record<string, unknown>): WorkflowGraph => ({
  version: GRAPH_VERSION,
  nodes: [{ id: "form", type: "core.form_trigger", position: { x: 0, y: 0 }, config }],
  edges: [],
});

test("a form that cannot be read is not served", () => {
  const node = formTriggerNode(graphOf({ fields: [{ name: "x", label: "x", type: "select", options: "" }] }))!;
  assert.equal(readFormConfig(node), null);
  assert.ok(readFormConfig(formTriggerNode(graphOf({}))!));
  assert.equal(formTriggerNode({ ...graphOf({}), nodes: [] }), undefined);
});

test("the form's address is the workflow's token behind /f/", () => {
  assert.equal(formUrl("https://x.test/", "tok"), "https://x.test/f/tok");
});
