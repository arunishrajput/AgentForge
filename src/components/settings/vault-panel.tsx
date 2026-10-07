"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Labelled } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, type Vault, type VaultEntry } from "@/lib/canvas/client";
import { formatUtc } from "@/lib/format/date";

/**
 * **The credential vault — Phase 21.**
 *
 * The product already had three places to store a secret and no place to *look* at them. So
 * this tab answers, in one screen, the four questions the other three tabs could not:
 *
 *   what secrets does this workspace hold      — including which ones it does *not*
 *   when was each one last replaced             — `rotatedAt`, not `updatedAt`
 *   when was each one last used, and by what    — from the audit log, not from a guess
 *   how is each one encrypted                   — which root key version wraps it
 *
 * **Nothing here can display a secret**, and not because it chooses not to: the route it
 * reads carries no value, no prefix and no masked tail, so there is nothing in this
 * component's props for a careless render to leak.
 *
 * ### Two things the interface refuses to pretend
 *
 * **A Google connection has no rotation box.** A refresh token can only be minted by Google,
 * so a text input under it would be a control that cannot work — and Phase 20's browser walk
 * found exactly this shape of dishonesty (a trigger-input box above a Run button a viewer did
 * not have). A `reconnect` credential gets a link to the flow that actually replaces it.
 *
 * **Rotating Discord does not revoke the old webhook at Discord.** Nothing in this product
 * can do that, so the panel says so where somebody is about to press the button, rather than
 * leaving them believing a live URL is dead.
 *
 * The quiet register throughout (`DESIGN.md` → *The loud register and the quiet register*):
 * this is a settings form about secrets, and it is not the place for a mascot.
 */
