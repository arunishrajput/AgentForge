import { z } from "zod";

/**
 * **What a webhook or a form may answer with — Phase 40** (D190, `CONTRACT.md` → *Respond*).
 *
 * `core.respond` lets a workflow decide what its caller is told. The caller is a stranger or another
 * system with no session, so **what a workflow may say is an allowlist**, enforced in two places that
 * read this file: the node, which refuses a configuration outside it (so the author hears at save
 * time, not from a caller), and the receiver, which re-checks what a run recorded before it writes a
 * byte of response (so a step row edited by hand, or written by an older revision, cannot widen it).
 *
 *   status   200–299 and 400–599. Never 1xx or 3xx: a redirect chosen by a workflow is an open
 *            redirect on this origin's webhook, and nothing here needs one
 *   headers  six named ones. `Content-Type` is never the workflow's to set — the body is JSON and is
 *            always sent as JSON — and neither is `Set-Cookie`, `Location`, CORS or a security header
 *   body     a JSON object, built by lookup only: the engine resolves `{{ }}` references and nothing
 *            else runs (D17). At most 64 KB serialised
 */
export const RESPOND_TYPE = "core.respond";

export const RESPOND_HEADERS = [
  "cache-control",
  "content-language",
  "etag",
  "retry-after",
  "x-request-id",
  "x-correlation-id",
] as const;
const HEADER_SET: ReadonlySet<string> = new Set(RESPOND_HEADERS);

/** The triggers that leave a caller waiting for an answer. Strings, not imports: this file must not reach the registry. */
export const ANSWERABLE_TRIGGERS: readonly string[] = ["core.webhook_trigger", "core.form_trigger"];

export const MAX_RESPONSE_BODY_BYTES = 64 * 1024;
const HEADER_VALUE_MAX = 200;
export const MAX_RESPONSE_HEADERS = RESPOND_HEADERS.length;

/** 204 and 205 have no body by definition; sending one is an error in `Response`. */
const NO_BODY: ReadonlySet<number> = new Set([204, 205]);

export function allowedStatus(status: number): boolean {
  return Number.isInteger(status) && ((status >= 200 && status <= 299) || (status >= 400 && status <= 599));
}

/** Printable ASCII only: a header value with a line break in it is a response-splitting attempt. */
const HEADER_VALUE = /^[\x20-\x7e]*$/;

const headersSchema = z
  .record(z.string(), z.string())
  .superRefine((headers, ctx) => {
    const seen = new Set<string>();
    for (const [name, value] of Object.entries(headers)) {
      const key = name.trim().toLowerCase();
      if (!HEADER_SET.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `“${name}” is not a header a workflow may set — the allowed ones are ${RESPOND_HEADERS.join(", ")}`,
        });
      }
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: [name], message: `“${name}” is set twice` });
      seen.add(key);
      if (value.length > HEADER_VALUE_MAX || !HEADER_VALUE.test(value)) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `The value of “${name}” has to be plain printable text of at most ${HEADER_VALUE_MAX} characters`,
        });
      }
    }
  });

export const respondConfigSchema = z.object({
  status: z
    .number()
    .int()
    .min(200)
    .max(599)
    .refine(allowedStatus, "A workflow may answer 200–299 or 400–599 — never a redirect")
    .default(200),
  body: z.record(z.string(), z.unknown()).default({}),
  headers: headersSchema.default({}),
});

/** What the step records as its output, and what the receiver reads back. */
export const respondAnswerSchema = z.object({
  status: z.number().int().refine(allowedStatus),
  headers: headersSchema,
  body: z.record(z.string(), z.unknown()),
});
export type RespondAnswer = z.infer<typeof respondAnswerSchema>;

export function bodySize(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body ?? {}), "utf8");
}

/**
 * The answer a run recorded, or null when it never reached a Respond step. **The first one that
 * succeeded wins** — a workflow answers once, and a second Respond on another branch (or after a
 * Loop) changes nothing the caller has already been told. A step that failed answers nothing, and the
 * output is parsed afresh: whatever a row holds is checked against the allowlist before it is sent.
 */
export function answerFromSteps(
  steps: readonly { seq?: number; nodeType: string; status: string; output: unknown }[],
): RespondAnswer | null {
  const candidates = steps
    .filter((step) => step.nodeType === RESPOND_TYPE && step.status === "succeeded")
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const step of candidates) {
    const parsed = respondAnswerSchema.safeParse(step.output);
    if (parsed.success && bodySize(parsed.data.body) <= MAX_RESPONSE_BODY_BYTES) return parsed.data;
  }
  return null;
}

/** The HTTP response for an answer. The body is always JSON, and always sent as JSON. */
export function responseFor(answer: RespondAnswer): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(answer.headers)) headers.set(name.trim().toLowerCase(), value);
  headers.set("x-content-type-options", "nosniff");
  if (NO_BODY.has(answer.status)) return new Response(null, { status: answer.status, headers });
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers });
}
