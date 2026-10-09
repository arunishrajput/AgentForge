"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Labelled, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api, ApiRequestError } from "@/lib/canvas/client";
import { formatUtc } from "@/lib/format/date";
import type { TokenSummary } from "@/lib/tokens/store";
import { atLeast, type WorkspaceRole } from "@/lib/workspace/roles";

/**
 * Personal access tokens — Phase 41, D192. What a script presents instead of a sign-in.
 *
 * The page says the three things a person must know before creating one: it is **shown once**
 * (only a hash is stored), it is **capped by their own role** at every request (so a demotion
 * takes power from their tokens too), and it **expires**. The created token is held in component
 * state only — never in the URL, storage or the list — and goes when the notice is dismissed or
 * the page is left.
 */
const EXPIRIES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

export function TokensPanel({
  initial,
  workspaceName,
  viewerRole,
}: {
  initial: TokenSummary[];
  workspaceName: string;
  viewerRole: WorkspaceRole;
}) {
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">(atLeast(viewerRole, "editor") ? "editor" : "viewer");
  const [days, setDays] = useState(30);
  const [issued, setIssued] = useState<(TokenSummary & { token: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = (caught: unknown, fallback: string) =>
    setError(caught instanceof ApiRequestError ? caught.message : fallback);

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy("create");
    setError(null);
    try {
      const made = await api.createToken({ name: trimmed, role, expiresInDays: days });
      const { token: _shownOnce, ...summary } = made;
      void _shownOnce;
      setIssued(made);
      setCopied(false);
      setName("");
      setTokens((current) => [summary, ...current]);
    } catch (caught) {
      report(caught, "That token could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (token: TokenSummary) => {
    setBusy(`revoke:${token.id}`);
    setError(null);
    try {
      const revoked = await api.revokeToken(token.id);
      setTokens((current) => current.map((t) => (t.id === revoked.id ? revoked : t)));
      if (issued?.id === token.id) setIssued(null);
    } catch (caught) {
      report(caught, "That token could not be revoked.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Could not copy automatically. Select the token and copy it.");
    }
  };

  const live = tokens.filter((t) => t.state === "live");
  const spent = tokens.filter((t) => t.state !== "live");

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="text-base font-bold">Access tokens</h2>
        <p className="text-muted mt-1 text-sm text-pretty">
          A token lets a script or another program use the AgentForge API as you in{" "}
          <strong className="font-semibold">{workspaceName}</strong> — list and edit workflows, start
          runs, read results. It can never manage tokens, credentials, members or the vault.
        </p>
        <ul className="text-faint mt-2 list-disc space-y-1 pl-5 text-2xs">
          <li>
            <strong className="text-ink font-semibold">Shown once.</strong> Only a hash is stored, so a
            lost token is replaced, not recovered.
          </li>
          <li>
            <strong className="text-ink font-semibold">Never above you.</strong> A token carries your
            role or the one you give it, whichever is lower — and your role as it is at each request, so
            a demotion reaches your tokens too.
          </li>
          <li>
            <strong className="text-ink font-semibold">Always expires,</strong> and can be revoked here
            at any moment.
          </li>
        </ul>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Labelled label="Name" className="min-w-48 flex-1">
            <Input
              value={name}
              placeholder="nightly export"
              autoComplete="off"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
            />
          </Labelled>
          <Labelled label="Can" className="w-40">
            <Select value={role} onChange={(event) => setRole(event.target.value as "viewer" | "editor")}>
              {atLeast(viewerRole, "editor") && <option value="editor">Edit and run</option>}
              <option value="viewer">Read only</option>
            </Select>
          </Labelled>
          <Labelled label="Expires in" className="w-32">
            <Select value={String(days)} onChange={(event) => setDays(Number(event.target.value))}>
              {EXPIRIES.map((e) => (
                <option key={e.days} value={e.days}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Labelled>
          <Button onClick={() => void create()} loading={busy === "create"} disabled={name.trim().length === 0}>
            Create token
          </Button>
        </div>

        {error && (
          <Notice tone="bad" className="mt-4" title={error} />
        )}

        {issued && (
          <Notice
            tone="ok"
            className="mt-4"
            title={`Token “${issued.name}” is ready`}
            action={
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button onClick={() => void copy(issued.token)}>{copied ? "Copied" : "Copy token"}</Button>
                <Button tone="quiet" onClick={() => setIssued(null)}>
                  I have saved it
                </Button>
                <span className="text-faint text-2xs">Expires {formatUtc(issued.expiresAt)}</span>
              </div>
            }
          >
            <p>
              <strong className="text-ink font-semibold">Copy it now.</strong> This is the only time it
              is shown. Send it as <code className="font-mono">Authorization: Bearer …</code>.
            </p>
            <input
              readOnly
              value={issued.token}
              aria-label="Access token"
              onFocus={(event) => event.currentTarget.select()}
              className="field mt-2 font-mono text-2xs"
            />
          </Notice>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold">Your tokens here</h3>
        {live.length === 0 ? (
          <p className="text-muted mt-2 text-sm">No live tokens. Create one above when a script needs it.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {live.map((token) => (
              <li
                key={token.id}
                className="border-line bg-elevated flex flex-wrap items-center gap-3 rounded-xl border-2 p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{token.name}</span>
                  <span className="text-faint block text-2xs">
                    <code className="font-mono">{token.hint}…</code> · expires {formatUtc(token.expiresAt)} ·{" "}
                    {token.lastUsedAt ? `last used ${formatUtc(token.lastUsedAt)}` : "never used"}
                  </span>
                </span>
                <Badge className="shrink-0" icon="◆">
                  {token.role === "editor" ? "edit and run" : "read only"}
                </Badge>
                <Button
                  tone="danger"
                  onClick={() => void revoke(token)}
                  loading={busy === `revoke:${token.id}`}
                  aria-label={`Revoke ${token.name}`}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        {spent.length > 0 && (
          <>
            <h3 className="mt-5 text-sm font-bold">Expired or revoked</h3>
            <ul className="text-muted mt-2 space-y-1 text-2xs">
              {spent.slice(0, 10).map((token) => (
                <li key={token.id} className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{token.name}</span>
                  <code className="font-mono">{token.hint}…</code>
                  <span>{token.state === "revoked" ? "revoked" : `expired ${formatUtc(token.expiresAt)}`}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
