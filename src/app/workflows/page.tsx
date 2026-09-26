import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { DeleteWorkflowButton, NewWorkflowButton } from "@/components/workflows/actions";
import { GenerateWorkflowForm } from "@/components/workflows/generate-form";
import { describeWorkflow, listWorkflows } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

/**
 * The workflow list. Read on the server and owner-scoped by `listWorkflows`, the
 * same query the API uses — there is no code path that reads a workflow by id
 * alone (ARCHITECTURE.md → "API surface").
 */
export default async function WorkflowsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const workflows = (await listWorkflows(session.user.id)).map(describeWorkflow);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-muted mt-0.5 text-sm">{session.user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="bg-surface rounded-lg px-3 py-2 text-[13px] transition-opacity hover:opacity-80"
          >
            Settings
          </Link>
          <NewWorkflowButton />
        </div>
      </header>

      <GenerateWorkflowForm />

      {workflows.length === 0 ? (
        <div className="bg-surface rounded-xl p-8 text-center">
          <p className="text-sm font-medium">No workflows yet.</p>
          <p className="text-muted mt-1 text-[13px]">
            Describe one above, or create an empty workflow to build it by hand.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {workflows.map((workflow) => (
            <li
              key={workflow.id}
              className="bg-surface flex items-center gap-4 rounded-xl px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/workflows/${workflow.id}`}
                  className="block truncate text-sm font-medium hover:underline hover:underline-offset-4"
                >
                  {workflow.name}
                </Link>
                <p className="text-muted mt-0.5 text-[12px]">
                  {workflow.graph.nodes.length} node
                  {workflow.graph.nodes.length === 1 ? "" : "s"} ·{" "}
                  {workflow.runnable ? (
                    <span className="text-emerald-300">runnable</span>
                  ) : (
                    <span className="text-amber-300">
                      {workflow.problems.length} problem
                      {workflow.problems.length === 1 ? "" : "s"}
                    </span>
                  )}{" "}
                  · updated {new Date(workflow.updatedAt).toLocaleString()}
                </p>
              </div>
              <DeleteWorkflowButton id={workflow.id} name={workflow.name} />
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-10"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit" className="text-muted hover:text-ink text-[12px] transition-colors">
          Sign out
        </button>
      </form>
    </main>
  );
}
