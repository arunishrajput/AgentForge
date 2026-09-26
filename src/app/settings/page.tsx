import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppHeader } from "@/components/shell/app-header";
import { AccountPanel } from "@/components/settings/account-panel";
import { IntegrationsForm } from "@/components/settings/integrations-form";
import { ProviderForm } from "@/components/settings/provider-form";
import { Tabs } from "@/components/ui/tabs";
import { readSettings } from "@/lib/ai/settings";
import { discordStatus, googleStatus } from "@/lib/integrations/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

/**
 * Provider, integration and account configuration. Read on the server and
 * owner-scoped, like every other page. None of the three projections carries key
 * material — no API key, no webhook URL, no refresh token — so nothing sensitive is
 * serialised into the HTML that reaches the browser.
 *
 * Three tabs rather than one long scroll, because the page now has three unrelated
 * subjects and a user arrives wanting exactly one of them. The panels are server
 * components handed to a client `Tabs` as props, so the tab strip's keyboard
 * behaviour is client-side while the content stays on the server.
 *
 * Returning from Google's consent screen opens the integrations tab, since that is
 * where the answer to what just happened is.
 *
 * `searchParams` is awaited: request APIs are async in Next 16
 * (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const ownerId = session.user.id;
  const [settings, discord, google, params] = await Promise.all([
    readSettings(ownerId),
    discordStatus(ownerId),
    googleStatus(ownerId),
    searchParams,
  ]);

  const email = session.user.email ?? "";

  return (
    <>
      <AppHeader email={email} active="settings" />

      <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-rise mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted mt-1 text-sm text-pretty">
            The model your LLM and agent nodes run on, the services your integration nodes
            reach, and what this account holds.
          </p>
        </div>

        <Tabs
          initial={params.google ? 1 : 0}
          tabs={[
            { id: "provider", label: "Model provider", content: <ProviderForm initial={settings} /> },
            {
              id: "integrations",
              label: "Integrations",
              content: (
                <IntegrationsForm
                  discord={discord}
                  google={google}
                  {...(params.google ? { callbackStatus: params.google } : {})}
                />
              ),
            },
            {
              id: "account",
              label: "Account",
              content: <AccountPanel name={session.user.name} email={email} />,
            },
          ]}
        />
      </main>
    </>
  );
}
