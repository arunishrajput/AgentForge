import { z } from "zod";

import type { CredentialMetadata } from "@/lib/credentials";

import {
  AIRTABLE_CREDENTIAL_KIND,
  verifyToken as verifyAirtableToken,
} from "./airtable";
import { GITHUB_CREDENTIAL_KIND, verifyToken as verifyGitHubToken } from "./github";
import { NOTION_CREDENTIAL_KIND, verifyToken as verifyNotionToken } from "./notion";
import {
  normaliseWebhookUrl as normaliseSlackWebhook,
  SLACK_CREDENTIAL_KIND,
  verifyWebhook as verifySlackWebhook,
} from "./slack";

/**
 * **The token-credential registry — Phase 23B.**
 *
 * Phase 9 left a comment on `nodes/integration/shared.ts` saying it existed "so a fifth
 * integration is a node file and nothing else". That was true of the *node* and false of
 * everything around it: Discord needed its own API route, its own hand-written
 * `ROTATION_RULES` entry, its own settings card and its own three client methods. Four more
 * integrations built that way is four copies of each, and the copies are where an obligation
 * gets forgotten — `ROTATION_RULES` has a test precisely because a kind added without an
 * entry would be silently unrotatable.
 *
 * So this is a table, and everything that can be derived from it is:
 *
 *   • `ROTATION_RULES`     generated in `credentials/rotation.ts`, so a new kind is rotatable
 *                          the moment it exists rather than when somebody remembers
 *   • the API route        one dynamic `/api/integrations/[service]`, not four files
 *   • the settings cards   rendered from `describeTokenIntegrations()`
 *   • the vault entry      already derived from `ROTATION_RULES`
 *
 * **What is deliberately not in here:** Discord and Google. Discord's secret is a webhook URL
 * with provider-supplied metadata this shape has no room for, and Google is OAuth — a
 * refresh token nobody can type, which `RotationRule`'s `reconnect` mode exists for. Bending
 * either into this table would make the table about two special cases instead of about the
 * thing all four of these genuinely share: **a bearer secret the user pastes, which one HTTPS
 * request can prove.**
 *
 * **No `@/db` import, and the `CredentialMetadata` import is `import type`** so it is erased
 * at compile time. That keeps this module loadable by the test runner with no connection
 * string, which is D18 and is what lets `tokens.test.ts` assert every entry cheaply.
 */

export interface TokenIntegration {
  /** URL segment: `/api/integrations/<slug>`. Stable — it is in the client and the UI. */
  slug: string;
  /** The credential kind stored in the database. Stable — it is in existing rows. */
  kind: string;
  /** The service's name, as it appears in a heading and in an error message. */
  service: string;
  /** What the settings card calls the secret, as a label above an input. Sentence case. */
  secretLabel: string;
  /**
   * The same thing as a **lower-case noun phrase**, for the middle of a sentence: "the new
   * incoming webhook URL", "no GitHub personal access token".
   *
   * A second field rather than `secretLabel.toLowerCase()`, because that produced "incoming
   * webhook url" in the vault and in three error messages — lower-casing a string that
   * contains an acronym is a transformation that is wrong exactly as often as the label
   * contains one. Two fields, each correct where it is used, and no string mangling.
   */
  secretNoun: string;
  /** Shown in the empty input. Never a real credential. */
  placeholder: string;
  /** Shape-checked before the provider is asked, so a typo costs no round trip. */
  schema: z.ZodType<string>;
  /** Tidy the pasted value. Identity when there is nothing to tidy. */
  normalise?: (raw: string) => string;
  /** Prove it against the real service, and return the non-secret half worth storing. */
  verify: (secret: string, signal?: AbortSignal) => Promise<CredentialMetadata>;
  /** One line the settings card shows beside a connected credential, from its metadata. */
  detail: (metadata: CredentialMetadata) => string | null;
  /** Two or three sentences on the card: what it is for and what to be careful of. */
  blurb: string;
  /** Where the user creates one. */
  docsHref: string;
  docsLabel: string;
  /** The vault's one-sentence explanation of what rotating this does. */
  rotationHelp: string;
  /** Registry node types that stop working without it. Shown before revoking. */
  nodes: string[];
}

