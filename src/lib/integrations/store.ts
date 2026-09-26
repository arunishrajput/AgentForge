import {
  deleteCredential,
  getCredential,
  putCredential,
  readSecret,
} from "@/lib/credentials";
import { required } from "@/lib/env";

import {
  DISCORD_CREDENTIAL_KIND,
  normaliseWebhookUrl,
  verifyWebhook,
} from "./discord";
import {
  callbackUrl,
  GMAIL_SEND_SCOPE,
  GOOGLE_CREDENTIAL_KIND,
  type GoogleOAuthConfig,
  missingScopes,
  refreshAccessToken,
  SHEETS_SCOPE,
} from "./google";
import { IntegrationError } from "./net";

/**
 * The database-touching half of the integrations: reading and writing credentials,
 * and turning a stored Google refresh token into an access token a node can use.
 *
 * Split from the protocol modules on purpose — those stay importable by the test
 * runner with no database and no network (D18). Everything here needs `@/db`, and
 * nothing here knows an HTTP wire format.
 *
 * **Nothing in this file returns a secret to a caller that could serialise it.** The
 * two `…Status` projections carry `configured`/`connected` and metadata only, which
 * is the same rule Phase 6 set for the provider key: a hint is still key material.
 */

/* ------------------------------------------------------------------ *
 * Discord
 * ------------------------------------------------------------------ */

export interface DiscordStatus {
  configured: boolean;
  /** The webhook's name in Discord, so the user can see *which* one is wired up. */
  webhookName: string | null;
  channelId: string | null;
  updatedAt: string | null;
}

export async function discordStatus(ownerId: string): Promise<DiscordStatus> {
  const credential = await getCredential({ ownerId, kind: DISCORD_CREDENTIAL_KIND });
  return {
    configured: credential !== null,
    webhookName: credential?.metadata.webhookName ?? null,
    channelId: credential?.metadata.channelId ?? null,
    updatedAt: credential?.updatedAt ?? null,
  };
}

/** Shape-checked, then proved against Discord, and only then stored. */
export async function storeDiscordWebhook(
  ownerId: string,
  rawUrl: string,
): Promise<DiscordStatus> {
  const url = normaliseWebhookUrl(rawUrl);
  const info = await verifyWebhook(url);

  await putCredential({
    ownerId,
    kind: DISCORD_CREDENTIAL_KIND,
    secret: url,
    metadata: {
      webhookName: info.webhookName,
      channelId: info.channelId,
      guildId: info.guildId,
    },
  });

  return discordStatus(ownerId);
}

export async function clearDiscordWebhook(ownerId: string): Promise<DiscordStatus> {
  await deleteCredential({ ownerId, kind: DISCORD_CREDENTIAL_KIND });
  return discordStatus(ownerId);
}

/** Server-side only. The node's `execute` is the only caller. */
export async function readDiscordWebhook(ownerId: string): Promise<string> {
  const secret = await readSecret({ ownerId, kind: DISCORD_CREDENTIAL_KIND });
  if (!secret) {
    throw new IntegrationError(
      "No Discord webhook is connected. Add one in Settings → Integrations.",
    );
  }
  return secret;
}

/* ------------------------------------------------------------------ *
 * Google
 * ------------------------------------------------------------------ */

export function googleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    redirectUri: callbackUrl(required("APP_BASE_URL")),
  };
}

export interface GoogleStatus {
  connected: boolean;
  email: string | null;
  scopes: string[];
  /** Per-capability, because a user can untick one scope on the consent screen. */
  canAppendSheets: boolean;
  canSendMail: boolean;
  updatedAt: string | null;
}

export async function googleStatus(ownerId: string): Promise<GoogleStatus> {
  const credential = await getCredential({ ownerId, kind: GOOGLE_CREDENTIAL_KIND });
  const scopes = credential?.metadata.scopes ?? [];
  return {
    connected: credential !== null,
    email: credential?.metadata.email ?? null,
    scopes,
    canAppendSheets: missingScopes(scopes, [SHEETS_SCOPE]).length === 0,
    canSendMail: missingScopes(scopes, [GMAIL_SEND_SCOPE]).length === 0,
    updatedAt: credential?.updatedAt ?? null,
  };
}

/**
 * Stores a completed connection.
 *
 * A refresh token is **required** here rather than optional. Google omits it when the
 * user has already granted these scopes and the request did not force a consent
 * prompt — leaving a connection that works for one hour and then fails in a run with
 * no way for the user to tell why. Refusing it at the point of connection turns that
 * into a legible error on the settings page instead.
 */
export async function storeGoogleConnection(options: {
  ownerId: string;
  refreshToken: string | null;
  scopes: string[];
  email: string | null;
}): Promise<GoogleStatus> {
  if (!options.refreshToken) {
    throw new IntegrationError(
      "Google returned no refresh token. Remove AgentForge at myaccount.google.com/permissions and connect again.",
    );
  }

  await putCredential({
    ownerId: options.ownerId,
    kind: GOOGLE_CREDENTIAL_KIND,
    secret: options.refreshToken,
    metadata: { email: options.email, scopes: options.scopes },
  });

  return googleStatus(options.ownerId);
}

export async function disconnectGoogle(ownerId: string): Promise<GoogleStatus> {
  await deleteCredential({ ownerId, kind: GOOGLE_CREDENTIAL_KIND });
  return googleStatus(ownerId);
}

/**
 * An access token for a node, with the scopes it needs already checked.
 *
 * **Refreshed per call, deliberately not cached.** One extra round trip to Google is
 * ~200 ms against a run budget of 120 s; an in-process cache would need invalidating
 * on disconnect and on reconnect, and a cache that kept serving a token for a
 * credential the user had just removed is a worse failure than a slower node. Fewer
 * moving parts (CLAUDE.md → scope control).
 *
 * Scopes come from what Google actually **granted**, recorded at connection time, not
 * from what was asked for. The consent screen lets a user untick one.
 */
export async function googleAccessToken(options: {
  ownerId: string;
  requiredScopes: string[];
  capability: string;
  signal?: AbortSignal;
}): Promise<string> {
  const credential = await getCredential({
    ownerId: options.ownerId,
    kind: GOOGLE_CREDENTIAL_KIND,
  });
  if (!credential) {
    throw new IntegrationError(
      "Google is not connected. Connect it in Settings → Integrations.",
    );
  }

  const missing = missingScopes(credential.metadata.scopes ?? [], options.requiredScopes);
  if (missing.length > 0) {
    throw new IntegrationError(
      `The connected Google account did not grant permission to ${options.capability}. Reconnect it in Settings → Integrations and leave every box ticked.`,
    );
  }

  const refreshToken = await readSecret({
    ownerId: options.ownerId,
    kind: GOOGLE_CREDENTIAL_KIND,
  });
  if (!refreshToken) {
    throw new IntegrationError(
      "Google is not connected. Connect it in Settings → Integrations.",
    );
  }

  try {
    const tokens = await refreshAccessToken(
      googleOAuthConfig(),
      refreshToken,
      options.signal,
    );
    return tokens.accessToken;
  } catch (error) {
    // `invalid_grant` is the revoked/expired case, and it is the one failure a user
    // can actually fix — so it must not read like an internal error. DEMO.md's
    // Fallback E depends on this being recoverable on stage.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("invalid_grant")) {
      throw new IntegrationError(
        "The Google connection has been revoked or expired. Reconnect it in Settings → Integrations.",
      );
    }
    throw error;
  }
}
