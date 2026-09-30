"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Labelled } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatUtc } from "@/lib/format/date";
import {
  api,
  ApiRequestError,
  type DiscordStatus,
  type GoogleStatus,
  type TokenIntegrationStatus,
} from "@/lib/canvas/client";

import { TokenIntegrationCard } from "./token-integration-card";

/**
 * Credential management for the Phase 9 integrations.
 *
 * Write-only, on the same terms as the provider key: the Discord webhook URL is a
 * bearer secret and the Google refresh token never leaves the server, so this
 * component has no way to read either back and does not pretend to. What it *can*
 * show is which channel and which account are connected, which is the part a user
 * needs in order to trust that the right thing is wired up.
 *
 * Google is a link, not a button with a `fetch` behind it: consent is a top-level
 * navigation to accounts.google.com and back.
 */

/**
 * The callback redirects with a fixed code, never with Google's own words, so
 * nothing from the query string is rendered. This map is the only text those codes
 * produce.
 */
const CALLBACK_MESSAGES: Record<string, { text: string; tone: "ok" | "bad" }> = {
  connected: { text: "Google connected. Sheets and Gmail nodes can run now.", tone: "ok" },
  denied: { text: "Google consent was cancelled, so nothing was connected.", tone: "bad" },
  state: {
    text: "That connection attempt could not be verified. Start it again from this page.",
    tone: "bad",
  },
  failed: { text: "Google could not complete the connection. Try again.", tone: "bad" },
  // Phase 19B: connecting a credential is an admin action, because every member of the
  // workspace can then act as the connected account.
  forbidden: {
    text: "Connecting Google needs the admin role in this workspace.",
    tone: "bad",
  },
};

