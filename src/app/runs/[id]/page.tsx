import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RunDetail } from "@/components/runs/run-detail";
import { AppHeader } from "@/components/shell/app-header";
import { WrongWorkspace } from "@/components/workflows/wrong-workspace";
import { ApiError } from "@/lib/api";
import { describeNodes } from "@/lib/nodes";
import { getCallLinks, getRunDetail } from "@/lib/runs/history";
import { shortRunId } from "@/lib/runs/words";
import { versionGraph } from "@/lib/workflow/versions";
import { requirePageSession } from "@/lib/workspace/page";
import { atLeast } from "@/lib/workspace/roles";
import { describeWorkspace, findMembershipForRun } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

/**
 * The tab says which workflow and which run, so two run pages open side by side are told apart.
 * A failed load falls back to a plain title, as the canvas's does: the page's own `notFound()` is
 * the place a missing run surfaces.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { scope } = await requirePageSession();
    const { id } = await params;
    const { workflow } = await getRunDetail(scope, id);
    return { title: `Run ${shortRunId(id)} · ${workflow.name}` };
  } catch {
    return { title: "Run" };
  }
}

/**
 * **A run, whole — Phase 33.** `BUILD_PLAN.md` task 3: the graph at the version the run executed
 * (D86) with its statuses, every step with its logs and, opened, its input, config and output; a
 * run still going followed live. Analytics links its failures here, and re-run and retry land here.
 *
 * Read on the server, through the same visibility join as the API (D101): a private workflow's run
 * is a 404 to everybody it is hidden from — or, for a member of the workspace it lives in who is
 * looking at another one, the offer to switch (`WrongWorkspace`), exactly as a workflow link does.
 *
 * Step **headers** come with the page; their bodies are loaded when a step is opened.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { email, scope, membership, memberships } = await requirePageSession();
  const workspace = describeWorkspace(membership, scope.userId);
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof getRunDetail>> | null = null;
  try {
    detail = await getRunDetail(scope, id);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "not_found") throw error;
  }

  const header = (
    <AppHeader
      email={email}
      workspace={workspace}
      workspaces={memberships.map((m) => describeWorkspace(m, scope.userId))}
      scope={scope}
      active="runs"
    />
  );

  if (!detail) {
    const elsewhere = /^[A-Za-z0-9-]{1,64}$/.test(id) ? await findMembershipForRun(scope.userId, id) : null;
    if (!elsewhere || elsewhere.workspace.id === scope.workspaceId) notFound();
    return (
      <>
        {header}
        <WrongWorkspace
          kind="run"
          workflowId={id}
          workspace={{ id: elsewhere.workspace.id, name: elsewhere.workspace.name }}
        />
      </>
    );
  }

  // The graph this run executed (D86); the current one when that version is no longer kept.
  const [snapshot, calls] = await Promise.all([
    versionGraph(detail.workflow.id, detail.run.workflowVersion),
    // Phase 39: the run that called this one, and the runs it called.
    getCallLinks(scope, detail.run),
  ]);
  const { graph: current, ...workflow } = detail.workflow;

  return (
    <>
      {header}
      <RunDetail
        initial={{ run: detail.run, steps: detail.steps }}
        workflow={workflow}
        graph={snapshot ?? current}
        graphSource={snapshot ? "version" : "current"}
        registry={describeNodes()}
        calls={calls}
        // Decides what the page draws; the API refuses every action it hides (Phase 20).
        canEdit={atLeast(scope.role, "editor")}
      />
    </>
  );
}
