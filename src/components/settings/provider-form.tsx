"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Input, Labelled } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatUtc } from "@/lib/format/date";
import { api, ApiRequestError, type ModelInfo, type ProviderSettings } from "@/lib/canvas/client";

/**
 * The provider settings form.
 *
 * The key travels one way. It is typed here, PUT once, and never comes back: no
 * method on `/api/settings/provider` returns it, or any part of it, so this
 * component has no way to display a stored key and does not pretend to. "Saved and
 * verified" plus the date is the whole truth it has.
 *
 * The model list is fetched from the provider using the stored key, so it is the set
 * of models that key can actually call — not a list compiled when this was written.
 * Model names get retired; `gemini-2.5-flash` already has.
 *
 * Dates go through `@/lib/format/date`, which pins the locale and the zone. This is
 * a client component, so React renders it on the server for the initial HTML and
 * again in the browser to hydrate, and `toLocaleString()` disagreed across the two —
 * hydration error #418, found by reading the console on the deployed page.
 */
export function ProviderForm({ initial }: { initial: ProviderSettings }) {
  const [settings, setSettings] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState<null | "saving" | "loading" | "removing">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = (caught: unknown, fallback: string) => {
    setError(caught instanceof ApiRequestError ? caught.message : fallback);
    setNotice(null);
  };

  const loadModels = async () => {
    setBusy("loading");
    try {
      const result = await api.listProviderModels();
      setModels(result.models);
    } catch (caught) {
      report(caught, "Could not list models.");
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async () => {
    if (apiKey.trim().length === 0) return;
    setBusy("saving");
    setError(null);
    setNotice(null);
    try {
      setSettings(await api.saveProviderSettings({ apiKey: apiKey.trim() }));
      // Cleared immediately: there is no reason for a key to sit in a DOM input
      // after it has been stored.
      setApiKey("");
      setNotice("Key verified against the provider and stored, encrypted.");
      await loadModels();
    } catch (caught) {
      report(caught, "Could not save the key.");
    } finally {
      setBusy(null);
    }
  };

  const chooseModel = async (model: string) => {
    setBusy("saving");
    setError(null);
    try {
      setSettings(await api.saveProviderSettings({ model }));
      setNotice(`Workflows will use ${model}.`);
    } catch (caught) {
      report(caught, "Could not change the model.");
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async () => {
    setBusy("removing");
    setError(null);
    try {
      setSettings(await api.deleteProviderSettings());
      setModels([]);
      setNotice("Key deleted.");
    } catch (caught) {
      report(caught, "Could not delete the key.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Google Gemini</h2>
          <KeyStatus settings={settings} />
        </div>

        <p className="text-muted mt-2 text-sm text-pretty">
          Your key is encrypted with AES-256-GCM before it is stored and is never sent back
          to this page — not even partially. Get one from{" "}
          <a
            className="text-accent font-semibold hover:underline hover:underline-offset-4"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Google AI Studio
          </a>
          .
        </p>

        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <Labelled
            label="API key"
            hint="Checked against the provider before it is stored, so a wrong one fails here rather than halfway through a run."
            className="min-w-56 flex-1"
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.configured ? "Replace the stored key…" : "Paste your API key"}
              autoComplete="off"
              spellCheck={false}
              className="font-mono placeholder:font-sans"
            />
          </Labelled>
          <Button
            type="submit"
            tone="primary"
            loading={busy === "saving"}
            disabled={busy !== null || apiKey.trim().length === 0}
          >
            {busy === "saving" ? "Verifying…" : "Save key"}
          </Button>
        </form>

        {settings.configured && (
          <Button
            tone="ghost"
            size="sm"
            onClick={removeKey}
            disabled={busy !== null}
            className="hover:text-bad mt-3 -ml-2.5"
          >
            {busy === "removing" ? "Deleting…" : "Delete stored key"}
          </Button>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Model</h2>
          <Badge tone="pop" className="bg-accent-pop font-mono">
            {settings.model}
          </Badge>
        </div>
        <p className="text-muted mt-2 text-sm text-pretty">
          Used by every LLM and agent node that does not name its own. The list comes from
          the provider, live — a model this key cannot call will not appear.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            onClick={loadModels}
            loading={busy === "loading"}
            disabled={busy !== null || settings.source === "none"}
          >
            {busy === "loading" ? "Asking the provider…" : "List available models"}
          </Button>
          {models.length > 0 && (
            <span className="text-muted text-2xs">
              {models.length} model{models.length === 1 ? "" : "s"} this key can call
            </span>
          )}
        </div>

        {models.length > 0 && (
          <ul className="animate-fade mt-4 space-y-1.5">
            {models.map((model) => {
              const selected = model.id === settings.model;
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    onClick={() => chooseModel(model.id)}
                    disabled={busy !== null || selected}
                    aria-current={selected}
                    className={cn(
                      "border-line flex w-full items-baseline justify-between gap-3 rounded-lg border-2 px-3 py-2 text-left",
                      "transition-colors duration-(--dur-fast)",
                      selected
                        ? "bg-accent-pop text-ink cursor-default font-semibold"
                        : "bg-canvas hover:bg-elevated",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs">{model.id}</span>
                    <span className={cn("shrink-0 text-2xs", selected ? "text-ink" : "text-muted")}>
                      {selected ? "in use" : model.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {error && <Notice tone="bad" title={error} />}
      {notice && !error && <Notice tone="ok" title={notice} />}
    </div>
  );
}

function KeyStatus({ settings }: { settings: ProviderSettings }) {
  if (settings.source === "user") {
    return (
      <Badge className="text-ok">
        <span aria-hidden="true">✓</span> Your key
        {settings.updatedAt ? `, stored ${formatUtc(settings.updatedAt)}` : ""}
      </Badge>
    );
  }
  if (settings.source === "environment") {
    // Worth saying out loud: a run that silently used the server's development key
    // would make the whole feature look tested when nobody has tested it.
    return (
      <Badge className="text-warn">
        <span aria-hidden="true">▲</span> Using the server&rsquo;s fallback key
      </Badge>
    );
  }
  return <Badge className="text-muted">No key yet</Badge>;
}
