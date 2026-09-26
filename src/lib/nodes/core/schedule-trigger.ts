import { z } from "zod";

import { cronError, formatUtc, nextTimeFor } from "@/lib/triggers/cron";

import { defineNode } from "../types";

/**
 * Starts a run on a cron schedule — CONTRACT.md → "Trigger shapes".
 *
 * Cloud Run scales to zero and has no timers, so nothing here waits: the workflow
 * row carries `scheduleNextAt`, derived from this config whenever the workflow is
 * saved, and Cloud Scheduler POSTs `/api/cron/tick` to fire whatever is due
 * (ARCHITECTURE.md → "Queue — deliberately none").
 *
 * The cron expression is validated **here**, in the config schema, so an unsupported
 * one is an `invalid_config` problem on the canvas and a rejected generation. The
 * alternative is the worst failure this node has: an expression that saves cleanly,
 * shows a schedule in the UI, and never fires.
 *
 * `reachable` catches the second half of that: `0 0 30 2 *` parses perfectly and
 * matches no date that will ever exist.
 */
const cronField = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .superRefine((expression, ctx) => {
    const problem = cronError(expression);
    if (problem) {
      ctx.addIssue({ code: "custom", message: problem });
      return;
    }
    if (nextTimeFor(expression, new Date()) === null) {
      ctx.addIssue({
        code: "custom",
        message: `"${expression}" is a valid expression but matches no real date, so it would never fire.`,
      });
    }
  });

export const scheduleTrigger = defineNode({
  type: "core.schedule_trigger",
  label: "Schedule trigger",
  description:
    "Starts the workflow on a repeating schedule, given as a 5-field cron expression in UTC " +
    "(minute hour day-of-month month day-of-week). Examples: \"0 9 * * 1-5\" is 09:00 UTC on weekdays, " +
    '"*/30 * * * *" is every 30 minutes, "@daily" is midnight UTC. Use it when the request says the ' +
    "workflow runs every day, every hour, on a timetable, or at a particular time.",
  kind: "trigger",
  category: "trigger",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ firedAt: ISO-8601 UTC timestamp, cron: the expression, scheduledFor: the slot it fired for }.",
  configSchema: z.object({
    cron: cronField.default("0 9 * * *"),
  }),
  async execute({ config, input, context }) {
    const firedAt = new Date();
    // The slot this run is *for* comes from the tick, which knows which due time it
    // claimed. Absent that (a manual run of a scheduled workflow), the trigger says
    // so rather than inventing a slot.
    const scheduledFor =
      input && typeof input === "object" && !Array.isArray(input)
        ? ((input as Record<string, unknown>).scheduledFor ?? null)
        : null;

    context.log(
      `Schedule "${config.cron}" fired at ${formatUtc(firedAt)}` +
        (typeof scheduledFor === "string" ? ` for the ${formatUtc(scheduledFor)} slot.` : "."),
    );

    return {
      output: {
        firedAt: firedAt.toISOString(),
        cron: config.cron,
        scheduledFor: typeof scheduledFor === "string" ? scheduledFor : null,
      },
    };
  },
});