export function VaultPanel({
  initial,
  canAdminister,
  canRekey,
}: {
  initial: Vault;
  /** Whether the viewer may rotate or revoke. `admin`. Read is `viewer`. */
  canAdminister: boolean;
  /** Whether the viewer may re-key the workspace. `owner`. */
  canRekey: boolean;
}) {
  const [vault, setVault] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToast();

  const rotate = async (kind: string) => {
    if (secret.trim().length === 0) return;
    setBusy(kind);
    setError(null);
    try {
      setVault(await api.rotateCredential(kind, secret.trim()));
      setSecret("");
      setOpen(null);
      pushToast({
        tone: "ok",
        title: "Rotated",
        detail: "The new secret was checked against the provider before it replaced the old one.",
      });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not rotate that credential.");
    } finally {
      setBusy(null);
    }
  };

  const rekey = async () => {
    setBusy("rekey");
    setError(null);
    try {
      const { rekey: outcome, vault: next } = await api.rekeyCredentials();
      setVault(next);
      const moved = outcome.rewrapped + outcome.converted;
      const failed = outcome.failures.length > 0;
      pushToast({
        tone: failed ? "bad" : "ok",
        // A failure stays up until it is dismissed (WCAG 2.2.1), because it is the one
        // outcome here somebody has to act on.
        ...(failed ? { duration: null } : {}),
        title: failed
          ? `${outcome.failures.length} credential${outcome.failures.length === 1 ? "" : "s"} could not be re-keyed`
          : moved === 0
            ? "Nothing to re-key"
            : `${moved} credential${moved === 1 ? "" : "s"} re-keyed`,
        detail: failed
          ? "They are still readable under their previous key. Nothing was lost."
          : moved === 0
            ? `Every credential was already under ${outcome.target}.`
            : `Re-wrapped under ${outcome.target}. No secret was decrypted on the way.`,
      });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not re-key this workspace.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Notice tone="bad" title="That did not work">
          {error}
        </Notice>
      )}

      {/* ---------------------------------------------------------------- *
       * How the secrets are held. First, because it frames everything below.
       * ---------------------------------------------------------------- */}
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">How these are encrypted</h2>
          <Badge tone="pop" fill={vault.rootKey.provider === "secret-manager" ? "bg-ok-pop" : "bg-warn-pop"}>
            {vault.rootKey.provider === "secret-manager" ? "Versioned root key" : "Environment key"}
          </Badge>
        </div>
        {/* The wording follows the count. "Every secret below…" above an empty list is a
            sentence about nothing, which is how this read in a workspace that stores none. */}
        <p className="text-muted mt-2 text-sm text-pretty">
          {vault.entries.length === 0 ? (
            <>
              This workspace stores no secrets yet. When it does, each one is encrypted with its
              own key, and that key is itself encrypted with the workspace&rsquo;s root key —
              so the root key can be replaced without touching a single secret.
            </>
          ) : (
            <>
              Every secret below is encrypted with its own key, and that key is itself encrypted
              with this workspace&rsquo;s root key. Replacing the root key re-wraps the small
              keys and never touches a secret — which is what makes rotating it something you
              can actually do.
            </>
          )}
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <Figure label="Stored secrets" value={String(vault.entries.length)} />
          <Figure
            label="Root key in use"
            value={vault.rootKey.versions.length > 0 ? vault.rootKey.versions.join(", ") : "—"}
            mono
          />
          <Figure
            label="Not yet enveloped"
            value={String(vault.legacyCount)}
            tone={vault.legacyCount > 0 ? "warn" : "ok"}
          />
        </dl>

        {vault.rootKey.provider === "environment" && (
          <Notice tone="warn" title="This deployment has no versioned root key" className="mt-4">
            Secrets are encrypted under the <code className="font-mono text-xs">ENCRYPTION_KEY</code>{" "}
            environment variable. That works, but it has no versions, so changing it is not a
            rotation — it makes every stored secret unreadable until they are re-keyed.
            Point <code className="font-mono text-xs">ROOT_KEY_SECRET</code> at a secret store
            to get versions.
          </Notice>
        )}

        {vault.legacyCount > 0 && (
          <Notice
            tone="warn"
            title={`${vault.legacyCount} secret${vault.legacyCount === 1 ? "" : "s"} still use the old single-key scheme`}
            className="mt-4"
            action={
              canRekey ? (
                <Button tone="primary" size="sm" onClick={rekey} loading={busy === "rekey"} disabled={busy !== null}>
                  {busy === "rekey" ? "Re-keying…" : "Re-key this workspace"}
                </Button>
              ) : undefined
            }
          >
            They are encrypted directly under the root key rather than under a key of their
            own, so the root key cannot be replaced without them. Re-keying fixes that in
            place and cannot lose a secret — each one is verified to decrypt after it is
            written.
            {!canRekey && " An owner of this workspace has to do it."}
          </Notice>
        )}

        {vault.legacyCount === 0 && canRekey && vault.entries.length > 0 && (
          <Button
            tone="quiet"
            size="sm"
            onClick={rekey}
            loading={busy === "rekey"}
            disabled={busy !== null}
            className="mt-4"
          >
            {busy === "rekey" ? "Re-keying…" : "Re-key under the current root key"}
          </Button>
        )}
      </Card>

      {/* ---------------------------------------------------------------- *
       * The inventory
       * ---------------------------------------------------------------- */}
      {vault.entries.map((entry) => (
        <CredentialCard
          key={`${entry.kind}:${entry.label}`}
          entry={entry}
          canAdminister={canAdminister}
          open={open === entry.kind}
          onToggle={() => {
            setOpen(open === entry.kind ? null : entry.kind);
            setSecret("");
            setError(null);
          }}
          secret={secret}
          onSecret={setSecret}
          onRotate={() => void rotate(entry.kind)}
          busy={busy === entry.kind}
          disabled={busy !== null}
        />
      ))}

      {vault.missing.length > 0 && (
        <Card className="p-5">
          <h2 className="text-base font-bold">Not connected</h2>
          <p className="text-muted mt-2 text-sm text-pretty">
            This workspace stores nothing for these. A workflow whose nodes need one will fail
            on that node, with a message saying so.
          </p>
          <ul className="mt-3 space-y-2">
            {vault.missing.map((missing) => (
              <li key={missing.kind} className="flex flex-wrap items-center gap-2">
                <span className="text-ui font-semibold">{missing.title}</span>
                <code className="text-faint font-mono text-2xs">{missing.kind}</code>
                {/* Every kind has a `connectHref`, so no row here is a dead end. Two of the
                    three had none until a browser walk opened an empty workspace. */}
                <a href={missing.connectHref} className="link ml-auto text-xs">
                  Connect it
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------------------------------------------------------- *
       * The log. Last, because it is the detail behind everything above.
       * ---------------------------------------------------------------- */}
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Recent activity</h2>
          <span className="text-faint text-2xs">Kept for {vault.retentionDays} days</span>
        </div>
        <p className="text-muted mt-2 text-sm text-pretty">
          Every time one of these secrets was stored, replaced, used or deleted — and which
          run and node used it. <strong className="font-semibold">Never what it contains.</strong>
        </p>

        {vault.events.length === 0 ? (
          <p className="text-faint mt-4 text-sm">
            Nothing yet. A run that reaches an integration node will appear here.
          </p>
        ) : (
          // `divide-line-soft` is the token the design system already has for exactly this —
          // "the only hairline in the system, for a divider inside an already-outlined object"
          // (globals.css). The first version wrote `divide-[--color-line]/40`: `divide-y`
          // applied, the `/40` silently did not, and the result was a full-strength ink rule
          // between every row of a quiet log. Invisible to every test in this repo and obvious
          // in a browser — the trap DESIGN.md records as "a class being in the DOM is not
          // evidence that it applies".
          <ul className="bg-sunken border-line divide-line-soft mt-4 max-h-80 divide-y overflow-y-auto rounded-lg border-2">
            {vault.events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2"
              >
                <span className="text-ui font-semibold">{event.label}</span>
                <code className="text-muted font-mono text-2xs">{event.kind}</code>
                {event.nodeType && (
                  <code className="text-faint font-mono text-2xs">{event.nodeType}</code>
                )}
                {event.detail && !event.nodeType && (
                  <code className="text-faint font-mono text-2xs">{event.detail}</code>
                )}
                {event.orphaned && (
                  <Badge className="text-2xs">deleted since</Badge>
                )}
                <span className="text-faint ml-auto text-2xs whitespace-nowrap">
                  {formatUtc(event.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One credential
 * ------------------------------------------------------------------ */

function CredentialCard({
  entry,
  canAdminister,
  open,
  onToggle,
  secret,
  onSecret,
  onRotate,
  busy,
  disabled,
}: {
  entry: VaultEntry;
  canAdminister: boolean;
  open: boolean;
  onToggle: () => void;
  secret: string;
  onSecret: (value: string) => void;
  onRotate: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const inputId = `rotate-${entry.kind.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">{entry.title}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.legacy ? (
            <Badge tone="pop" fill="bg-warn-pop">
              old scheme
            </Badge>
          ) : (
            <Badge className="font-mono">{entry.keyVersion}</Badge>
          )}
          <code className="text-faint font-mono text-2xs">{entry.kind}</code>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure label="Stored" value={formatUtc(entry.createdAt)} />
        <Figure
          label="Secret last replaced"
          value={entry.rotatedAt ? formatUtc(entry.rotatedAt) : "Never"}
          tone={entry.rotatedAt ? undefined : "warn"}
          hint={
            entry.rotationCount > 0
              ? `${entry.rotationCount} time${entry.rotationCount === 1 ? "" : "s"}`
              : undefined
          }
        />
        <Figure
          label="Last used"
          value={entry.lastUsedAt ? formatUtc(entry.lastUsedAt) : "Not recently"}
          hint={
            entry.usesInWindow > 0
              ? `${entry.usesInWindow} time${entry.usesInWindow === 1 ? "" : "s"}`
              : undefined
          }
        />
      </dl>

      {describeMetadata(entry).length > 0 && (
        <p className="text-muted mt-3 text-sm">{describeMetadata(entry).join(" · ")}</p>
      )}

      {/* The whole point of the mode split: a control that can work, or a link. */}
      {entry.mode === "reconnect" ? (
        <div className="mt-4">
          <p className="text-muted text-sm text-pretty">{entry.help}</p>
          {entry.reconnectHref && (
            <a href={entry.reconnectHref} className="btn btn-quiet mt-3 inline-flex text-sm">
              Reconnect to rotate
            </a>
          )}
        </div>
      ) : !canAdminister ? (
        <p className="text-muted mt-4 text-sm text-pretty">
          Replacing this secret needs the admin role in this workspace.
        </p>
      ) : !open ? (
        <Button tone="quiet" size="sm" onClick={onToggle} disabled={disabled} className="mt-4">
          Rotate this secret
        </Button>
      ) : (
        <div className="animate-rise mt-4">
          <p className="text-muted text-sm text-pretty">{entry.help}</p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onRotate();
            }}
          >
            <Labelled
              label={entry.secretLabel ?? "New secret"}
              hint="The old one is discarded and cannot be recovered."
              className="min-w-56 flex-1"
            >
              <Input
                id={inputId}
                type="password"
                value={secret}
                onChange={(event) => onSecret(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono placeholder:font-sans"
                placeholder="Paste the replacement"
              />
            </Labelled>
            <Button
              type="submit"
              tone="primary"
              loading={busy}
              disabled={disabled || secret.trim().length === 0}
            >
              {busy ? "Verifying…" : "Replace"}
            </Button>
            <Button tone="ghost" size="sm" onClick={onToggle} disabled={disabled}>
              Cancel
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}

/** The non-secret half, in words. Nothing here is derived from a stored value. */
function describeMetadata(entry: VaultEntry): string[] {
  const parts: string[] = [];
  if (entry.metadata.model) parts.push(`Model ${entry.metadata.model}`);
  if (entry.metadata.webhookName) parts.push(`Posting as “${entry.metadata.webhookName}”`);
  if (entry.metadata.email) parts.push(entry.metadata.email);
  if (entry.metadata.scopes?.length) parts.push(`${entry.metadata.scopes.length} scopes granted`);
  return parts;
}

function Figure({
  label,
  value,
  hint,
  tone,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn";
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="eyebrow text-faint">{label}</dt>
      <dd
        className={[
          "mt-0.5 text-sm font-semibold",
          mono ? "font-mono" : "",
          tone === "warn" ? "text-warn" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
        {hint && <span className="text-faint ml-1.5 text-2xs font-normal">{hint}</span>}
      </dd>
    </div>
  );
}
