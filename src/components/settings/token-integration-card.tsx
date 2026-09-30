"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Labelled } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api, ApiRequestError, type TokenIntegrationStatus } from "@/lib/canvas/client";
import { formatUtc } from "@/lib/format/date";

/**
 * One card for any paste-a-token integration — **Phase 23B.**
 *
 * It knows nothing about Slack, Notion, GitHub or Airtable. Every word on it arrives as data
 * from `lib/integrations/tokens.ts` by way of the server component, which is what makes a fifth
 * integration a table row instead of a fifth copy of this file. The Discord card above it is
 * the counter-example kept deliberately: it is hand-written because its status carries a
 * webhook name and a channel id that this shape has no room for.
 *
 * **Write-only, like every credential surface here.** The input is `type="password"` and the
 * status that comes back carries `configured` and `detail` — never the secret, not even a
 * masked tail.
 */
export function TokenIntegrationCard({
  initial,
  onChange,
}: {
  initial: TokenIntegrationStatus;
  /** Lets the page hoist a one-line confirmation out of four cards into one place. */
  onChange?: (status: TokenIntegrationStatus, message: string) => void;
}) {
  const [status, setStatus] = useState(initial);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<null | "save" | "remove">(null);
  const [error, setError] = useState<string | null>(null);

  const report = (caught: unknown, fallback: string) => {
    setError(caught instanceof ApiRequestError ? caught.message : fallback);
  };

  const save = async () => {
    const value = secret.trim();
    if (value.length === 0) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await api.saveTokenIntegration(status.slug, value);
      setStatus(saved);
      setSecret("");
      onChange?.(
        saved,
        saved.detail
          ? `Verified against ${saved.service} and stored, encrypted — connected as ${saved.detail}.`
          : `Verified against ${saved.service} and stored, encrypted.`,
      );
    } catch (caught) {
      report(caught, `Could not save the ${status.service} credential.`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      const cleared = await api.deleteTokenIntegration(status.slug);
      setStatus(cleared);
      onChange?.(cleared, `${cleared.service} credential deleted.`);
    } catch (caught) {
      report(caught, `Could not delete the ${status.service} credential.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">{status.service}</h2>
        {status.configured ? (
          <Badge className="text-ok">
            <span aria-hidden="true">✓</span> Connected
            {status.detail ? ` · ${status.detail}` : ""}
            {status.updatedAt ? ` · ${formatUtc(status.updatedAt)}` : ""}
          </Badge>
        ) : (
          <Badge className="text-muted">Not connected</Badge>
        )}
      </div>

      <p className="text-muted mt-2 text-sm text-pretty">{status.blurb}</p>

      <p className="mt-2 text-sm">
        <a
          className="text-accent font-semibold hover:underline hover:underline-offset-4"
          href={status.docsHref}
          target="_blank"
          rel="noreferrer"
        >
          {status.docsLabel}
        </a>
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Labelled
          label={status.secretLabel}
          hint={`Checked against ${status.service} before it is stored, so a wrong one fails here rather than halfway through a run.`}
          className="min-w-56 flex-1"
        >
          <Input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={
              status.configured ? `Replace the stored ${status.secretNoun}…` : status.placeholder
            }
            autoComplete="off"
            spellCheck={false}
            className="font-mono placeholder:font-sans"
          />
        </Labelled>
        <Button
          type="submit"
          tone="primary"
          loading={busy === "save"}
          disabled={busy !== null || secret.trim().length === 0}
        >
          {busy === "save" ? "Verifying…" : status.configured ? "Replace" : "Connect"}
        </Button>
      </form>

      {status.configured && (
        <Button
          tone="ghost"
          size="sm"
          onClick={remove}
          disabled={busy !== null}
          className="hover:text-bad mt-3 -ml-2.5"
        >
          {busy === "remove"
            ? "Deleting…"
            : `Delete stored credential — ${status.nodes.length === 1 ? "the" : "these"} ${status.nodes.join(", ")} node${status.nodes.length === 1 ? "" : "s"} will stop running`}
        </Button>
      )}

      {error && <Notice tone="bad" title={error} className="mt-3" />}
    </Card>
  );
}
