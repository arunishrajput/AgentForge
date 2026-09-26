import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { readSettings } from "@/lib/ai/settings";
import { ProviderForm } from "@/components/settings/provider-form";

export const dynamic = "force-dynamic";

/**
 * Provider configuration. Read on the server and owner-scoped, like every other page.
 * `readSettings` returns no key material, so nothing sensitive is serialised into the
 * HTML that reaches the browser.
 */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const settings = await readSettings(session.user.id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <Link
          href="/workflows"
          className="text-muted hover:text-ink text-[12px] transition-colors"
        >
          ← Workflows
        </Link>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted mt-0.5 text-sm">
          The model your LLM and agent nodes run on.
        </p>
      </header>

      <ProviderForm initial={settings} />
    </main>
  );
}
