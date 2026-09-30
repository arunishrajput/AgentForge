import type { Metadata } from "next";

import { AppHeader } from "@/components/shell/app-header";
import { NewWorkflowButton } from "@/components/workflows/actions";
import { GenerateWorkflowForm } from "@/components/workflows/generate-form";
import { WorkflowList } from "@/components/workflows/workflow-list";
import { getNode } from "@/lib/nodes";
import { toWorkflowCard } from "@/lib/workflow/list";
import { describeWorkflow, listWorkflows } from "@/lib/workflow/store";
import { requirePageSession } from "@/lib/workspace/page";
import { atLeast } from "@/lib/workspace/roles";
import { describeWorkspace } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Workflows" };

/**
 * The workflow list — read on the server and owner-scoped by `listWorkflows`, the
 * same query the API uses. There is no code path that reads a workflow by id alone
 * (ARCHITECTURE.md → "API surface").
 *
 * The page's job is to turn rows into cards and hand them over. The node labels on
 * a card come from the registry, which is resolved **here**, on the server: the list
 * component needs those labels to search on, and importing `@/lib/nodes` from a
 * client component would drag every integration client into the page bundle to
 * render the words "Post to Discord".
 *
 * Dates cross the boundary as ISO strings and are formatted by `@/lib/format/date`,
 * which pins the locale and the zone — a client component that formats a date with
 * the machine's defaults renders differently on the server and in the browser, which
 * is hydration error #418.
 */
export default async function WorkflowsPage() {
  const { email, scope, membership, memberships } = await requirePageSession();
  const workspace = describeWorkspace(membership, scope.userId);
  /**
   * **Phase 20.** Resolved here, on the server, from the membership row — and it decides
   * what this page draws and nothing else. Every control it withholds is separately refused
   * by the API, which is where authorisation happens.
   */
  const canEdit = atLeast(scope.role, "editor");
  const workflows = (await listWorkflows(scope)).map(describeWorkflow);
  const cards = workflows.map((workflow) =>
    toWorkflowCard(workflow, (type) => {
      const node = getNode(type);
      return node ? { label: node.label, category: node.category } : undefined;
    }),
  );

  return (
    <>
      <AppHeader
        email={email}
        workspace={workspace}
        workspaces={memberships.map((m) => describeWorkspace(m, scope.userId))}
        active="workflows"
      />

      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-rise mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
            <p className="text-muted mt-1 text-sm">
              {cards.length === 0
                ? "Describe one below, and it is built, validated and saved before you see it."
                : `${cards.length} workflow${cards.length === 1 ? "" : "s"} in ${workspace.own ? "your workspace" : workspace.name}.`}
            </p>
          </div>
          {canEdit && <NewWorkflowButton />}
        </div>

        {/* Generating is a write — it creates and saves a workflow — so a viewer does not
            get the prompt box. Leaving it there and letting the 403 explain is what Phase
            19B shipped, deliberately, and this is the phase that finishes it. */}
        {canEdit ? (
          <GenerateWorkflowForm />
        ) : (
          <p className="text-muted border-line bg-lift animate-rise mb-4 rounded-xl border-2 p-4 text-sm text-pretty">
            You have the <strong className="font-semibold">{scope.role}</strong> role in{" "}
            {workspace.own ? "this workspace" : workspace.name}, so you can read every
            workflow here and its run history, and you cannot change or run one. An admin can
            give you the editor role from Settings.
          </p>
        )}

        <WorkflowList cards={cards} canEdit={canEdit} />
      </main>
    </>
  );
}
