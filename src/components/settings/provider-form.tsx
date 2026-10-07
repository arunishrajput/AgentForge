"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Input, Labelled } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatUtc } from "@/lib/format/date";
import {
  api,
  ApiRequestError,
  type ModelInfo,
  type ProviderSettings,
  type ProviderState,
} from "@/lib/canvas/client";

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
 *
 * ## Two providers — Phase 23D
 *
 * **Every provider's card is on the page at once, and switching is an explicit button.**
 * The tempting shape was tabs, and it is the wrong one: a tab selects *what you are looking
 * at*, and this page also has to express *what is in use*. One control for two meanings
 * means clicking "Groq" to read about it silently moves every workflow in the workspace onto
 * it. So: both cards visible, the active one says **In use**, and the other offers *Use
 * Groq* — which is a different control from *Save key*, because they are different
 * decisions.
 *
 * Pasting a key into a card is treated as choosing that provider, and that *is* one
 * decision rather than two — nobody types a Groq key into a card in order to keep using
 * Gemini. The request carries `provider` and `apiKey` together and the server does both.
 *
 * It stays the quiet register throughout (`DESIGN.md` → *The loud register and the quiet
 * register*): no `-pop` fill on the cards, `shadow-card`, no illustration. The one `-pop`
 * fill is the selected model chip, which was there before and is inside an outline with an
 * ink label.
 */
