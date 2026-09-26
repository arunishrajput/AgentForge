import { z } from "zod";

import { DISCORD_CONTENT_LIMIT, postMessage } from "@/lib/integrations/discord";
import { readDiscordWebhook } from "@/lib/integrations/store";

import { defineNode } from "../types";
import { asNodeError } from "./shared";

/**
 * Post a message to Discord.
 *
 * **Agent-callable, and the reason is structural.** The destination is not in the
 * config — it is the webhook URL the *user* stored encrypted in Settings. So a model
 * calling this tool chooses the words and can never choose where they go, which is
 * the line that makes this a safe capability to widen (D19) where a Gmail send is
 * not: there, the recipient would be the model's to pick.
 *
 * `DEMO.md` Beat 4 opens this node and edits its message template, so `content` is
 * deliberately the first and simplest field.
 */
export const discordNode = defineNode({
  type: "integration.discord",
  label: "Post to Discord",
  description:
    "Posts a message to the Discord channel the user has connected in Settings. Use it to notify people about something the workflow found. The channel is fixed by the stored credential; only the message text is chosen here.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ posted: true, messageId: the id Discord created, channelId, content: the message that was sent }.",
  agentCallable: true,
  configSchema: z.object({
    content: z.string().trim().min(1).max(DISCORD_CONTENT_LIMIT),
    /** Discord shows this as the author. Optional; the webhook's own name is used. */
    username: z.string().trim().max(80).optional(),
  }),
  async execute({ config, context }) {
    try {
      const webhookUrl = await readDiscordWebhook(context.ownerId);
      const result = await postMessage(
        webhookUrl,
        { content: config.content, ...(config.username ? { username: config.username } : {}) },
        context.signal,
      );

      context.log(
        `Posted to Discord${result.messageId ? ` (message ${result.messageId})` : ""}.`,
      );

      return {
        output: {
          posted: true,
          messageId: result.messageId,
          channelId: result.channelId,
          content: config.content,
        },
      };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
