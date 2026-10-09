import type { RunTest } from "@/lib/engine/partial";
import type { StepRecord, StepStatus } from "@/lib/engine/types";

import { scrubText, scrubValue } from "./scrub";

/**
 * **A failed run, as a diagnosis is allowed to see it — Phase 36.**
 *
 * `BUILD_PLAN.md` → *Phase 36*: the copilot "sends the failed step's error, its config, upstream
 * outputs **truncated**, and the graph". This module is the run half of that, and it exists so the
 * three things that make run data safe to show a model happen in one place, in order, under test:
 *
 *  1. **Choose.** The step that failed — its error, the config it ran with, what it was given, the
 *     last lines it logged — and what the steps before it produced. Not every step of a long run:
 *     the ones nearest the failure, newest last, with a count of what was left out
 *  2. **Scrub, before anything is cut.** Every value goes through `scrubValue` first, because a
 *     credential cut in half by truncation no longer has the shape that identifies it
 *  3. **Bound.** Structurally — long strings, long lists, wide or deep objects are cut where they
 *     are, so a field's *name* survives even when its value does not ("the body has `msg`, not
 *     `message`" is the commonest diagnosis there is) — and then each value as a whole
 *
 * **Run data is untrusted.** A webhook body is text somebody else wrote, and so is an API's answer
 * or a model's output. Nothing here interprets it; `diagnosePrompt` hands it to the model as data,
 * inside markers unique to the request, under a rule never to follow it.
 */