export function ProviderForm({ initial }: { initial: ProviderSettings }) {
  const [settings, setSettings] = useState(initial);
  // Keyed by provider id: two cards, two inputs, two independent model lists. One shared
  // `busy` is deliberate — the server serialises these anyway and two concurrent writes to
  // the same workspace would race on the provider column.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [busy, setBusy] = useState<null | { id: string; what: "saving" | "loading" | "removing" | "switching" }>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = (caught: unknown, fallback: string) => {
    setError(caught instanceof ApiRequestError ? caught.message : fallback);
    setNotice(null);
  };

  const begin = (id: string, what: "saving" | "loading" | "removing" | "switching") => {
    setBusy({ id, what });
    setError(null);
  };

  const loadModels = async (provider: ProviderState) => {
    begin(provider.id, "loading");
    try {
      const result = await api.listProviderModels(provider.id);
      setModels((current) => ({ ...current, [provider.id]: result.models }));
    } catch (caught) {
      report(caught, `Could not list ${provider.label}'s models.`);
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async (provider: ProviderState) => {
    const apiKey = (keys[provider.id] ?? "").trim();
    if (apiKey.length === 0) return;
    begin(provider.id, "saving");
    setNotice(null);
    try {
      // `provider` travels with the key: pasting a key into a card chooses that provider.
      setSettings(await api.saveProviderSettings({ provider: provider.id, apiKey }));
      // Cleared immediately: there is no reason for a key to sit in a DOM input
      // after it has been stored.
      setKeys((current) => ({ ...current, [provider.id]: "" }));
      setNotice(`${provider.label} key verified and stored, encrypted. Workflows will use it.`);
      await loadModels(provider);
    } catch (caught) {
      report(caught, "Could not save the key.");
    } finally {
      setBusy(null);
    }
  };

  const chooseModel = async (provider: ProviderState, model: string) => {
    begin(provider.id, "saving");
    try {
      setSettings(await api.saveProviderSettings({ provider: provider.id, model }));
      setNotice(`Workflows will use ${model}.`);
    } catch (caught) {
      report(caught, "Could not change the model.");
    } finally {
      setBusy(null);
    }
  };

  const useProvider = async (provider: ProviderState) => {
    begin(provider.id, "switching");
    try {
      setSettings(await api.saveProviderSettings({ provider: provider.id }));
      setNotice(`Workflows will use ${provider.label}.`);
    } catch (caught) {
      report(caught, `Could not switch to ${provider.label}.`);
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async (provider: ProviderState) => {
    begin(provider.id, "removing");
    try {
      setSettings(await api.deleteProviderSettings(provider.id));
      setModels((current) => ({ ...current, [provider.id]: [] }));
      setNotice(`${provider.label} key deleted.`);
    } catch (caught) {
      report(caught, "Could not delete the key.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {settings.providers.map((provider) => {
        const active = provider.id === settings.provider;
        const listed = models[provider.id] ?? [];
        const working = busy?.id === provider.id ? busy.what : null;
        const anyBusy = busy !== null;

        return (
          <Card key={provider.id} className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-bold">{provider.label}</h2>
              <ProviderStatus settings={settings} provider={provider} active={active} />
            </div>

            <p className="text-muted mt-2 text-sm text-pretty">
              {provider.blurb} Your key is encrypted with AES-256-GCM before it is stored and
              is never sent back to this page — not even partially. Get one from{" "}
              <a
                className="text-accent font-semibold hover:underline hover:underline-offset-4"
                href={provider.keyUrl}
                target="_blank"
                rel="noreferrer"
              >
                {provider.keyUrlLabel}
              </a>
              .
            </p>

            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveKey(provider);
              }}
            >
              <Labelled
                label="API key"
                hint="Checked against the provider before it is stored, so a wrong one fails here rather than halfway through a run."
                className="min-w-56 flex-1"
              >
                <Input
                  type="password"
                  value={keys[provider.id] ?? ""}
                  onChange={(event) =>
                    setKeys((current) => ({ ...current, [provider.id]: event.target.value }))
                  }
                  placeholder={
                    provider.configured ? "Replace the stored key…" : provider.placeholder
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono placeholder:font-sans"
                />
              </Labelled>
              <Button
                type="submit"
                tone="primary"
                loading={working === "saving"}
                disabled={anyBusy || (keys[provider.id] ?? "").trim().length === 0}
              >
                {working === "saving" ? "Verifying…" : "Save key"}
              </Button>
            </form>

            <div className="mt-3 -ml-2.5 flex flex-wrap items-center gap-1">
              {/*
                Switching is its own control, and it only appears where it means something:
                on a provider that has a key and is not already the one in use.
              */}
              {!active && provider.configured && (
                <Button
                  tone="quiet"
                  size="sm"
                  onClick={() => void useProvider(provider)}
                  loading={working === "switching"}
                  disabled={anyBusy}
                  className="ml-2.5"
                >
                  {working === "switching" ? "Switching…" : `Use ${provider.label}`}
                </Button>
              )}
              {provider.configured && (
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => void removeKey(provider)}
                  disabled={anyBusy}
                  className="hover:text-bad"
                >
                  {working === "removing" ? "Deleting…" : "Delete stored key"}
                </Button>
              )}
            </div>

            <div className="border-line-soft mt-5 border-t-2 pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold">Model</h3>
                <Badge tone="pop" className="bg-accent-pop font-mono">
                  {provider.model}
                </Badge>
              </div>
              <p className="text-muted mt-2 text-sm text-pretty">
                Used by every LLM and agent node that does not name its own, while{" "}
                {provider.label} is in use. The list comes from the provider, live — a model
                this key cannot call will not appear.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void loadModels(provider)}
                  loading={working === "loading"}
                  disabled={anyBusy || !provider.configured}
                >
                  {working === "loading" ? "Asking the provider…" : "List available models"}
                </Button>
                {listed.length > 0 && (
                  <span className="text-muted text-2xs">
                    {listed.length} model{listed.length === 1 ? "" : "s"} this key can call
                  </span>
                )}
              </div>

              {listed.length > 0 && (
                <ul className="animate-fade mt-4 space-y-1.5">
                  {listed.map((model) => {
                    const selected = model.id === provider.model;
                    return (
                      <li key={model.id}>
                        <button
                          type="button"
                          onClick={() => void chooseModel(provider, model.id)}
                          disabled={anyBusy || selected}
                          aria-current={selected}
                          className={cn(
                            "border-line flex w-full items-baseline justify-between gap-3 rounded-lg border-2 px-3 py-2 text-left",
                            "transition-colors duration-(--dur-fast)",
                            selected
                              ? "bg-accent-pop text-accent-ink cursor-default font-semibold"
                              : "bg-canvas hover:bg-elevated",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-2xs">
                            {model.id}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-2xs",
                              selected ? "text-ink" : "text-muted",
                            )}
                          >
                            {selected ? "in use" : model.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        );
      })}

      {error && <Notice tone="bad" title={error} />}
      {notice && !error && <Notice tone="ok" title={notice} />}
    </div>
  );
}

/**
 * One provider's status, in words as well as colour (`DESIGN.md` → *Never colour alone*).
 *
 * Four states, and they are genuinely four rather than a boolean dressed up: a provider can
 * hold a key without being the active one, and the active one can be running on the server's
 * fallback key rather than anybody's stored one — which is the state worth shouting about,
 * because it makes an untested feature look tested.
 */
function ProviderStatus({
  settings,
  provider,
  active,
}: {
  settings: ProviderSettings;
  provider: ProviderState;
  active: boolean;
}) {
  if (active && settings.source === "environment") {
    // Worth saying out loud: a run that silently used the server's development key
    // would make the whole feature look tested when nobody has tested it.
    return (
      <Badge className="text-warn">
        <span aria-hidden="true">▲</span> Using the server&rsquo;s fallback key
      </Badge>
    );
  }

  if (provider.configured) {
    return (
      <Badge className={active ? "text-ok" : "text-muted"}>
        <span aria-hidden="true">{active ? "✓" : "•"}</span>{" "}
        {active ? "In use" : "Key stored, not in use"}
        {provider.updatedAt ? `, stored ${formatUtc(provider.updatedAt)}` : ""}
      </Badge>
    );
  }

  return <Badge className="text-muted">No key yet</Badge>;
}
