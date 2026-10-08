"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { api, ApiRequestError } from "@/lib/canvas/client";

/**
 * "This workflow is in another of your workspaces" — Phase 19B.
 *
 * **A state that only begins to exist once workspaces are shared.** Somebody pastes a link
 * to a workflow; the person opening it is currently in a different workspace; every query
 * in the product is workspace-scoped, so the honest answer is 404 — on a workflow they can
 * genuinely see. That reads as a broken product.
 *
 * So this says where the workflow lives and offers to go there. **It does not switch on its
 * own**, deliberately: a link in a chat window must not be able to change which workspace
 * somebody is working in without telling them. One sentence and one button is a better
 * answer than magic.
 */
export function WrongWorkspace({
  workflowId,
  workspace,
  kind = "workflow",
}: {
  /** The id the link named — a workflow's, or since Phase 33 a run's. */
  workflowId: string;
  workspace: { id: string; name: string };
  /** What the link was to. A run link lands in the wrong workspace as easily (Phase 33). */
  kind?: "workflow" | "run";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchAndOpen = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.switchWorkspace(workspace.id);
      // Same URL, different workspace: the page is a server component, so it has to
      // re-render for the switch to mean anything.
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : "That workspace could not be opened.",
      );
      setBusy(false);
    }
  };

  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <Card raised className="animate-rise p-6">
        <h1 className="text-xl font-bold tracking-tight text-pretty">
          This {kind} is in {workspace.name}
        </h1>
        <p className="text-muted mt-2 text-sm text-pretty">
          You are a member of that workspace, but you are currently working in a different
          one — so nothing on this page would be its. Switch across to open it.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button tone="primary" loading={busy} onClick={() => void switchAndOpen()}>
            Switch to {workspace.name}
          </Button>
          <Link href="/workflows" className="btn btn-quiet">
            Stay here
          </Link>
        </div>
        {error && <Notice tone="bad" className="mt-4" title={error} />}
        <p className="text-faint mt-4 text-3xs">
          {kind === "run" ? "Run" : "Workflow"} {workflowId}
        </p>
      </Card>
    </main>
  );
}
