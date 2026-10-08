import type { Metadata } from "next";

import { AppHeader } from "@/components/shell/app-header";
import { AccountPanel } from "@/components/settings/account-panel";
import { IntegrationsForm } from "@/components/settings/integrations-form";
import { ProviderForm } from "@/components/settings/provider-form";
import { VaultPanel } from "@/components/settings/vault-panel";
import { WorkspacePanel } from "@/components/settings/workspace-panel";
import { Tabs } from "@/components/ui/tabs";
import { readSettings } from "@/lib/ai/settings";
import { readVault } from "@/lib/credentials/vault";
import { readRetention } from "@/lib/runs/retention";
import {
  discordStatus,
  googleStatus,
  tokenIntegrationStatuses,
} from "@/lib/integrations/store";
import { requirePageSession } from "@/lib/workspace/page";
import { atLeast } from "@/lib/workspace/roles";
import { describeMember, describeWorkspace, listInvitations, listMembers } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

/** Kept beside the `tabs` array below; a tab inserted in the middle must appear in both. */
const TAB_INDEX: Record<string, number> = {
  provider: 0,
  integrations: 1,
  vault: 2,
  workspace: 3,
  account: 4,
};

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
 * where the answer to what just happened is. `?tab=<id>` opens that tab by name —
 * `workspace` is where the header's switcher sends somebody who wants to make another one,
 * and `vault` is where a rotation link lands.
 *
 * **The tab index is a table, not an expression.** Phase 21 inserted a fourth tab, and the
 * previous `params.tab === "workspace" ? 2 : …` would have silently pointed at it — the kind
 * of off-by-one that nothing fails and a user finds.
 *
 * **The invitations list is only read for somebody who may see it.** The route refuses a
 * non-admin regardless; not asking here as well would mean the page fetched rows it then
 * had to throw away, on a metered database.
 *
 * `searchParams` is awaited: request APIs are async in Next 16
 * (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; tab?: string }>;
}) {
  const { name, email, scope, membership, memberships } = await requirePageSession();
  const canAdminister = atLeast(scope.role, "admin");
  const workspace = describeWorkspace(membership, scope.userId);
  const [settings, discord, google, tokens, members, invitations, vault, retention, params] =
    await Promise.all([
      readSettings(scope),
      discordStatus(scope),
      googleStatus(scope),
      // Phase 23B's four, in one query rather than four: `tokenIntegrationStatuses` reads the
      // workspace's credential rows once and matches them against the registry.
      tokenIntegrationStatuses(scope),
      listMembers(scope),
      canAdminister ? listInvitations(scope) : Promise.resolve([]),
      // Read for every role, because credential *status* has been a viewer action since Phase
      // 19B and a viewer who cannot see whether a credential exists cannot understand a failed
      // run. What a viewer may not do is change one, which the panel and the routes both say.
      readVault(scope),
      // Phase 33: how much run history the workspace holds — one count on `run_workspace_idx`.
      readRetention(scope),
      searchParams,
    ]);

  return (
    <>
      <AppHeader
        email={email}
        workspace={workspace}
        workspaces={memberships.map((m) => describeWorkspace(m, scope.userId))}
        active="settings"
      />

      <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-rise mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted mt-1 text-sm text-pretty">
            The model your LLM and agent nodes run on, the services your integration nodes
            reach, and what this account holds. Everything on this page belongs to{" "}
            <strong className="font-semibold">{membership.workspace.name}</strong> and is
            shared with everyone in it.
          </p>
        </div>

        <Tabs
          initial={TAB_INDEX[params.tab ?? ""] ?? (params.google ? 1 : 0)}
          tabs={[
            { id: "provider", label: "Model provider", content: <ProviderForm initial={settings} /> },
            {
              id: "integrations",
              label: "Integrations",
              content: (
                <IntegrationsForm
                  discord={discord}
                  google={google}
                  tokens={tokens}
                  {...(params.google ? { callbackStatus: params.google } : {})}
                />
              ),
            },
            {
              id: "vault",
              label: "Vault",
              content: (
                <VaultPanel
                  initial={vault}
                  canAdminister={canAdminister}
                  canRekey={scope.role === "owner"}
                />
              ),
            },
            {
              id: "workspace",
              label: "Workspace",
              content: (
                <WorkspacePanel
                  workspace={workspace}
                  members={members.map((member) => describeMember(member, scope.userId))}
                  invitations={invitations}
                  canAdminister={canAdminister}
                  viewerUserId={scope.userId}
                  retention={retention}
                />
              ),
            },
            {
              id: "account",
              label: "Account",
              content: <AccountPanel name={name} email={email} />,
            },
          ]}
        />
      </main>
    </>
  );
}
