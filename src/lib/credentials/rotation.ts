import { z } from "zod";

import { ApiError } from "@/lib/api-error";
import { DISCORD_CREDENTIAL_KIND } from "@/lib/integrations/discord";
import { GOOGLE_CREDENTIAL_KIND } from "@/lib/integrations/google";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { LLM_CREDENTIAL_KIND } from "./index";

/**
 * **What rotation means for each kind of credential — Phase 21.**
 *
 * Rotating a stored secret is not one operation, and pretending it is produces a vault with
 * a text box under every credential — including the two where typing something is not what
 * rotation is. So this is a table, and the important column is `mode`:
 *
 *   `value`      a secret the user can hold in their hand and paste: an API key, a webhook
 *                URL. Rotation is "supply the new one", and it is **proved against the
 *                provider before it is stored**, by the same code that proved the original
 *   `reconnect`  a secret only the provider can mint: an OAuth refresh token. There is
 *                nothing to type. Rotation is re-running the consent flow, and the vault
 *                says so and links to it instead of offering a box that could not work
 *
 * ### Why this delegates instead of writing credentials itself
 *
 * `storeProviderKey` and `storeDiscordWebhook` already exist and already validate — a key
 * with one `models.list` call, a webhook with one call to Discord — and those validations
 * are the whole reason a rotation is safe to perform on a live workspace. A second write
 * path would be a second place for that to be forgotten. So this file decides *what may be
 * rotated and how*, and the existing store functions do the writing.
 *
 * The imports are dynamic for a real reason and not for tidiness: `lib/integrations/store`
 * and `lib/ai/settings` both import `./index`, so a static import here would close a cycle
 * through the credential store. The same pattern `lib/ai/settings.ts` already uses for
 * `./provider`.
 *
 * ### The table must cover the registry, and a test asserts it in both directions
 *
 * The same shape as `PUBLISHABLE` in `lib/workflow/share.ts`, for the same reason. A
 * credential kind added in a later phase with no entry here would silently become
 * unrotatable — the vault would list it with no control and nobody would notice, because
 * nothing would break. The test fails the build instead, so adding a kind forces somebody
 * to decide what rotating it means.
 */

export type RotationMode = "value" | "reconnect";

export interface RotationRule {
  mode: RotationMode;
  /** What the vault calls this credential. */
  title: string;
  /** For `value`: the label above the input. */
  secretLabel?: string;
  /** One sentence on what rotation does here, shown in the vault. */
  help: string;
  /** For `reconnect`: where the user has to go to replace it. */
  reconnectHref?: string;
  /**
   * Where a workspace that has none of this goes to add one — **required for every kind**.
   *
   * Separate from `reconnectHref`, which only a `reconnect` credential has. The vault lists
   * the kinds a workspace is *missing*, and a list that names something missing without
   * saying where to get it is a dead end: found in a browser, where an editor's empty
   * workspace offered "Connect it" for Google and nothing at all for the other two.
   */
  connectHref: string;
  /** For `value`: the shape accepted before the provider is asked. */
  schema?: z.ZodType<string>;
}

export const ROTATION_RULES: Record<string, RotationRule> = {
  [LLM_CREDENTIAL_KIND]: {
    mode: "value",
    title: "Model provider key",
    secretLabel: "New API key",
    help: "The new key is checked against the provider before it replaces the old one. Nothing changes if it fails.",
    connectHref: "/settings?tab=provider",
    schema: z.string().trim().min(10).max(400),
  },
  [DISCORD_CREDENTIAL_KIND]: {
    mode: "value",
    title: "Discord webhook",
    secretLabel: "New webhook URL",
    help: "The new URL is called before it replaces the old one, so a wrong one cannot silently break your workflows.",
    connectHref: "/settings?tab=integrations",
    schema: z.string().trim().min(1).max(500),
  },
  [GOOGLE_CREDENTIAL_KIND]: {
    mode: "reconnect",
    title: "Google account",
    help: "A refresh token can only be issued by Google, so there is nothing to paste. Reconnecting replaces it and revokes the old one.",
    reconnectHref: "/settings?tab=integrations",
    connectHref: "/settings?tab=integrations",
  },
};

/** Every kind the product stores. The registry this table must cover. */
export const CREDENTIAL_KINDS = [
  LLM_CREDENTIAL_KIND,
  DISCORD_CREDENTIAL_KIND,
  GOOGLE_CREDENTIAL_KIND,
] as const;

export function rotationRule(kind: string): RotationRule | null {
  return ROTATION_RULES[kind] ?? null;
}

/**
 * Rotate a credential in place.
 *
 * **Refuses before it validates, and validates before it writes.** An unknown kind is a 404
 * rather than a 400: the vault is the only caller and it builds its controls from this
 * table, so a kind it does not know about is not a malformed request but a reference to
 * something that does not exist here.
 *
 * The write itself is the ordinary upsert, so the row keeps its id, its `createdAt` and its
 * audit history, and gains `rotatedAt` plus one on `rotationCount` — which is what "in
 * place" has to mean for the log to stay continuous across a rotation.
 */
export async function rotateCredential(options: {
  scope: WorkspaceScope;
  kind: string;
  secret: string;
}): Promise<{ kind: string; rotated: true }> {
  const rule = rotationRule(options.kind);
  if (!rule) throw new ApiError("not_found", "This product does not store that kind of credential.");

  if (rule.mode === "reconnect") {
    throw new ApiError("invalid_request", rule.help);
  }

  const parsed = rule.schema?.safeParse(options.secret);
  if (parsed && !parsed.success) {
    throw new ApiError("invalid_request", `That does not look like a ${rule.secretLabel ?? "secret"}.`);
  }
  const secret = parsed?.success ? parsed.data : options.secret;

  if (options.kind === LLM_CREDENTIAL_KIND) {
    // Already answers with an `ApiError` carrying the provider's own words, which are the words
    // that tell a user what to fix.
    const { rotateProviderKey } = await import("@/lib/ai/settings");
    await rotateProviderKey(options.scope, secret);
  } else if (options.kind === DISCORD_CREDENTIAL_KIND) {
    // Throws `IntegrationError`, which is Discord's own words and belongs to the client; the
    // mapping happens here, where the service's name is known, rather than in the route.
    const { rotateDiscordWebhook } = await import("@/lib/integrations/store");
    const { integrationApiError } = await import("@/lib/integrations/errors");
    try {
      await rotateDiscordWebhook(options.scope, secret);
    } catch (error) {
      throw integrationApiError("Discord", error);
    }
  } else {
    // Unreachable while every `value` kind above is handled. Kept because the alternative
    // is a silent success that rotated nothing.
    throw new ApiError("internal", "That credential has no rotation path.");
  }

  return { kind: options.kind, rotated: true };
}