export const TOKEN_INTEGRATIONS: readonly TokenIntegration[] = [
  {
    slug: "slack",
    kind: SLACK_CREDENTIAL_KIND,
    service: "Slack",
    secretLabel: "Incoming webhook URL",
    secretNoun: "incoming webhook URL",
    placeholder: "https://hooks.slack.com/services/…",
    schema: z.string().trim().min(1).max(500),
    normalise: normaliseSlackWebhook,
    verify: async (secret, signal) => {
      await verifySlackWebhook(secret, signal);
      // Slack has no endpoint that describes a webhook, and every identifying part of the
      // URL is inside the secret itself — so there is genuinely nothing non-secret to store.
      // An empty object is the honest answer; the card says "Connected" and no more.
      return {};
    },
    detail: () => null,
    blurb:
      "An incoming webhook posts to one channel, chosen when you created it. Slack does not let a caller override the channel, the username or the icon, so a workflow can only choose the words — which is why the agent is allowed to use this node. The URL is itself a secret: anyone holding it can post to that channel.",
    docsHref: "https://api.slack.com/apps",
    docsLabel: "Create a Slack app → Incoming Webhooks",
    rotationHelp:
      "The new webhook is checked against Slack before it replaces the old one, and the check posts nothing to your channel.",
    nodes: ["integration.slack"],
  },
  {
    slug: "notion",
    kind: NOTION_CREDENTIAL_KIND,
    service: "Notion",
    secretLabel: "Internal integration secret",
    secretNoun: "internal integration secret",
    placeholder: "ntn_…",
    schema: z.string().trim().min(20).max(300),
    verify: async (secret, signal) => {
      const identity = await verifyNotionToken(secret, signal);
      return { botName: identity.botName, workspaceName: identity.workspaceName };
    },
    detail: (metadata) => metadata.workspaceName ?? metadata.botName ?? null,
    blurb:
      "A Notion integration can only see pages and databases you have explicitly connected to it — the token alone reaches nothing. After pasting it, open each page or database in Notion and use “…” → Connections to connect this integration, or every run will report a 404.",
    docsHref: "https://www.notion.so/profile/integrations",
    docsLabel: "Create an internal Notion integration",
    rotationHelp:
      "The new secret is checked against Notion before it replaces the old one. Which pages the integration can see does not change.",
    nodes: ["integration.notion"],
  },
  {
    slug: "github",
    kind: GITHUB_CREDENTIAL_KIND,
    service: "GitHub",
    secretLabel: "Personal access token",
    secretNoun: "personal access token",
    placeholder: "github_pat_… or ghp_…",
    schema: z.string().trim().min(20).max(300),
    verify: async (secret, signal) => {
      const identity = await verifyGitHubToken(secret, signal);
      return { login: identity.login };
    },
    detail: (metadata) => (metadata.login ? `@${metadata.login}` : null),
    blurb:
      "Use a fine-grained token limited to the repositories you want and to the Issues permission, read and write. The repositories you select are the real boundary: a workflow naming any other repository gets a 404 no matter what its configuration says. This integration files issues and comments — it never touches code.",
    docsHref: "https://github.com/settings/personal-access-tokens/new",
    docsLabel: "Create a fine-grained GitHub token",
    rotationHelp:
      "The new token is checked against GitHub before it replaces the old one. The old token is not revoked — do that in GitHub.",
    nodes: ["integration.github"],
  },
  {
    slug: "airtable",
    kind: AIRTABLE_CREDENTIAL_KIND,
    service: "Airtable",
    secretLabel: "Personal access token",
    secretNoun: "personal access token",
    placeholder: "pat…",
    schema: z.string().trim().min(20).max(300),
    verify: async (secret, signal) => {
      const identity = await verifyAirtableToken(secret, signal);
      return { userId: identity.userId, email: identity.email };
    },
    detail: (metadata) => metadata.email ?? metadata.userId ?? null,
    blurb:
      "A personal access token is granted per base and per scope. Give it the bases you want and add data.records:read to read rows, data.records:write to add them — leaving write off makes this integration genuinely read-only, whatever a workflow asks for.",
    docsHref: "https://airtable.com/create/tokens",
    docsLabel: "Create an Airtable personal access token",
    rotationHelp:
      "The new token is checked against Airtable before it replaces the old one. The old token is not revoked — do that in Airtable.",
    nodes: ["integration.airtable"],
  },
];

const BY_SLUG = new Map(TOKEN_INTEGRATIONS.map((entry) => [entry.slug, entry]));
const BY_KIND = new Map(TOKEN_INTEGRATIONS.map((entry) => [entry.kind, entry]));

export function tokenIntegrationBySlug(slug: string): TokenIntegration | null {
  return BY_SLUG.get(slug) ?? null;
}

export function tokenIntegrationByKind(kind: string): TokenIntegration | null {
  return BY_KIND.get(kind) ?? null;
}

/**
 * The card copy, without the functions.
 *
 * The settings page is a server component and the cards are a client one, so what crosses
 * that boundary has to be plain data — a `verify` closure would be a build error at best and
 * the service's verification logic shipped to the browser at worst.
 */
export interface TokenIntegrationCopy {
  slug: string;
  service: string;
  secretLabel: string;
  secretNoun: string;
  placeholder: string;
  blurb: string;
  docsHref: string;
  docsLabel: string;
  nodes: string[];
}

export function describeTokenIntegration(entry: TokenIntegration): TokenIntegrationCopy {
  return {
    slug: entry.slug,
    service: entry.service,
    secretLabel: entry.secretLabel,
    secretNoun: entry.secretNoun,
    placeholder: entry.placeholder,
    blurb: entry.blurb,
    docsHref: entry.docsHref,
    docsLabel: entry.docsLabel,
    nodes: entry.nodes,
  };
}
