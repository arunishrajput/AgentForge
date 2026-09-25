import type { StepLog } from "@/lib/nodes/types";

/**
 * The execution state machine — CONTRACT.md → "Execution state machine".
 *
 *   run:   queued → running → succeeded | failed | cancelled     (all three terminal)
 *   step:  running → succeeded | failed                          (both terminal)
 *          skipped is entered directly and is terminal
 *
 * A run interrupted mid-flight — the engine is in-process, so a Cloud Run redeploy
 * kills it — is left `running` with a stale `heartbeatAt`. `reapStaleRuns` moves it
 * to `failed`. Nothing may observe a run as permanently `running`
 * (ARCHITECTURE.md → "Execution engine design").
 */
export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ["running", "succeeded", "failed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const TRIGGER_KINDS = ["manual", "webhook", "schedule", "agent"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["succeeded", "failed", "cancelled"];

export interface StepRecord {
  /** Execution order within the run, 0-based. A looped node appears once per pass. */
  seq: number;
  nodeId: string;
  nodeType: string;
  /** Which pass of its node this is; 0 outside a loop body. */
  iteration: number;
  status: StepStatus;
  /** The config this step actually ran with, after template resolution. */
  config: unknown;
  input: unknown;
  output: unknown;
  /** The output handle the run left through, when the node branched. */
  branch: string | null;
  logs: StepLog[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunOutcome {
  status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">;
  error: string | null;
  output: unknown;
  steps: StepRecord[];
}

/**
 * How the engine persists. An interface rather than a direct import so the engine
 * stays testable without a database — the critical-path tests run against an
 * in-memory recorder, and `DbRecorder` is the only place `src/db` is touched.
 */
export interface RunRecorder {
  stepStarted: (step: StepRecord) => Promise<void> | void;
  stepFinished: (step: StepRecord) => Promise<void> | void;
  heartbeat: () => Promise<void> | void;
}

export const noopRecorder: RunRecorder = {
  stepStarted: () => {},
  stepFinished: () => {},
  heartbeat: () => {},
};
