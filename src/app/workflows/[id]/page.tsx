import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { Editor } from "@/components/canvas/editor";
import { WrongWorkspace } from "@/components/workflows/wrong-workspace";
import { ApiError } from "@/lib/api";
import { describeRun, liveRun } from "@/lib/engine/run";
import { listRunPage, type RunSummary } from "@/lib/runs/history";
import { EMPTY_RUN_QUERY } from "@/lib/runs/query";
import { RECENT_RUNS } from "@/lib/runs/recent";
import { describeNodes } from "@/lib/nodes";
import { describeWorkflow, getWorkflow } from "@/lib/workflow/store";
import { readActiveWorkspaceId } from "@/lib/workspace/active";
import { findMembershipForWorkflow, resolveScope } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

/**
 * The tab's title is the workflow's name.
 *
 * Until Phase 16 the canvas exported no `metadata` at all, so every workflow open in
 * every tab said "AgentForge" — which is exactly the case a title is for. Someone
 * building a workflow has the docs, the service they are integrating and two other
 * workflows open, and the tab is how they find their way back.
 *
 * A failed load falls back to a plain title rather than throwing: `generateMetadata`
 * runs alongside the page, and the page's own `notFound()` and error boundary are the
 * right places for that to surface. Throwing here as well would replace a useful 404
 * with whichever of the two lost the race.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await auth();
  if (!session?.user?.id) return { title: "Workflow" };

  try {
    const { id } = await params;
    const scope = await resolveScope(
      { id: session.user.id, email: session.user.email },
      await readActiveWorkspaceId(),
    );
    const workflow = await getWorkflow(scope, id);
    return { title: workflow.name };
  } catch {
    return { title: "Workflow" };
  }
}

/**
 * The canvas. The workflow and the node registry are both read on the server and
 * handed to the editor, so a hard reload renders what the database holds — which
 * is what makes the round-trip check meaningful rather than a test of a client
 * cache.
 *
 * The registry must arrive with the first render, not from a `fetch` afterwards.
 * A node's output handles come from its registry entry, so a canvas that renders
 * before the registry has loaded draws every node with a single default output —
 * React Flow then cannot resolve an edge leaving a branch's `true` handle, and on
 * a cold instance the user watches a branch node briefly appear broken.
 * `describeNodes()` is the same projection `GET /api/nodes` serves.
 *
 * A run still in flight is read here too, so a reload during execution comes back
 * showing that run and reattaches its stream rather than going blank until it ends
 * (BUILD_PLAN Phase 5: "a mid-run page reload must recover correct state").
 */
export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const { id } = await params;

  // The try guards the loads and nothing else. JSX built inside a try/catch looks
  // guarded and is not — React renders it after this function has returned, so a
  // render error would sail straight past the catch and only an error boundary would
  // see it. Keeping the return outside makes the guard mean what it says.
  //
  // One variable rather than three since Phase 19B, because the load now has two
  // legitimate outcomes and a discriminated result is the only shape in which the
  // compiler agrees that each branch has what it needs.
  type Loaded =
    | {
        kind: "ok";
        workflow: Awaited<ReturnType<typeof getWorkflow>>;
        inFlight: Awaited<ReturnType<typeof liveRun>>;
        /** Phase 33: the workflow's newest runs, for the canvas's *Recent runs*. */
        recent: RunSummary[];
        /** Carried out of the try so the editor can be told what this viewer may do. */
        scope: Awaited<ReturnType<typeof resolveScope>>;
      }
    | { kind: "elsewhere"; workspace: { id: string; name: string } };

  let loaded: Loaded;
  try {
    // The active workspace comes from the switcher's cookie (Phase 19B). A workflow in a
    // workspace the cookie does not name is a 404 here, exactly as it is at the API —
    // which is also what makes a stale cookie a harmless "not found" rather than a leak.
    const scope = await resolveScope(
      { id: session.user.id, email: session.user.email },
      await readActiveWorkspaceId(),
    );
    const workflow = await getWorkflow(scope, id);
    const [inFlight, recent] = await Promise.all([
      liveRun(scope, workflow.id),
      // One indexed read (`run_workflow_idx`), on a request that has already woken the database.
      listRunPage(scope, { ...EMPTY_RUN_QUERY, workflowId: workflow.id }, { limit: RECENT_RUNS }),
    ]);
    loaded = { kind: "ok", workflow, inFlight, recent: recent.runs, scope };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "not_found") throw error;

    // **Before answering 404, ask whether it is in another of *their* workspaces** — Phase
    // 19B. A shared workspace means links get pasted around, and the recipient is often
    // looking at a different workspace than the sender was. `findMembershipForWorkflow`
    // only ever names a workspace this user is already a member of, so a stranger's
    // workflow still answers 404 and is still indistinguishable from one that never
    // existed.
    const elsewhere = await findMembershipForWorkflow(session.user.id, id);
    if (!elsewhere) notFound();
    loaded = {
      kind: "elsewhere",
      workspace: { id: elsewhere.workspace.id, name: elsewhere.workspace.name },
    };
  }

  if (loaded.kind === "elsewhere") {
    return <WrongWorkspace workflowId={id} workspace={loaded.workspace} />;
  }

  return (
    <Editor
      workflow={describeWorkflow(loaded.workflow)}
      registry={describeNodes()}
      liveRun={loaded.inFlight ? describeRun(loaded.inFlight.run, loaded.inFlight.steps) : null}
      recentRuns={loaded.recent}
      // **Phase 20.** The role is resolved on the server, from the membership row, and
      // handed down — never read in the browser, and never trusted from there. It decides
      // what the canvas draws; every control it hides is separately refused by the API.
      role={loaded.scope.role}
      viewerUserId={session.user.id}
    />
  );
}
