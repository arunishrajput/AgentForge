import { z } from "zod";

/**
 * Per-node retry and timeout — `PRD.md` C4, carried from Chapter 1's S6 and never
 * built until now.
 *
 * **Why this lives on the graph node and not in each node's `configSchema`.** Retry
 * and timeout are properties of *running* a node, not of what the node does. Putting
 * them in config would mean adding two fields to fifteen schemas, teaching the
 * generator about them fifteen times, and giving the agent two more parameters it
 * could get wrong on every tool call. As a sibling of `config` they are declared
 * once, the engine applies them uniformly, and a node author never thinks about
 * them.
 *
 * **Every bound is a safety property, not a preference.** A generated graph is
 * written by a model, and `PROGRESS.md` records what models do with numeric bounds:
 * `maxIterations: 1` on an agent was schema-valid, graph-valid and fatal. So the
 * ceilings here are chosen so that the *worst* legal policy is still survivable
 * inside the engine's 120 s deadline, and the schema — not a comment — enforces it.
 */

/** A node may not be retried more than this many times, however the graph asks. */
export const MAX_RETRIES = 3;
/** Longest a single attempt may be given. Under the engine's deadline by design. */
export const MAX_TIMEOUT_MS = 60_000;
/** Shortest timeout worth expressing; below this every real node fails. */
export const MIN_TIMEOUT_MS = 1_000;
/** Longest pause between attempts. */
export const MAX_BACKOFF_MS = 10_000;

/**
 * **What a run does when this node fails — Phase 37, `CONTRACT.md` → *On-error policy*.**
 * Applied after the node's retries are spent, never instead of them.
 *
 *   stop      today's behaviour, and what absent means: the step fails, and so does the run
 *   continue  the step is recorded `handled`, and the run goes on out of the default output
 *             with the error as the node's output (D173)
 *   route     the step is recorded `handled`, and the run leaves by the node's **Error**
 *             output — drawn on the card only while this is the policy (`outputsOf`, D174).
 *             With nothing connected to Error, the failure fails the run: it had nowhere to go
 */
export const ON_ERROR = ["stop", "continue", "route"] as const;
export type OnError = (typeof ON_ERROR)[number];

/**
 * **The Error output's key — reserved.** No registry node may declare an output with this key
 * (`registry.test.ts`), because the engine adds it to a node's own outputs when its policy
 * routes, and a node that already had one would have two exits with one name.
 */
export const ERROR_HANDLE = "error";

/** The output a routing policy adds, drawn after the node's own. */
export const ERROR_OUTPUT = { key: ERROR_HANDLE, label: "Error" } as const;

export const nodePolicySchema = z.object({
  /** Extra attempts after the first. 0 means "run once", which is the default. */
  retries: z.number().int().min(0).max(MAX_RETRIES).default(0),
  /** Pause before the first retry; doubles per attempt, capped at `MAX_BACKOFF_MS`. */
  backoffMs: z.number().int().min(0).max(MAX_BACKOFF_MS).default(500),
  /**
   * Per-attempt wall clock. Absent means "no limit of its own" — the node is still
   * bounded by the run's deadline, which every node's `context.signal` already
   * carries.
   */
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
  /**
   * Phase 37. **Absent is `stop`**, and stays absent — no schema default — so every graph saved
   * before this phase reads exactly as it was stored and shows no unsaved change.
   */
  onError: z.enum(ON_ERROR).optional(),
});

export type NodePolicy = z.infer<typeof nodePolicySchema>;

export const DEFAULT_POLICY: NodePolicy = { retries: 0, backoffMs: 500 };

/**
 * What a node does on a failure its retries did not cure. **A trigger always stops** — a run
 * starts there, so there is nothing before it to have handled anything, and the inspector does
 * not offer the choice on one — whatever its stored policy says.
 */
export function onErrorOf(policy: NodePolicy, kind: string | undefined): OnError {
  if (kind === "trigger") return "stop";
  return policy.onError ?? "stop";
}

/**
 * **A node's outputs as they are on this canvas — its registry entry's, plus Error while its
 * policy routes** (D174). The one answer to "which handles does this node have": the card draws
 * them, validation checks an edge's `sourceHandle` against them, and the engine and a retry's
 * replay follow them. Handles still come from the registry (D21, D23); the policy only adds the
 * one key the registry reserves.
 */
export function outputsOf<Output extends { key: string | null; label: string }>(
  definition: { kind: string; outputs: readonly Output[] },
  policy: unknown,
): readonly (Output | typeof ERROR_OUTPUT)[] {
  return onErrorOf(readPolicy(policy), definition.kind) === "route"
    ? [...definition.outputs, ERROR_OUTPUT]
    : definition.outputs;
}

/** The error a handled step hands on as its output — what `{{steps.x.output.error}}` reads. */
export interface HandledError {
  error: string;
  nodeId: string;
}

export function handledOutput(message: string, nodeId: string): HandledError {
  return { error: message, nodeId };
}

/**
 * Read a policy off a graph node. An unreadable or absent policy is the default —
 * run once, no timeout of its own — because a node that cannot be read as
 * "retry twice" must never accidentally read as "retry for ever".
 */
export function readPolicy(value: unknown): NodePolicy {
  if (value === undefined || value === null) return DEFAULT_POLICY;
  const parsed = nodePolicySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_POLICY;
}

/**
 * How long to wait before attempt `n` (1-based: the pause *before* the first retry
 * is `attemptDelayMs(policy, 1)`). Exponential, capped, and never negative.
 */
export function attemptDelayMs(policy: NodePolicy, retry: number): number {
  if (retry < 1 || policy.backoffMs <= 0) return 0;
  return Math.min(policy.backoffMs * 2 ** (retry - 1), MAX_BACKOFF_MS);
}

/**
 * Whether a failure is worth another attempt.
 *
 * **A config failure never is.** `Invalid config:` comes from the node's own
 * `configSchema` rejecting the resolved config, which is a property of the graph and
 * not of the world — retrying it burns the run's deadline three times to reach the
 * same answer. Everything else is retryable, deliberately: a `NodeError` from an
 * integration is usually a 5xx or a timeout, and the engine cannot reliably tell a
 * transient remote failure from a permanent one without a taxonomy every node author
 * would have to maintain. Retrying a genuinely permanent failure costs the backoff;
 * failing to retry a transient one costs the run.
 *
 * The `AbortError` case is the important exclusion: the run's own deadline or a
 * cancellation aborted the attempt, and another attempt cannot succeed.
 */
export function retryable(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return false;
    if (error.message.startsWith("Invalid config:")) return false;
  }
  return true;
}

/** How a step's attempts went, for the log line the engine writes. */
export function describeAttempts(attempts: number): string {
  return attempts === 1 ? "first attempt" : `attempt ${attempts}`;
}
