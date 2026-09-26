import { apiErrorMessage, IntegrationError, readBody, request } from "./net";

/**
 * Discord, through an incoming webhook URL.
 *
 * **The URL is the credential.** It carries its own bearer token in the path, so
 * anyone holding it can post to the channel — which is why it is stored encrypted
 * under `integration.discord` and never appears in a workflow graph. This is D41's
 * rule arriving a second time: a secret does not live where a model writes, and the
 * graph is exactly where the generator writes.
 *
 * The consequence for the node is the useful part: the *destination* is fixed by a
 * credential the user configured, so an agent calling this tool chooses the message
 * and never where it goes.
 */

export const DISCORD_CREDENTIAL_KIND = "integration.discord";

/** Discord's own limit on `content`. Rejected client-side so the API never 400s. */
export const DISCORD_CONTENT_LIMIT = 2000;

const WEBHOOK_PATTERN =
  /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/;

export interface DiscordWebhookInfo {
  webhookName: string | null;
  channelId: string | null;
  guildId: string | null;
}

/**
 * Shape-checks the URL before anything is stored or sent.
 *
 * Not decoration: a user pasting a channel URL, a message link or an invite instead
 * of a webhook URL is the likeliest mistake here, and each of those would be stored
 * happily and then fail at runtime inside a run. The trailing slash and query are
 * dropped rather than rejected, because Discord's own copy button has been known to
 * include them.
 */
export function normaliseWebhookUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new IntegrationError("That is not a valid URL.");
  }

  const cleaned = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  if (!WEBHOOK_PATTERN.test(cleaned)) {
    throw new IntegrationError(
      "That is not a Discord webhook URL. In Discord: Channel settings → Integrations → Webhooks → Copy Webhook URL. It looks like https://discord.com/api/webhooks/<id>/<token>.",
    );
  }
  return cleaned;
}

/**
 * Proves the webhook before it is stored, and returns what it is attached to.
 *
 * The same rule Phase 6 arrived at for a provider key (`CONTRACT.md` → credential
 * storage): a credential is proved with a real call, never accepted on shape alone.
 * A revoked or deleted webhook is a perfectly well-formed URL, and storing one means
 * the failure surfaces mid-run instead of in the form. The channel name it returns
 * also lets the settings page show *which* channel is wired up without the user
 * having to trust that the URL they pasted was the one they meant.
 */
export async function verifyWebhook(
  url: string,
  signal?: AbortSignal,
): Promise<DiscordWebhookInfo> {
  // A GET that creates nothing, made while the user waits on the settings form — so
  // it is safe to repeat, transport failure included.
  const response = await request(url, {
    timeoutMs: 10_000,
    signal,
    retry: { attempts: 2, onTransportError: true },
  });
  const body = await readBody(response);

  if (!response.ok) {
    throw new IntegrationError(
      `Discord rejected this webhook: ${apiErrorMessage(body, `HTTP ${response.status}`)}`,
      response.status,
    );
  }

  const json = (body.json ?? {}) as Record<string, unknown>;
  return {
    webhookName: typeof json.name === "string" ? json.name : null,
    channelId: typeof json.channel_id === "string" ? json.channel_id : null,
    guildId: typeof json.guild_id === "string" ? json.guild_id : null,
  };
}

export interface DiscordPost {
  content: string;
  username?: string;
}

export interface DiscordPostResult {
  messageId: string | null;
  channelId: string | null;
  status: number;
}

/**
 * Posts a message. `?wait=true` is deliberate: without it Discord answers 204 with
 * no body, and the node would have nothing to put in its output but "probably". With
 * it the response carries the created message, so a run records the message id it
 * actually created — which is what makes Beat 8 checkable rather than hopeful.
 */
export async function postMessage(
  webhookUrl: string,
  message: DiscordPost,
  signal?: AbortSignal,
): Promise<DiscordPostResult> {
  const content = message.content.trim();
  if (content.length === 0) {
    throw new IntegrationError("Discord will not accept an empty message.");
  }
  if (content.length > DISCORD_CONTENT_LIMIT) {
    throw new IntegrationError(
      `Discord messages are limited to ${DISCORD_CONTENT_LIMIT} characters; this one is ${content.length}.`,
    );
  }

  const response = await request(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content,
      ...(message.username ? { username: message.username } : {}),
    }),
    timeoutMs: 15_000,
    signal,
    /**
     * Discord rate-limits a webhook to roughly five posts per two seconds and
     * answers 429 with a `Retry-After`, which is precisely the case one short pause
     * fixes. `onTransportError` stays **off**: a POST that creates a message may
     * have succeeded before the connection died, and two copies of Beat 8's message
     * on a shared screen is a worse outcome than one failed step that says why.
     */
    retry: { attempts: 2 },
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new IntegrationError(
      `Discord refused the message: ${apiErrorMessage(body, `HTTP ${response.status}`)}`,
      response.status,
    );
  }

  const json = (body.json ?? {}) as Record<string, unknown>;
  return {
    messageId: typeof json.id === "string" ? json.id : null,
    channelId: typeof json.channel_id === "string" ? json.channel_id : null,
    status: response.status,
  };
}
