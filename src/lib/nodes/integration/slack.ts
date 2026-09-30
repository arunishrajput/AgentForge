import { z } from "zod";

import { postMessage, SLACK_TEXT_LIMIT } from "@/lib/integrations/slack";
import { readTokenSecret } from "@/lib/integrations/store";
import { tokenIntegrationBySlug } from "@/lib/integrations/tokens";

import { defineNode } from "../types";
import { asNodeError } from "./shared";

const slack = tokenIntegrationBySlug("slack")!;

/**
 * Post a message to Slack.
 *
 * **Agent-callable, and the case here is stronger than Discord's.** The destination is not in
 * the config — it is the incoming webhook the *user* stored encrypted in Settings — and Slack
 * refuses to let a caller override the channel, the username or the icon at all. So a model
 * calling this tool chooses the words and cannot choose where they go or who they appear to
 * come from, which is more than D19 needs.
 *
 * There is no `username` field for exactly that reason. The Discord node has one; Slack
 * documents that sending it does nothing, and a config field that is silently ignored is worse
 * than no field at all.
 */
export const slackNode = defineNode({
  type: "integration.slack",
  label: "Post to Slack",
  description:
    "Posts a message to the Slack channel the user has connected in Settings. Use it to tell people about something the workflow found or did. The channel is fixed by the stored webhook; only the message text is chosen here.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ posted: true, text: the message that was sent }. Slack answers an incoming webhook with no message id, so there is nothing else to report.",
  agentCallable: true,
  docs: {
    summary:
      "Sends one message to a single Slack channel — the one you chose when you created the incoming webhook in Settings → Integrations. It is the quickest way to make a workflow tell a human something, and it is the node to reach for when a run should end in somebody being told.",
    accepts:
      "Nothing in particular. It ignores its input and sends the text you write, so put `{{ }}` references in the message to pull values out of earlier steps.",
    examples: [
      {
        title: "Report what an earlier step found",
        body: "text: \"{{steps.summarise.output.text}}\"",
      },
      {
        title: "Announce a webhook that arrived",
        body: "text: \"New signup: {{trigger.email}} on the {{trigger.plan}} plan\"",
      },
    ],
  },
  configSchema: z.object({
    text: z.string().trim().min(1).max(SLACK_TEXT_LIMIT),
  }),
  async execute({ config, context }) {
    try {
      const webhookUrl = await readTokenSecret(context.scope, slack, {
        runId: context.runId,
        nodeId: context.nodeId,
        nodeType: context.nodeType,
        purpose: "post-message",
      });

      await postMessage(webhookUrl, config.text, context.signal);

      context.log(`Posted ${config.text.length} character(s) to Slack.`);

      return { output: { posted: true, text: config.text } };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
