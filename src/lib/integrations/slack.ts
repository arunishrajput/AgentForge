import { IntegrationError, readBody, request, RETRY_STATUSES } from "./net";

/**
 * Slack, over an incoming webhook — Phase 23B.
 *
 * Deliberately the same shape as `./discord.ts` rather than a Web API client with a bot
 * token, and the reason is the security argument rather than the effort. An incoming
 * webhook posts to **one channel, chosen by the person who installed the app**, and Slack's
 * own documentation is explicit that a caller "cannot override the default channel …,
 * username, or icon" (docs.slack.dev, read 2026-10-01). So the only thing a caller decides
 * is the words — which is what makes this node safe to hand the agent (D19), and it is a
 * *stronger* guarantee than Discord's, where a webhook's `username` can be overridden.
 *
 * No database, no `@/db` import: this module stays loadable by the test runner with no
 * network and no connection string (D18). The credential side is in `./store.ts`.
 */

export const SLACK_CREDENTIAL_KIND = "integration.slack";

/**
 * **AgentForge's own cap, not Slack's.** Slack documents no character limit for `text` on
 * an incoming webhook, so there is no upstream number to quote here. This one is chosen
 * from the two constraints that do exist: the message has to stay readable in a channel,
 * and the node's config is persisted in a graph and echoed into a `jsonb` step output.
 */
export const SLACK_TEXT_LIMIT = 4000;

/**
 * `https://hooks.slack.com/services/T…/B…/…` — three path segments after `/services`.
 *
 * Checked by pattern before the URL is ever sent anywhere, because the alternative is
 * posting a user's mistyped secret to whatever host they actually typed. The host is fixed
 * rather than validated loosely for the same reason `guard.ts` refuses plain http: a
 * webhook URL is a bearer credential, and the one place it may be sent is Slack.
 */
const WEBHOOK_PATTERN =
  /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9_-]+$/;

export function normaliseWebhookUrl(raw: string): string {
  const url = raw.trim();
  if (!WEBHOOK_PATTERN.test(url)) {
    throw new IntegrationError(
      "That is not a Slack incoming webhook URL. It looks like https://hooks.slack.com/services/T…/B…/… — create one under Incoming Webhooks in your Slack app.",
    );
  }
  return url;
}

/**
 * The Slack error strings that mean **the webhook itself is gone**, as opposed to the
 * payload being wrong. Every one of them is documented (docs.slack.dev → *Sending messages
 * using incoming webhooks*, read 2026-10-01) together with its status code:
 *
 *   `no_service` 404, `no_active_hooks` 404, `channel_not_found` 404,
 *   `invalid_token` 403, `team_disabled` 403, `action_prohibited` 403,
 *   `no_team` 400, `no_service_id` 400, `channel_is_archived` 400
 *
 * They are matched on the body rather than the status because the status alone cannot tell
 * `no_text` (400, the webhook is fine) from `no_team` (400, it is not).
 */
const DEAD_WEBHOOK: Record<string, string> = {
  no_service: "Slack does not recognise that webhook — it has been removed or disabled.",
  no_active_hooks: "That webhook is disabled in Slack.",
  channel_not_found: "The channel that webhook posts to no longer exists.",
  invalid_token: "Slack rejected that webhook's token as invalid or expired.",
  team_disabled: "That Slack workspace is inactive.",
  action_prohibited: "A Slack admin restriction blocks that webhook from posting.",
  no_team: "Slack could not identify the workspace for that webhook.",
  no_service_id: "That webhook URL is missing its service id.",
  channel_is_archived: "The channel that webhook posts to has been archived.",
};

/**
 * **The bodies that prove a webhook is live without posting anything to the channel.**
 *
 * This is the whole reason `verifyWebhook` can exist. Slack has no `GET` that describes a
 * webhook the way Discord's does, so the only way to ask "is this real" is to send
 * something — and sending a real message to verify a credential would put an AgentForge
 * test post in the user's channel every time they saved or rotated one.
 *
 * `no_text` is the documented answer to a payload with no `text` attribute, and Slack can
 * only produce it *after* it has resolved the webhook. So an empty JSON object is a probe
 * that reaches the same code path a real post would and stops one step short of it.
 */
const LIVE_WEBHOOK = new Set(["no_text", "invalid_payload", "missing_text_or_fallback_or_attachments"]);

const VERIFY_TIMEOUT_MS = 10_000;
const POST_TIMEOUT_MS = 15_000;

/**
 * Prove the webhook exists, without posting. Throws `IntegrationError` if it does not.
 *
 * **Fails closed on an answer it does not recognise**, and passes Slack's own words through
 * when it does. The alternative — accept anything that is not a known failure — would store
 * a webhook that cannot post and defer the error to the middle of a run, which is exactly
 * what proving a credential before storing it exists to prevent.
 */
export async function verifyWebhook(url: string, signal?: AbortSignal): Promise<void> {
  const response = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // No `text`, on purpose. See LIVE_WEBHOOK.
    body: "{}",
    timeoutMs: VERIFY_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
    // A GET-like probe that creates nothing, so repeating it is safe.
    retry: { attempts: 2, on: RETRY_STATUSES, onTransportError: true },
  });

  const body = await readBody(response);
  const answer = body.text.trim();

  if (response.status === 200) return;
  if (LIVE_WEBHOOK.has(answer)) return;

  const known = DEAD_WEBHOOK[answer];
  if (known) throw new IntegrationError(known, response.status);

  throw new IntegrationError(
    `Slack refused that webhook: ${answer.length > 0 ? answer : `HTTP ${response.status}`}.`,
    response.status,
  );
}

/**
 * Post one message. Slack answers `200` with the literal body `ok` and **no message id**,
 * which is why the node's output cannot carry one the way the Discord node's does.
 *
 * Not retried on a transport error: a POST that creates a message may have taken effect
 * even when the answer never arrived, and a duplicate message on somebody's channel is
 * worse than a failed step that says why (`net.ts` → `RetryPolicy`).
 */
export async function postMessage(
  url: string,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    timeoutMs: POST_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES },
  });

  if (response.status === 200) {
    await response.body?.cancel().catch(() => {});
    return;
  }

  const body = await readBody(response);
  const answer = body.text.trim();
  throw new IntegrationError(
    DEAD_WEBHOOK[answer] ??
      `Slack refused the message: ${answer.length > 0 ? answer : `HTTP ${response.status}`}.`,
    response.status,
  );
}
