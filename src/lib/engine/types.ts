import type { ApprovalRequest } from "@/lib/approvals/rules";
import type { StepLog } from "@/lib/nodes/types";

import type { RunCursor } from "./cursor";

/**
 * The execution state machine — CONTRACT.md → "Execution state machine".
 *
 *   run:   queued → running → succeeded | failed | cancelled     (all three terminal)
 *                      ↕
 *                   waiting                                      (Phase 26, not terminal)
 *   step:  running → succeeded | failed | handled                (all three terminal)
 *          skipped, disabled, pinned and reused are entered directly and are terminal
 *
 * **`waiting` is Phase 26's, and it sits outside the lease family entirely.** A run that
 * reaches a long `core.delay` is put down: its cursor is written, its lease is released,
 * and a Cloud Tasks task is scheduled for `wakeAt`. Nothing executes it and no container
 * holds it until that task is delivered, when it is claimed back to `running` like any
 * other delivery. So a waiting run is not "running slowly" — it is not running at all, and
 * the 120 s / 150 s / 180 s ordering (D78) says nothing about it.
 *
 * `queued` was reserved for a future queue in Chapter 1 and never written. **Phase 17
 * writes it**: a durable run is created `queued`, a Cloud Tasks delivery claims it and
 * moves it to `running`.
 *
 * A run interrupted mid-flight is left `running` with a lapsed lease. What happens next
 * depends on its `mode`, and this is the whole of Phase 17 in three lines:
 *
 *   sync     nothing will come back for it. The sweeper fails it.
 *   durable  Cloud Tasks saw the delivery fail and redelivers. The next worker claims
 *            the lapsed lease and resumes from the cursor. Only when the queue gives
 *            up does the sweeper fail it.
 *
 * Nothing may observe a run as permanently `running` (ARCHITECTURE.md → "Execution
 * engine design"). That property is unchanged; what changed is that satisfying it is
 * no longer the same as losing the run.
 */
export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * How a run is executed, and therefore what happens when it is interrupted.
 *
 * `sync` is Chapter 1's path, kept deliberately: the request holds open until the run
 * finishes and returns its final state, which is what makes `POST /runs` answer with a
 * completed run and what every script and the canvas's Run button rely on. It is the
 * right shape for a run somebody is watching, and it cannot survive a redeploy.
 *
 * `durable` costs a queue round trip and survives one.
 */
