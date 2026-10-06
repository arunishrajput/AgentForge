import { z } from "zod";

import { formatUtc } from "@/lib/triggers/cron";

import { defineNode, NodeError } from "../types";

/**
 * Waits, then passes its input through unchanged.
 *
 * Added in Phase 5 for two reasons beyond being a genuinely useful node — spacing
 * out calls to a rate-limited service is a real workflow need.
 *
 * First, every other core node finishes in about a millisecond, so a whole run
 * completes in ~100 ms and there is no honest way to verify that status and logs
 * arrive *incrementally* rather than all at once. Second, it logs before it waits
 * and again after, which is the only current exercise of mid-node log streaming —
 * the path every agent node will take from Phase 6 on.
 *
 * **Phase 26 made it wait for real.** Up to `MAX_DELAY_MS` it still sleeps in-process,
 * because ten seconds is not worth a queue round trip. Above that it does not sleep at
 * all: it returns a `wait` and the engine suspends the run as `waiting` — cursor written,
 * lease released, a Cloud Tasks delivery scheduled for the wake time — so "wait two days,
 * then send the reminder" costs a row and a task rather than a container held for two
 * days (`BUILD_PLAN.md` Phase 26). No new node: this one was extended, per D112.
 */

/**
 * The longest wait spent asleep inside a request. Above it, the run is suspended instead.
 * Unchanged from Phase 5 — what changed is that it stopped being the longest wait there is.
 */
export const MAX_DELAY_MS = 10_000;

/**
 * **The longest wait a run may ask for — a safety property, in D16's family.** Cloud
 * Tasks cannot schedule a delivery more than 30 days ahead, and a run parked for longer
 * than a month is more likely forgotten than intended. The engine enforces it again on
 * the `wait` it is handed, so this is the bound and not merely this node's preference.
 */
export const MAX_WAIT_MS = 30 * 24 * 60 * 60 * 1000;

export const DELAY_UNITS = ["milliseconds", "seconds", "minutes", "hours", "days"] as const;
export type DelayUnit = (typeof DELAY_UNITS)[number];

const UNIT_MS: Record<DelayUnit, number> = {
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * How long a config asks to wait, in milliseconds.
 *
 * **`ms` is the Phase 5 shape and is still honoured**, without appearing in the form or
 * the generator's catalogue. Stored workflows and their version snapshots carry it, and
 * rewriting version history to migrate it would break D85's append-only rule. The rule
 * that keeps it unambiguous: `amount` wins whenever it is present, and `ms` is read only
 * when it is not. That is also why `amount` and `unit` carry their defaults as *form*
 * metadata rather than as parse defaults — a parse default would fill `amount` in on a
 * legacy config and silently override its `ms`.
 */
export function delayMs(config: { amount?: number; unit?: DelayUnit; ms?: unknown }): number {
  if (config.amount !== undefined) return config.amount * UNIT_MS[config.unit ?? "seconds"];
  if (typeof config.ms === "number" && Number.isFinite(config.ms) && config.ms >= 0) {
    // The Phase 5 schema capped `ms` at the in-process limit, so a legacy config never
    // meant more than this and is never turned into a suspension by being read again.
    return Math.min(config.ms, MAX_DELAY_MS);
  }
  return 1_000;
}

/** "2 hours", "90 seconds", "1.5 days" — for the log line a person reads. */
export function describeDuration(ms: number): string {
  for (const unit of ["days", "hours", "minutes", "seconds"] as const) {
    const amount = ms / UNIT_MS[unit];
    if (amount >= 1) {
      const rounded = Math.round(amount * 10) / 10;
      return `${rounded} ${rounded === 1 ? unit.slice(0, -1) : unit}`;
    }
  }
  return `${ms} ms`;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () =>
      reject(new NodeError("The run stopped before this delay finished."));

    if (signal.aborted) {
      stop();
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      stop();
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const delayNode = defineNode({
  type: "core.delay",
  label: "Delay",
  description:
    "Waits, then passes its input through unchanged. Waits over 10 seconds pause the run and resume it later, up to 30 days. Use it to space out calls to a rate-limited service, or to wait before a follow-up.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "its input, unchanged.",
  /**
   * `looseObject` so a stored Phase 5 `ms` survives parsing and reaches `delayMs` above.
   * The JSON Schema lists only `amount` and `unit`, so the form and the generator never
   * offer `ms` — it is read, not written.
   */
  configSchema: z
    .looseObject({
      amount: z.number().min(0).optional().meta({ default: 1 }),
      unit: z.enum(DELAY_UNITS).optional().meta({ default: "seconds" }),
    })
    .superRefine((config, ctx) => {
      // A legacy `ms` is still *validated* when present, exactly as the Phase 5 schema
      // did — a stored `{ "ms": "{{input.wait}}" }` that resolves to a string must fail its
      // step, not quietly fall back to a one-second default. Only its visibility changed.
      const ms = config.ms;
      if (ms !== undefined && (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["ms"],
          message: "must be a number of milliseconds, 0 or more.",
        });
        return;
      }
      if (delayMs(config) > MAX_WAIT_MS) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: "A delay can be at most 30 days.",
        });
      }
    }),
  docs: {
    summary:
      "Pauses the run for a while, then carries on with exactly what it was given. A short delay — ten seconds or less — waits in place; a longer one puts the run to sleep as Waiting and wakes it at the right time, so a run can wait minutes, hours or up to 30 days without holding anything open.",
    accepts: "anything — it is passed through untouched.",
    examples: [
      { title: "Space out calls to a rate-limited API", body: '{ "amount": 2, "unit": "seconds" }' },
      { title: "Send a follow-up a day later", body: '{ "amount": 1, "unit": "days" }' },
    ],
  },
  async execute({ config, input, context }) {
    const ms = delayMs(config);

    if (ms <= MAX_DELAY_MS) {
      context.log(`Waiting ${ms} ms.`);
      await wait(ms, context.signal);
      context.log("Done waiting.");
      return { output: input ?? null };
    }

    const until = new Date(Date.now() + ms).toISOString();
    context.log(
      `Waiting ${describeDuration(ms)}, until ${formatUtc(until)}. The run pauses here and resumes then.`,
    );
    return { output: input ?? null, wait: { until } };
  },
});
