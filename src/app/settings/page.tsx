import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { readSettings } from "@/lib/ai/settings";
import { discordStatus, googleStatus } from "@/lib/integrations/store";
import { IntegrationsForm } from "@/components/settings/integrations-form";
import { ProviderForm } from "@/components/settings/provider-form";

export const dynamic = "force-dynamic";

/**
 * Provider and integration configuration. Read on the server and owner-scoped, like
 * every other page. None of the three projections carries key material — no API key,
 * no webhook URL, no refresh token — so nothing sensitive is serialised into the HTML
 * that reaches the browser.
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

  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-8 sm:px-6 sm:py-10">
      <header className="animate-rise mb-8">
        <Link href="/workflows" className="btn btn-ghost -ml-3 text-xs">
          <span aria-hidden="true">←</span> Workflows
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted mt-0.5 text-sm">
          The model your LLM and agent nodes run on, and the services your integration
          nodes reach.
        </p>
      </header>

      <div className="space-y-10">
        <ProviderForm initial={settings} />

        <section className="animate-rise" style={{ animationDelay: "90ms" }}>
          <h2 className="mb-4 text-sm font-semibold tracking-tight">Integrations</h2>
          <IntegrationsForm
            discord={discord}
            google={google}
            {...(params.google ? { callbackStatus: params.google } : {})}
          />
        </section>
      </div>
    </main>
  );
}
