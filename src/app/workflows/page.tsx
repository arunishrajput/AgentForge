import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppHeader } from "@/components/shell/app-header";
import { NewWorkflowButton } from "@/components/workflows/actions";
import { GenerateWorkflowForm } from "@/components/workflows/generate-form";
import { WorkflowList } from "@/components/workflows/workflow-list";
import { getNode } from "@/lib/nodes";
import { toWorkflowCard } from "@/lib/workflow/list";
import { describeWorkflow, listWorkflows } from "@/lib/workflow/store";

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
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const workflows = (await listWorkflows(session.user.id)).map(describeWorkflow);
  const cards = workflows.map((workflow) =>
    toWorkflowCard(workflow, (type) => {
      const node = getNode(type);
      return node ? { label: node.label, category: node.category } : undefined;
    }),
  );

  return (
    <>
      <AppHeader email={session.user.email ?? ""} active="workflows" />

      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-rise mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
            <p className="text-muted mt-1 text-sm">
              {cards.length === 0
                ? "Describe one below, and it is built, validated and saved before you see it."
                : `${cards.length} workflow${cards.length === 1 ? "" : "s"} in your account.`}
            </p>
          </div>
          <NewWorkflowButton />
        </div>

        <GenerateWorkflowForm />

        <WorkflowList cards={cards} />
      </main>
    </>
  );
}
