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
 *
 * Dates are rendered here, in a *server* component, with `toLocaleString()` left as
 * it was: this page never hydrates a date, so the locale mismatch that produced
 * hydration error #418 in the settings forms cannot happen on it.
 */
export default async function WorkflowsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const workflows = (await listWorkflows(session.user.id)).map(describeWorkflow);

  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-muted mt-0.5 truncate text-sm">{session.user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings" className="btn btn-quiet">
            Settings
          </Link>
          <NewWorkflowButton />
        </div>
      </header>

      <GenerateWorkflowForm />

      {workflows.length === 0 ? (
        <div className="card animate-rise px-6 py-10 text-center">
          <p className="text-sm font-medium">No workflows yet</p>
          <p className="text-muted mx-auto mt-1.5 max-w-xs text-xs text-pretty">
            Describe one in the box above and AgentForge will build it, or start from
            an empty canvas and wire it by hand.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {workflows.map((workflow, index) => (
            <li
              key={workflow.id}
              style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
              className="card animate-rise hover:border-line-strong flex items-center gap-3 px-4 py-3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/workflows/${workflow.id}`}
                  className="block truncate text-sm font-medium hover:underline hover:underline-offset-4"
                >
                  {workflow.name}
                </Link>
                <p className="text-muted mt-0.5 text-2xs">
                  {workflow.graph.nodes.length} node
                  {workflow.graph.nodes.length === 1 ? "" : "s"} ·{" "}
                  {workflow.runnable ? (
                    <span className="text-ok">runnable</span>
                  ) : (
                    <span className="text-warn">
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
        <button type="submit" className="btn btn-ghost -ml-3 text-xs">
          Sign out
        </button>
      </form>
    </main>
  );
}
