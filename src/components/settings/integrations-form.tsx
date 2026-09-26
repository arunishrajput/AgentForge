"use client";

import { useState } from "react";

import {
  api,
  ApiRequestError,
  type DiscordStatus,
  type GoogleStatus,
} from "@/lib/canvas/client";

/**
 * Credential management for the Phase 9 integrations.
 *
 * Write-only, on the same terms as the provider key: the Discord webhook URL is a
 * bearer secret and the Google refresh token never leaves the server, so this
 * component has no way to read either back and does not pretend to. What it *can*
 * show is which channel and which account are connected, which is the part a user
 * actually needs in order to trust that the right thing is wired up.
 *
 * Google is a link, not a button with a `fetch` behind it: consent is a top-level
 * navigation to accounts.google.com and back.
 */

const STORED_AT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/**
 * UTC, fixed locale. This is a client component, so React renders it on the server
 * for the initial HTML and again in the browser — and `toLocaleString()` disagrees
 * across the two, which is hydration error #418 (found on the deployed settings page
 * in Phase 6, not by a test).
 */
function storedAt(iso: string): string {
  return `${STORED_AT.format(new Date(iso))} UTC`;
}

/**
 * The callback redirects with a fixed code, never with Google's own words, so nothing
 * from the query string is rendered. This map is the only text those codes produce.
 */
const CALLBACK_MESSAGES: Record<string, { text: string; tone: "good" | "bad" }> = {
  connected: { text: "Google connected. Sheets and Gmail nodes can run now.", tone: "good" },
  denied: { text: "Google consent was cancelled, so nothing was connected.", tone: "bad" },
  state: {
    text: "That connection attempt could not be verified. Start it again from this page.",
    tone: "bad",
  },
  failed: { text: "Google could not complete the connection. Try again.", tone: "bad" },
};

export function IntegrationsForm({
  discord: initialDiscord,
  google: initialGoogle,
  callbackStatus,
}: {
  discord: DiscordStatus;
  google: GoogleStatus;
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
    <div className="space-y-6">
      {callback && (
        <p
          role={callback.tone === "bad" ? "alert" : undefined}
          className={`animate-rise text-ui ${callback.tone === "good" ? "text-ok" : "text-warn"}`}
        >
          {callback.text}
        </p>
      )}

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Discord</h2>
          {discord.configured ? (
            <span className="text-xs text-ok">
              Connected{discord.webhookName ? ` as “${discord.webhookName}”` : ""}
              {discord.updatedAt ? ` · ${storedAt(discord.updatedAt)}` : ""}
            </span>
          ) : (
            <span className="text-muted text-xs">Not connected</span>
          )}
        </div>

        <p className="text-muted mt-2 text-ui">
          In Discord: channel settings → Integrations → Webhooks → <em>Copy Webhook URL</em>.
          That URL is itself a secret — anyone holding it can post to the channel — so it is
          encrypted before storage and never sent back to this page.
        </p>

        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveWebhook();
          }}
        >
          <input
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
            aria-label="Discord webhook URL"
            className="field min-w-0 flex-1 font-mono placeholder:font-sans"
          />
          <button
            type="submit"
            disabled={busy !== null || webhookUrl.trim().length === 0}
            className="btn btn-primary"
          >
            {busy === "discord-save" ? "Verifying…" : "Save webhook"}
          </button>
        </form>

        <p className="text-muted mt-2 text-xs">
          Checked against Discord before it is stored, so a revoked or mistyped webhook
          fails here rather than halfway through a run.
        </p>

        {discord.configured && (
          <button
            type="button"
            onClick={removeWebhook}
            disabled={busy !== null}
            className="btn btn-ghost hover:text-bad mt-3 -ml-3 text-xs"
          >
            {busy === "discord-remove" ? "Deleting…" : "Delete stored webhook"}
          </button>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Google Sheets &amp; Gmail</h2>
          {google.connected ? (
            <span className="text-xs text-ok">
              Connected{google.email ? ` · ${google.email}` : ""}
            </span>
          ) : (
            <span className="text-muted text-xs">Not connected</span>
          )}
        </div>

        <p className="text-muted mt-2 text-ui">
          Asked for separately from sign-in, and only when you want it: signing in never
          requests access to your spreadsheets or your mail. Leave both boxes ticked on
          Google&rsquo;s screen — unticking one connects successfully and then fails inside a
          run.
        </p>

        {google.connected && (
          <ul className="mt-4 space-y-1.5 text-ui">
            <Capability granted={google.canAppendSheets} label="Append rows to your Sheets" />
            <Capability granted={google.canSendMail} label="Send email as you" />
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* A link, not a fetch: consent is a top-level navigation Google must control. */}
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- an API route, not a page:
              Link would client-navigate and never reach Google's consent screen. */}
          <a
            href="/api/integrations/google/connect"
            className="btn btn-primary"
          >
            {google.connected ? "Reconnect Google" : "Connect Google"}
          </a>
          {google.connected && (
            <button
              type="button"
              onClick={disconnectGoogle}
              disabled={busy !== null}
              className="btn btn-ghost hover:text-bad px-2 text-xs"
            >
              {busy === "google-remove" ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="text-bad animate-fade text-ui">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="text-ok animate-fade text-ui">
          {notice}
        </p>
      )}
    </div>
  );
}

/**
 * Per-scope, because Google's consent screen lets a user untick one. A connection
 * holding only Sheets is a real state, and the only place it can be seen before a run
 * fails is here.
 */
function Capability({ granted, label }: { granted: boolean; label: string }) {
  return (
    <li className={granted ? "text-muted" : "text-warn"}>
      <span aria-hidden="true" className="mr-2">
        {granted ? "✓" : "✗"}
      </span>
      {label}
      {!granted && " — reconnect and allow it"}
    </li>
  );
}
