import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { Editor } from "@/components/canvas/editor";
import { ApiError } from "@/lib/api";
import { describeRun, liveRun } from "@/lib/engine/run";
import { describeNodes } from "@/lib/nodes";
import { describeWorkflow, getWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

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

  try {
    const workflow = await getWorkflow(session.user.id, id);
    const inFlight = await liveRun(session.user.id, workflow.id);

    return (
      <Editor
        workflow={describeWorkflow(workflow)}
        registry={describeNodes()}
        liveRun={inFlight ? describeRun(inFlight.run, inFlight.steps) : null}
      />
    );
  } catch (error) {
    // Another owner's workflow is indistinguishable from one that does not exist.
    if (error instanceof ApiError && error.code === "not_found") notFound();
    throw error;
  }
}
