"use client";

import { useState } from "react";

import { api, ApiRequestError, type ModelInfo, type ProviderSettings } from "@/lib/canvas/client";

/**
 * The provider settings form.
 *
 * The key travels one way. It is typed here, PUT once, and never comes back: no method
 * on `/api/settings/provider` returns it, or any part of it, so this component has no
 * way to display a stored key and does not pretend to. "Saved and verified" plus the
 * date is the whole truth it has.
 *
 * The model list is fetched from the provider using the stored key, so it is the set of
 * models that key can actually call — not a list compiled when this was written. Model
 * names get retired; `gemini-2.5-flash` already has.
 */

/**
 * Formatted in UTC with a fixed locale, deliberately.
 *
 * This is a client component, which means React renders it on the server for the
 * initial HTML and again in the browser to hydrate. `toLocaleString()` answers with
 * the machine's own locale and timezone, so the two renders disagreed and React threw
 * hydration error #418 — caught by reading the console on the deployed page, not by
 * anything a test asserted.
 */
const STORED_AT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function storedAt(iso: string): string {
  return `${STORED_AT.format(new Date(iso))} UTC`;
}

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

  const saveKey = async () => {
    if (apiKey.trim().length === 0) return;
    setBusy("saving");
    setError(null);
    setNotice(null);
    try {
      setSettings(await api.saveProviderSettings({ apiKey: apiKey.trim() }));
      // Cleared immediately: there is no reason for a key to sit in a DOM input after
      // it has been stored.
      setApiKey("");
      setNotice("Key verified against the provider and stored, encrypted.");
      await loadModels();
    } catch (caught) {
      report(caught, "Could not save the key.");
    } finally {
      setBusy(null);
    }
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
    <div className="animate-rise space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Google Gemini</h2>
          <StatusBadge settings={settings} />
        </div>

        <p className="text-muted mt-2 text-ui">
          Your key is encrypted with AES-256-GCM before it is stored and is never sent back
          to this page — not even partially. Get one from{" "}
          <a
            className="text-accent hover:underline hover:underline-offset-4"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Google AI Studio
          </a>
          .
        </p>

        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={settings.configured ? "Replace the stored key…" : "Paste your API key"}
            autoComplete="off"
            spellCheck={false}
            aria-label="Gemini API key"
            className="field min-w-0 flex-1 font-mono placeholder:font-sans"
          />
          <button
            type="submit"
            disabled={busy !== null || apiKey.trim().length === 0}
            className="btn btn-primary"
          >
            {busy === "saving" ? "Verifying…" : "Save key"}
          </button>
        </form>

        <p className="text-muted mt-2 text-xs">
          The key is checked against the provider before it is stored, so a wrong one fails
          here rather than halfway through a run.
        </p>

        {settings.configured && (
          <button
            type="button"
            onClick={removeKey}
            disabled={busy !== null}
            className="btn btn-ghost hover:text-bad mt-3 -ml-3 text-xs"
          >
            {busy === "removing" ? "Deleting…" : "Delete stored key"}
          </button>
        )}
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Model</h2>
          <code className="text-accent text-xs">{settings.model}</code>
        </div>
        <p className="text-muted mt-2 text-ui">
          Used by every LLM and agent node that does not name its own. The list comes from
          the provider, live — a model this key cannot call will not appear.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadModels}
            disabled={busy !== null || settings.source === "none"}
            className="btn btn-quiet"
          >
            {busy === "loading" ? "Asking the provider…" : "List available models"}
          </button>
          {models.length > 0 && (
            <span className="text-muted text-xs">
              {models.length} model{models.length === 1 ? "" : "s"} available
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
                    className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-100 ${
                      selected
                        ? "bg-accent/15 text-accent ring-accent/30 ring-1"
                        : "bg-canvas hover:bg-elevated"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {model.id}
                    </span>
                    <span className="text-muted shrink-0 text-xs">{model.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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

function StatusBadge({ settings }: { settings: ProviderSettings }) {
  if (settings.source === "user") {
    return (
      <span className="text-xs text-ok">
        Your key, stored{settings.updatedAt ? ` ${storedAt(settings.updatedAt)}` : ""}
      </span>
    );
  }
  if (settings.source === "environment") {
    // Worth saying out loud: a run that silently uses the server's development key
    // would make the whole feature look like it works when nobody has tested it.
    return <span className="text-xs text-warn">Using the server&rsquo;s fallback key</span>;
  }
  return <span className="text-muted text-xs">No key yet</span>;
}
