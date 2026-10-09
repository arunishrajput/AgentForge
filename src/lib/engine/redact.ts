import type { StepLog } from "@/lib/nodes/types";

import type { StepRecord } from "./types";

/**
 * **Secrets a run holds only in memory — Phase 38** (D178).
 *
 * An approval's link is the one secret a run *makes*: its token is stored only as a hash, and the
 * plaintext lives in the memory of the attempt that minted it, for the steps on its Ask path to send.
 * Everything the engine hands on to be kept — a step row's config, input, output, logs and error, the
 * run's output and error, a log line — passes through here first, and every occurrence of a token is
 * replaced. So the database, the run panel, the stream, a diagnosis prompt and an error workflow's
 * payload hold `…/approve#[removed]`, never a link that works.
 *
 * A token is 43 characters of base64url, so a plain substring replacement cannot match anything
 * that is not the token.
 */
export const REDACTED = "[removed]";

export function redactValue<T>(value: T, secrets: ReadonlySet<string>): T {
  if (secrets.size === 0) return value;
  return walk(value, secrets) as T;
}

function walk(value: unknown, secrets: ReadonlySet<string>): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => walk(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, secrets)]));
  }
  return value;
}

export function redactText(text: string, secrets: ReadonlySet<string>): string {
  let out = text;
  for (const secret of secrets) if (out.includes(secret)) out = out.replaceAll(secret, REDACTED);
  return out;
}

/** A copy of a step with every secret removed — the step the engine keeps in memory is untouched. */
export function redactStep(step: StepRecord, secrets: ReadonlySet<string>): StepRecord {
  if (secrets.size === 0) return step;
  return {
    ...step,
    config: walk(step.config, secrets),
    input: walk(step.input, secrets),
    output: walk(step.output, secrets),
    logs: step.logs.map((log) => redactLog(log, secrets)),
    error: step.error === null ? null : redactText(step.error, secrets),
  };
}

export function redactLog(log: StepLog, secrets: ReadonlySet<string>): StepLog {
  return secrets.size === 0 ? log : { ...log, message: redactText(log.message, secrets) };
}
