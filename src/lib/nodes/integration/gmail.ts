import { z } from "zod";

import { sendMail } from "@/lib/integrations/gmail";
import { GMAIL_SEND_SCOPE } from "@/lib/integrations/google";
import { googleAccessToken, googleStatus } from "@/lib/integrations/store";

import { defineNode, NodeError } from "../types";
import { asNodeError } from "./shared";

/**
 * Send an email from the user's connected Gmail account.
 *
 * **Closed to the agent (`agentCallable: false`), deliberately.** This is D19 being
 * exercised the way D36 exercised it for `core.branch` and `core.assert`, and the
 * reasoning is about blast radius: every other integration here acts inside something
 * the user owns — their channel, their spreadsheet, an API they named. A sent email
 * leaves the account and reaches a third party, and it cannot be recalled. With
 * `agentCallable: true` the recipient *and* the body would be chosen by a model
 * reading text that arrived on an unauthenticated webhook endpoint, which is a
 * "send mail as this user to anyone" primitive obtained by writing it into a form.
 *
 * It remains a first-class node: an author places it, wires it, and its recipient is
 * in the graph where it can be read. `DEMO.md` needs nothing from the agent path —
 * Beat 8 is Discord and Sheets. Flipping this boolean is a one-line change if that
 * trade is ever re-made; the reasoning is here so it is re-made on purpose.
 */
export const gmailNode = defineNode({
  type: "integration.gmail",
  label: "Send email",
  description:
    "Sends an email from the user's connected Gmail account. Use it to deliver a result to a person by mail.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ sent: true, messageId, threadId, to, subject }.",
  agentCallable: false,
  configSchema: z.object({
    /**
     * One or more addresses, comma-separated.
     *
     * Not validated against an address grammar: this field routinely holds a `{{ }}`
     * reference, so the resolved value is what matters and Gmail is the authority on
     * whether it is deliverable. Allowed to be empty for the same reason as the Sheets
     * node's `spreadsheetId` — a generated workflow that invented a recipient would be
     * strictly worse than one that visibly has none yet.
     */
    to: z.string().trim().max(200).default(""),
    subject: z.string().max(500).default(""),
    body: z.string().max(50_000).default(""),
    cc: z.string().trim().max(200).optional(),
  }),
  async execute({ config, context }) {
    if (config.to.length === 0) {
      throw new NodeError("This node has no recipient yet. Open it and fill in an address.");
    }

    try {
      const accessToken = await googleAccessToken({
        ownerId: context.ownerId,
        requiredScopes: [GMAIL_SEND_SCOPE],
        capability: "send email on your behalf",
        signal: context.signal,
      });

      // The authenticated mailbox, so the message carries a From the recipient
      // recognises. Cosmetic only — Gmail sets it regardless of what is claimed.
      const { email } = await googleStatus(context.ownerId);

      const result = await sendMail({
        accessToken,
        message: {
          to: config.to,
          subject: config.subject,
          body: config.body,
          ...(config.cc ? { cc: config.cc } : {}),
          ...(email ? { from: email } : {}),
        },
        signal: context.signal,
      });

      context.log(`Sent to ${config.to}${result.messageId ? ` (${result.messageId})` : ""}.`);

      return {
        output: {
          sent: true,
          messageId: result.messageId,
          threadId: result.threadId,
          to: config.to,
          subject: config.subject,
        },
      };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