/** A string inside a value is cut past this many characters. */
export const STRING_MAX = 400;
/** A list keeps this many items, then says how many more there were. */
export const ARRAY_MAX = 8;
/** An object keeps this many fields, then says how many more there were. */
export const KEYS_MAX = 25;
/** Nesting deeper than this is summarised. */
export const DEPTH_MAX = 5;
/** One value — a config, an input, an output — serialised, at most this long. */
export const VALUE_MAX = 1_500;
/** An error message, at most this long. */
export const ERROR_MAX = 1_000;
/** The failed step's log, its last this-many lines. */
export const LOG_LINES = 12;
/** One log line, at most this long. */
export const LOG_LINE_MAX = 300;
/** The steps before the failure that are shown — the nearest ones. */
export const BEFORE_MAX = 8;

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (${text.length - max} more characters)`;
}

/**
 * A value cut down where it is, so it stays readable JSON with its field names intact. Strings,
 * lists, objects and depth each have their own limit; a marker says what was left out. Then the
 * whole is held to `max` characters, as a string cut if the structure alone did not get it there.
 */
export function truncateValue(value: unknown, max = VALUE_MAX): unknown {
  const walk = (current: unknown, depth: number): unknown => {
    if (typeof current === "string") return cut(current, STRING_MAX);
    if (current === null || typeof current !== "object") return current;
    if (depth >= DEPTH_MAX) return Array.isArray(current) ? `[a list of ${current.length}]` : "{…}";
    if (Array.isArray(current)) {
      const kept = current.slice(0, ARRAY_MAX).map((item) => walk(item, depth + 1));
      return current.length > ARRAY_MAX ? [...kept, `… ${current.length - ARRAY_MAX} more items`] : kept;
    }
    const entries = Object.entries(current);
    const out: Record<string, unknown> = {};
    for (const [key, field] of entries.slice(0, KEYS_MAX)) out[key] = walk(field, depth + 1);
    if (entries.length > KEYS_MAX) out["…"] = `${entries.length - KEYS_MAX} more fields`;
    return out;
  };

  const shaped = walk(value, 0);
  const text = JSON.stringify(shaped);
  if (text === undefined || text.length <= max) return shaped;
  return cut(text, max);
}

/** Scrub, then bound — never the other way round (see the module comment). */
function safe(value: unknown, max = VALUE_MAX): unknown {
  return truncateValue(scrubValue(value), max);
}

function safeText(text: string, max: number): string {
  return cut(scrubText(text), max);
}

/** What the evidence names a step by. */
interface Named {
  step: string;
  label?: string;
  type: string;
  /** Which pass of a loop, from 1 — only when it is past the first. */
  pass?: number;
}

export interface FailedStepEvidence extends Named {
  error: string | null;
  config: unknown;
  input: unknown;
  logs: string[];
}

export interface EarlierStepEvidence extends Named {
  status: StepStatus;
  /** What it produced. Absent for a step that did not run here — switched off. */
  output?: unknown;
}

export interface RunEvidence {
  run: {
    status: string;
    trigger: string;
    error: string | null;
    /** The workflow version it executed, when known. */
    version: number | null;
    /** A test run, and of what — a partial test ran less than the workflow does. */
    test: string | null;
  };
  /** Null when the run stopped between steps — out of time, or at a limit. */
  failed: FailedStepEvidence | null;
  /** The steps that finished before it, nearest last. */
  before: EarlierStepEvidence[];
  /** How many earlier steps were left out of `before`. */
  omitted: number;
}

/** A step's facts that every diagnosis reads. */
type EvidenceStep = Pick<
  StepRecord,
  "seq" | "nodeId" | "nodeType" | "iteration" | "status" | "config" | "input" | "output" | "logs" | "error"
>;

/** What kind of test a run was, in words — a partial test ran less than the workflow does. */
const TEST_WORDS: Record<RunTest["scope"], string> = {
  workflow: "a test of the whole workflow",
  node: "a test of one step on its own",
  path: "a test of the steps up to one step",
};

/**
 * Steps whose result stands in the run — what came before the failure. A retry carries exactly these
 * over without running them again (D152), which is why `runFacts` reads the same set.
 */
export const FINISHED_STEPS: ReadonlySet<StepStatus> = new Set(["succeeded", "reused", "pinned", "disabled"]);

/** The step a run stopped at: the last that failed, or one a sweeper closed mid-step. Null between steps. */
function stoppedStep<T extends Pick<StepRecord, "seq" | "status">>(ordered: readonly T[]): T | null {
  return ordered.findLast((step) => step.status === "failed" || step.status === "running") ?? null;
}

/** What the canvas needs to offer the right way to run again once a fix is accepted (D171). */
export interface RunFacts {
  id: string;
  /** The node the run stopped at — null when it stopped between steps. */
  failedNodeId: string | null;
  /** Every node with a step that finished before the failure: what a retry would reuse, not run. */
  ran: string[];
  /** A test of one step or of the way to it — retried by testing again, never from the failed step. */
  partialTest: boolean;
}

export function runFacts(options: {
  run: { id: string; test: RunTest | null };
  steps: readonly Pick<StepRecord, "seq" | "nodeId" | "status">[];
}): RunFacts {
  const ordered = [...options.steps].sort((a, b) => a.seq - b.seq);
  const stopped = stoppedStep(ordered);
  const limit = stopped?.seq ?? Number.POSITIVE_INFINITY;
  return {
    id: options.run.id,
    failedNodeId: stopped?.nodeId ?? null,
    ran: [...new Set(ordered.filter((step) => step.seq < limit && FINISHED_STEPS.has(step.status)).map((step) => step.nodeId))],
    partialTest: options.run.test !== null && options.run.test.scope !== "workflow",
  };
}

/**
 * The evidence for one failed run. `labels` names each node as the canvas does, so the diagnosis can
 * cite a step by what the person called it.
 */
export function runEvidence(options: {
  run: {
    status: string;
    trigger: string;
    error: string | null;
    workflowVersion: number | null;
    test: RunTest | null;
  };
  steps: readonly EvidenceStep[];
  labels: ReadonlyMap<string, string>;
}): RunEvidence {
  const { run, labels } = options;
  const ordered = [...options.steps].sort((a, b) => a.seq - b.seq);

  const named = (step: EvidenceStep): Named => {
    const label = labels.get(step.nodeId);
    return {
      step: step.nodeId,
      ...(label ? { label: scrubText(label) } : {}),
      type: step.nodeType,
      ...(step.iteration > 0 ? { pass: step.iteration + 1 } : {}),
    };
  };

  const failedStep = stoppedStep(ordered);
  const limit = failedStep?.seq ?? Number.POSITIVE_INFINITY;
  const earlier = ordered.filter((step) => step.seq < limit && FINISHED_STEPS.has(step.status));
  const shown = earlier.slice(-BEFORE_MAX);

  return {
    run: {
      status: run.status,
      trigger: run.trigger,
      error: run.error === null ? null : safeText(run.error, ERROR_MAX),
      version: run.workflowVersion,
      test: run.test === null ? null : TEST_WORDS[run.test.scope],
    },
    failed: failedStep && {
      ...named(failedStep),
      error: failedStep.error === null ? null : safeText(failedStep.error, ERROR_MAX),
      config: safe(failedStep.config),
      input: safe(failedStep.input),
      logs: (failedStep.logs ?? []).slice(-LOG_LINES).map((line) => safeText(`${line.level}: ${line.message}`, LOG_LINE_MAX)),
    },
    before: shown.map((step) => ({
      ...named(step),
      status: step.status,
      ...(step.status === "disabled" ? {} : { output: safe(step.output) }),
    })),
    omitted: earlier.length - shown.length,
  };
}