export function IntegrationsForm({
  discord: initialDiscord,
  google: initialGoogle,
  tokens,
  callbackStatus,
}: {
  discord: DiscordStatus;
  google: GoogleStatus;
  /**
   * Phase 23B's four, as data. This component does not know which services they are — the
   * copy, the placeholder and the link all come from `lib/integrations/tokens.ts` through the
   * server component, so adding a fifth adds nothing here.
   */
  tokens: TokenIntegrationStatus[];
  callbackStatus?: string;
}) {
  const [discord, setDiscord] = useState(initialDiscord);
  const [google, setGoogle] = useState(initialGoogle);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState<null | "discord-save" | "discord-remove" | "google-remove">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const callback = callbackStatus ? CALLBACK_MESSAGES[callbackStatus] : undefined;

  const report = (caught: unknown, fallback: string) => {
    setError(caught instanceof ApiRequestError ? caught.message : fallback);
    setNotice(null);
  };

  const saveWebhook = async () => {
    if (webhookUrl.trim().length === 0) return;
    setBusy("discord-save");
    setError(null);
    setNotice(null);
    try {
      const saved = await api.saveDiscordIntegration({ webhookUrl: webhookUrl.trim() });
      setDiscord(saved);
      setWebhookUrl("");
      setNotice(
        saved.webhookName
          ? `Verified against Discord and stored, encrypted — posting as “${saved.webhookName}”.`
          : "Verified against Discord and stored, encrypted.",
      );
    } catch (caught) {
      report(caught, "Could not save the webhook.");
    } finally {
      setBusy(null);
    }
  };

  const removeWebhook = async () => {
    setBusy("discord-remove");
    setError(null);
    try {
      setDiscord(await api.deleteDiscordIntegration());
      setNotice("Discord webhook deleted.");
    } catch (caught) {
      report(caught, "Could not delete the webhook.");
    } finally {
      setBusy(null);
    }
  };

  const disconnectGoogle = async () => {
    setBusy("google-remove");
    setError(null);
    try {
      setGoogle(await api.disconnectGoogleIntegration());
      setNotice("Google disconnected. Sheets and Gmail nodes will stop running.");
    } catch (caught) {
      report(caught, "Could not disconnect Google.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {callback && <Notice tone={callback.tone} title={callback.text} />}

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Discord</h2>
          {discord.configured ? (
            <Badge className="text-ok">
              <span aria-hidden="true">✓</span> Connected
              {discord.webhookName ? ` as “${discord.webhookName}”` : ""}
              {discord.updatedAt ? ` · ${formatUtc(discord.updatedAt)}` : ""}
            </Badge>
          ) : (
            <Badge className="text-muted">Not connected</Badge>
          )}
        </div>

        <p className="text-muted mt-2 text-sm text-pretty">
          In Discord: channel settings → Integrations → Webhooks → <em>Copy Webhook URL</em>.
          That URL is itself a secret — anyone holding it can post to the channel — so it is
          encrypted before storage and never sent back to this page.
        </p>

        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveWebhook();
          }}
        >
          <Labelled
            label="Webhook URL"
            hint="Checked against Discord before it is stored, so a revoked or mistyped webhook fails here rather than halfway through a run."
            className="min-w-56 flex-1"
          >
            <Input
              type="password"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder={
                discord.configured
                  ? "Replace the stored webhook URL…"
                  : "https://discord.com/api/webhooks/…"
              }
              autoComplete="off"
              spellCheck={false}
              className="font-mono placeholder:font-sans"
            />
          </Labelled>
          <Button
            type="submit"
            tone="primary"
            loading={busy === "discord-save"}
            disabled={busy !== null || webhookUrl.trim().length === 0}
          >
            {busy === "discord-save" ? "Verifying…" : "Save webhook"}
          </Button>
        </form>

        {discord.configured && (
          <Button
            tone="ghost"
            size="sm"
            onClick={removeWebhook}
            disabled={busy !== null}
            className="hover:text-bad mt-3 -ml-2.5"
          >
            {busy === "discord-remove" ? "Deleting…" : "Delete stored webhook"}
          </Button>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Google Sheets &amp; Gmail</h2>
          {google.connected ? (
            <Badge className="text-ok">
              <span aria-hidden="true">✓</span> Connected
              {google.email ? ` · ${google.email}` : ""}
            </Badge>
          ) : (
            <Badge className="text-muted">Not connected</Badge>
          )}
        </div>

        <p className="text-muted mt-2 text-sm text-pretty">
          Asked for separately from sign-in, and only when you want it: signing in never
          requests access to your spreadsheets or your mail. Leave both boxes ticked on
          Google&rsquo;s screen — unticking one connects successfully and then fails inside a
          run.
        </p>

        {google.connected && (
          <>
            <ul className="mt-4 space-y-1.5 text-sm">
              <Capability granted={google.canAppendSheets} label="Append rows to your Sheets" />
              <Capability granted={google.canSendMail} label="Send email as you" />
            </ul>

            {/*
              The sharpest consequence of workspace-scoped credentials (Phase 19A), said
              where the decision is made rather than only in a document nobody opens. A
              connection stored against a workspace can be used by any workflow in it,
              and "send email as you" means exactly that — so a member who never
              connected anything can still send mail under this address.
            */}
            <Notice tone="warn" title="This connection belongs to the workspace" className="mt-4">
              Anyone in it can run a workflow that uses these permissions — including
              sending mail from this address. Disconnect it if that is not what you want.
            </Notice>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* A link, not a fetch: consent is a top-level navigation Google must control. */}
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- an API route, not a page:
              Link would client-navigate and never reach Google's consent screen. */}
          <a href="/api/integrations/google/connect" className="btn btn-primary">
            {google.connected ? "Reconnect Google" : "Connect Google"}
          </a>
          {google.connected && (
            <Button
              tone="ghost"
              size="sm"
              onClick={disconnectGoogle}
              disabled={busy !== null}
              className="hover:text-bad"
            >
              {busy === "google-remove" ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
        </div>
      </Card>

      {tokens.map((token) => (
        <TokenIntegrationCard
          key={token.slug}
          initial={token}
          onChange={(_status, message) => {
            setNotice(message);
            setError(null);
          }}
        />
      ))}

      {error && <Notice tone="bad" title={error} />}
      {notice && !error && <Notice tone="ok" title={notice} />}
    </div>
  );
}

/**
 * Per-scope, because Google's consent screen lets a user untick one. A connection
 * holding only Sheets is a real state, and the only place it can be seen before a
 * run fails is here.
 */
function Capability({ granted, label }: { granted: boolean; label: string }) {
  return (
    <li className={granted ? "text-muted" : "text-warn font-semibold"}>
      <span aria-hidden="true" className="mr-2">
        {granted ? "✓" : "✗"}
      </span>
      {label}
      {!granted && " — reconnect and allow it"}
    </li>
  );
}
