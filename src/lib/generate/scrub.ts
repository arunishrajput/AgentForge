/**
 * **What a secret looks like, so it can be taken out before a model reads anything — Phase 36.**
 *
 * The copilot's *explain* and *diagnose* answers read a workflow and, for a diagnosis, the record of
 * a run: the configuration a step ran with, what it was given, what it produced, what it logged.
 * None of that is meant to hold a credential — a node reaches its credential by kind through the
 * vault and never puts it in a step (`SECURITY.md` → *The copilot*) — and nothing is sent on the
 * strength of "meant to". This is the guarantee under the design: **anything shaped like a credential
 * this product stores is removed before the prompt is written**, whatever put it there.
 *
 * **No word boundary before a prefix.** A token glued to the text before it (`xsecret_…`) has none,
 * and `evidence.test.ts` found a Notion secret walking through on exactly that — so a shape is
 * matched wherever its prefix starts, at the price of the odd over-removal inside a longer word.
 *
 * Two rules, both deliberately narrow so a diagnosis can still read the evidence:
 *
 *  - **A shape per credential kind** (`SECRET_SHAPES`). Each is the form the provider issues — a
 *    Gemini key starts `AIza`, a Discord webhook is a URL with a token in its path — so a field
 *    that merely mentions Discord or holds a spreadsheet id is left alone. `scrub.test.ts` holds the
 *    table to `CREDENTIAL_KINDS` in both directions: a kind added later with no shape fails the build,
 *    which is the same discipline `ROTATION_RULES` is held to
 *  - **A field named like a secret** (`SECRET_FIELD`) — an `Authorization` header typed into an HTTP
 *    node, a `token` in a webhook body, a `?key=` in a URL. Exact names and `…_token`-style
 *    suffixes, never a bare `key`: the Sort node's field is called `key`, and hiding *which* field it
 *    sorts by would hide the very thing a diagnosis is often about
 *
 * **What it is not used for: an edit.** The copilot's edit answers with the whole workflow and must
 * copy every config value it does not change back verbatim (D163), so it reads config as the author
 * wrote it — a value replaced with `[removed]` here would come back as `[removed]` and Accept would
 * write it over the real one. That is Phase 35's boundary and it is unchanged: the author's own
 * configuration, read for the author. Explain and diagnose only *read*, so they read it scrubbed.
 */

/** What a removed value is replaced with — a word the model is told about, so it does not ask after it. */
export const REMOVED = "[removed]";

/**
 * One credential kind's shapes. Global regexes, because one string can hold several (a log line
 * quoting two URLs). Each is anchored on the provider's own prefix or host, never on length alone.
 */
export const SECRET_SHAPES: Record<string, RegExp[]> = {
  /** A Gemini API key: `AIza` and 35 more. */
  "llm.google": [/AIza[0-9A-Za-z_-]{30,}/g],
  /** A Groq API key: `gsk_` and its body. */
  "llm.groq": [/gsk_[A-Za-z0-9]{20,}/g],
  /** Google OAuth: the stored refresh token (`1//0…`) and any access token minted from it (`ya29.…`). */
  "google.oauth": [/1\/\/0[0-9A-Za-z_-]{20,}/g, /ya29\.[0-9A-Za-z_.-]{20,}/g],
  /** A Discord webhook URL — the token is its last path segment, and the URL is the credential. */
  "integration.discord": [/https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+/gi],
  /** A Slack incoming webhook URL. */
  "integration.slack": [/https?:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[\w/-]+/gi],
  /** A Notion internal integration secret — `secret_` (older) or `ntn_`. */
  "integration.notion": [/(?:secret|ntn)_[A-Za-z0-9]{20,}/g],
  /** A GitHub token: classic (`ghp_`, and the other `gh?_` kinds) or fine-grained (`github_pat_`). */
  "integration.github": [/gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g],
  /** An Airtable personal access token: `pat`, 14 characters, a dot, 64 hex. */
  "integration.airtable": [/pat[A-Za-z0-9]{14}\.[a-f0-9]{64}/g],
  /**
   * A Postgres connection string — all of it, not only the password: the user, host and database
   * are what a connection string is for, and the logger removes the same thing (`logging/logger.ts`).
   */
  "integration.postgres": [/postgres(?:ql)?:\/\/[^\s"'<>]+/gi],
};

/**
 * Shapes no single kind owns but every credential can travel in: a bearer or basic credential in a
 * header-like string, and a secret-named query parameter in any URL.
 */
const GENERIC_SHAPES: { pattern: RegExp; replace: string }[] = [
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, replace: `Bearer ${REMOVED}` },
  // `Basic` and `token` are also English words, so the credential after them must look like one:
  // a digit, base64's `+ / =`, or a capital inside a lower-case run ("Basic information" stays).
  {
    pattern: /\b(Basic|Token|token)\s+(?=[A-Za-z0-9._~+/=-]*(?:\d|[+/=]|[a-z][A-Z]))[A-Za-z0-9._~+/=-]{8,}/g,
    replace: `$1 ${REMOVED}`,
  },
  {
    pattern: /([?&](?:api[_-]?key|key|access[_-]?token|token|secret|client[_-]?secret|password|sig|signature)=)[^&#\s"'<>]+/gi,
    replace: `$1${REMOVED}`,
  },
];

/**
 * A field whose value is a secret by its name. Matched on the name with `-` and `_` taken as the
 * same character and case ignored: `Authorization`, `x-api-key`, `client_secret`, `github_token`,
 * `refreshToken`. **Not** a bare `key`, `id` or `auth` — see the module comment.
 */
const SECRET_FIELD =
  /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|x[-_]?api[-_]?key|api[-_]?key|x[-_]?goog[-_]?api[-_]?key|password|passwd|pwd|private[-_]?key|client[-_]?secret|secret|token|bearer|session(?:[-_]?id)?|connection[-_]?string|.*[-_]?(?:token|secret|password|api[-_]?key))$/i;

/** Whether a field is a secret by its name. Exported for the test's table. */
export function isSecretField(name: string): boolean {
  return SECRET_FIELD.test(name);
}

/** Every credential-shaped run in a string, replaced. */
export function scrubText(text: string): string {
  let out = text;
  for (const patterns of Object.values(SECRET_SHAPES)) {
    for (const pattern of patterns) out = out.replace(pattern, REMOVED);
  }
  for (const { pattern, replace } of GENERIC_SHAPES) out = out.replace(pattern, replace);
  return out;
}

/**
 * A JSON value with every secret taken out: strings scrubbed, and a secret-named field's value
 * replaced whole. A field's *name* is kept — "the request sent an Authorization header" is evidence;
 * its value is not. Arrays and objects are walked; anything else is returned as it is.
 */
export function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      const named = isSecretField(key) && field !== null && field !== "" && typeof field !== "boolean";
      out[scrubText(key)] = named ? REMOVED : scrubValue(field);
    }
    return out;
  }
  return value;
}