export const RUN_MODES = ["sync", "durable"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/**
 * `skipped` is *the run never got here*; `disabled` — Phase 30 — is *the run got here and the
 * node was switched off*. Neither ran, so both have no timestamps, and they stay two statuses
 * because a run history that said "Skipped" for a node the run passed straight through would
 * be telling its reader the wrong story (`CONTRACT.md` → *Disabled nodes*).
 *
 * `pinned` — Phase 31 — is *the run got here and used the node's pinned output instead of
 * running it*. Only a test run does that (`CONTRACT.md` → *Pinned output*). It did not run
 * either, and "Succeeded" would claim a request was sent that never was.
 *
 * `reused` — Phase 33 — is *a retry carried this step over from the run it retries*. It ran
 * there, not here (`CONTRACT.md` → *Re-runs and retries*), for the same reason again.
 *
 * `handled` — Phase 37 — is *the node failed, and its on-error policy carried the run on*: with
 * the error as its output, out of its default output (`continue`) or its Error output (`route`).
 * It ran and it failed, so it has timestamps and an `error`; it is not `failed`, because every
 * reader of a `failed` step — a retry's replay, a diagnosis, the toast — takes it as *where the
 * run stopped*, and this one is where it did not (D175).
 */
export const STEP_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "skipped",
  "disabled",
  "pinned",
  "reused",
  "handled",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * What started a run. **`error` is Phase 37's**: a run of a workflow whose trigger is
 * `core.error_trigger`, started because another workflow's run failed with nobody watching. A
 * run started that way never starts another — that is the bound that keeps an error workflow
 * that fails from alerting about itself (D176).
 */
export const TRIGGER_KINDS = ["manual", "webhook", "schedule", "agent", "error"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["succeeded", "failed", "cancelled"];

/**
 * A run nothing is executing and nothing will resume early: finished, or `waiting` for its
 * timer. A stream stops watching a run that reaches one of these (D31), because there is
 * nothing to report until a delivery claims it again.
 */
export const RESTING_RUN_STATUSES: readonly RunStatus[] = [...TERMINAL_RUN_STATUSES, "waiting"];

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

/**
 * Why the engine stopped.
 *
 * `waiting` is Phase 26's: a node asked the run to pause until a time (a long
 * `core.delay`), and the caller must suspend it — write the cursor, release the lease,
 * schedule the wake — rather than finish it.
 *
 * `interrupted` is Phase 17's addition and the other one that is not terminal: the
 * engine put the work down without finishing it, because the run was cancelled from
 * elsewhere or because it no longer holds the lease. The caller must **not** write a
 * terminal status on an `interrupted` outcome — for `preempted` another worker owns
 * the run and is mid-flight, and stamping `failed` over it would report a lie about a
 * run that is still going.
 */
export type RunStop = "finished" | "interrupted" | "waiting";

export interface RunOutcome {
  /** `null` when `stop` is `interrupted`: the run's status is not this engine's to say. */
  status: Extract<RunStatus, "succeeded" | "failed" | "cancelled"> | null;
  stop: RunStop;
  /** Set on an interruption: `cancelled` if a cancel was seen, `preempted` if the lease lapsed. */
  reason: "cancelled" | "preempted" | null;
  error: string | null;
  output: unknown;
  steps: StepRecord[];
  /** Where to carry on from. Written by the caller so a redelivery resumes here. */
  cursor: RunCursor | null;
  /**
   * Set when `stop` is `waiting` — Phase 26: when the run asked to be resumed. The caller
   * suspends the run until then rather than writing a status of its own.
   */
  wakeAt?: string;
  /**
   * **Phase 38.** The approval this run was still waiting on when it finished — failed or cancelled
   * before anybody decided. The caller closes it (`void`), so its link and its inbox entry go with
   * the run. Absent in every other case.
   */
  unsettledApproval?: string;
}

/**
 * What a checkpoint learned about the run row it just wrote to.
 *
 * Both fields are read back from the *same* statement that writes the progress, so
 * checking for a cancellation and holding the lease cost no extra query on a metered
 * database. That is the reason this returns a value at all.
 */
export interface Checkpoint {
  /** Someone asked for this run to stop. The engine finishes it as `cancelled`. */
  cancelRequested: boolean;
  /**
   * This engine still owns the run. False means a redelivery claimed the lapsed
   * lease and is executing it now — so this engine must stop touching it, silently.
   */
  leaseHeld: boolean;
}

export const CHECKPOINT_OK: Checkpoint = { cancelRequested: false, leaseHeld: true };

/**
 * How the engine persists. An interface rather than a direct import so the engine
 * stays testable without a database — the critical-path tests run against an
 * in-memory recorder, and `DbRecorder` is the only place `src/db` is touched.
 */
export interface RunRecorder {
  stepStarted: (step: StepRecord) => Promise<void> | void;
  stepFinished: (step: StepRecord) => Promise<void> | void;
  /**
   * A log line was written while the step was still running. Optional, and
   * deliberately not awaited by the engine: `context.log` is synchronous, because
   * a node author writing a log line should not have to think about a database.
   *
   * Without this a log only becomes visible when its node finishes, which for a
   * node that takes seconds — every agent node from Phase 6 on — is precisely when
   * it has stopped being interesting.
   */
  stepLogged?: (step: StepRecord, log: StepLog) => void;
  /**
   * End of a step: persist the frontier, extend the lease, and report what the run
   * row says. This was `heartbeat()` in Chapter 1 and did one of those three things.
   *
   * All three in one statement is the point. A run on the free Neon tier cannot
   * afford a poll for cancellation, a separate lease write and a heartbeat per step,
   * so the checkpoint is a single `UPDATE ... RETURNING` whose returned row answers
   * both questions above.
   */
  checkpoint: (cursor: RunCursor) => Promise<Checkpoint> | Checkpoint;
  /**
   * **Record an approval request and mint its link — Phase 38.** Keyed by (node, pass), so an attempt
   * that re-executes the same approval after a crash replaces the request's token rather than making
   * a second request. Answers the request's id, and the token and link **in plaintext, once** — the
   * engine keeps them in memory and removes them from everything it records (`redact.ts`).
   *
   * Optional, so a recorder that cannot keep one — every in-memory recorder that does not care —
   * leaves it out, and an approval there fails its step saying why.
   */
  requestApproval?: (request: ApprovalRequest & { nodeId: string; iteration: number; seq: number }) => Promise<IssuedApproval>;
  /**
   * **Mint a still-pending request a new link — Phase 38.** For a resumed attempt whose Ask path has
   * not sent the link yet: the plaintext died with the attempt that minted it, and a hash cannot be
   * read back, so the request gets a new token and the old one stops working. Null when the request
   * is no longer pending.
   */
  reissueApproval?: (approvalId: string) => Promise<IssuedApproval | null>;
}

/** An approval request as the recorder answers it: its id, and its link's token and URL in plaintext. */
export interface IssuedApproval {
  id: string;
  token: string;
  url: string;
}

export const noopRecorder: RunRecorder = {
  stepStarted: () => {},
  stepFinished: () => {},
  checkpoint: () => CHECKPOINT_OK,
};
