import { z } from "zod";

import {
  APPROVAL_TYPE,
  APPROVED_HANDLE,
  approversWords,
  ASK_HANDLE,
  MAX_TIMEOUT_MS,
  MESSAGE_MAX,
  MIN_TIMEOUT_MS,
  parseApprovers,
  REJECTED_HANDLE,
  TIMEOUT_OUTCOMES,
  TIMEOUT_UNITS,
  timeoutMs,
} from "@/lib/approvals/rules";
import { formatUtc } from "@/lib/triggers/cron";

import { defineNode, NodeError } from "../types";
import { describeDuration } from "./delay";

/**
 * **Asks a person, and waits for the answer — Phase 38** (`CONTRACT.md` → *Approvals*, D178–D182).
 *
 * The node itself only works out what to ask: the message (built with `{{ }}` lookup, D17), who may
 * decide, and when the timeout decides instead. It returns that as `approval`, and **the engine does
 * the rest** — records the request and mints its link through the recorder, hands the link on out of
 * **Ask** at once, runs whatever else it can, and puts the run down as `waiting` until somebody
 * decides. Then it carries on out of **Approved** or **Rejected**. The node never touches the
 * database, exactly as `core.delay` never schedules its own wake.
 *
 * **Ask is how the link reaches a person**: connected to a Discord, Slack or Gmail step, the step
 * sends `{{input.url}}` through a channel the workspace already has — the zero-cost answer to a mail
 * provider (`BUILD_PLAN.md` → *The zero-cost problem*). Left unconnected, the request is decided in
 * the inbox or on the canvas.
 *
 * **Not agent-callable**: an approval is a guard an author places, D36's reasoning for `core.assert`
 * — and a node whose purpose is the output it leaves through cannot be a tool (D19).
 */
export const approvalNode = defineNode({
  type: APPROVAL_TYPE,
  label: "Approval",
  description:
    "Pauses the run until a person approves or rejects, for up to 30 days. Ask fires at once with {{input.url}}, the decision link: " +
    "connect it to the Discord, Slack or Gmail step that sends it. Approved and Rejected continue after the decision.",
  kind: "branch",
  category: "logic",
  outputs: [
    { key: ASK_HANDLE, label: "Ask" },
    { key: APPROVED_HANDLE, label: "Approved" },
    { key: REJECTED_HANDLE, label: "Rejected" },
  ],
  outputShape:
    "Ask: { url, message, expiresAt, approvalId }. Approved and Rejected: { decision, via, decidedBy: { name, email } or null, comment, decidedAt, message }.",
  agentCallable: false,
  configSchema: z
    .object({
      message: z.string().trim().min(1).max(MESSAGE_MAX),
      // Empty for any editor and above. A list is checked here when it is literal; one that holds a
      // `{{ }}` reference is checked once it has resolved, at run time, by the same function.
      approvers: z
        .string()
        .max(1_000)
        .optional()
        .superRefine((text, ctx) => {
          if (text === undefined || text.includes("{{")) return;
          const parsed = parseApprovers(text);
          if ("error" in parsed) ctx.addIssue({ code: "custom", message: parsed.error });
        }),
      timeout: z.number().positive().default(1),
      timeoutUnit: z.enum(TIMEOUT_UNITS).default("days"),
      onTimeout: z.enum(TIMEOUT_OUTCOMES).default("reject"),
    })
    .superRefine((config, ctx) => {
      const ms = timeoutMs(config);
      if (ms < MIN_TIMEOUT_MS) ctx.addIssue({ code: "custom", path: ["timeout"], message: "The timeout must be at least a minute." });
      if (ms > MAX_TIMEOUT_MS) ctx.addIssue({ code: "custom", path: ["timeout"], message: "The timeout can be at most 30 days." });
    }),
  docs: {
    summary:
      "Stops the run and asks a person to approve or reject, then carries on down Approved or Rejected — hours or days later. " +
      "Connect Ask to a Discord, Slack or Gmail step to send the decision link ({{input.url}}); whoever opens it can decide without signing in, once. " +
      "It is also waiting in the inbox and on the canvas for the people allowed to decide. If nobody does before the timeout, On timeout decides.",
    accepts: "anything — what it was given is what the message's {{input.…}} references read",
    examples: [
      { title: "The message", body: '"Refund {{input.amount}} to {{input.customer}}?"' },
      { title: "Send the link to Discord, from Ask", body: '"Approval needed: {{input.message}} — {{input.url}}"' },
      { title: "Only named people decide", body: '{ "approvers": "ada@example.com, grace@example.com" }' },
      { title: "On Approved, use the comment", body: '"Approved by {{input.decidedBy.name}}: {{input.comment}}"' },
    ],
  },
  async execute({ config, context }) {
    const who = parseApprovers(config.approvers);
    if ("error" in who) throw new NodeError(who.error);

    const ms = timeoutMs(config);
    const expiresAt = new Date(Date.now() + ms).toISOString();
    const otherwise =
      config.onTimeout === "fail" ? "fails the run" : config.onTimeout === "approve" ? "approves" : "rejects";
    context.log(
      `Asking ${approversWords(who.approvers)} to decide within ${describeDuration(ms)}, by ${formatUtc(expiresAt)}. ` +
        `If nobody does, it ${otherwise}.`,
    );

    // The engine replaces the output with what Ask hands on — the request's id, its message and
    // the link it mints — so there is nothing to put here.
    return {
      output: null,
      approval: { message: config.message, approvers: who.approvers, expiresAt, onTimeout: config.onTimeout },
    };
  },
});
