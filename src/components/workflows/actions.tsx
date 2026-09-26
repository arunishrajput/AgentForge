"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiRequestError, api } from "@/lib/canvas/client";

/**
 * The two mutations on the workflow list. Both go through the Phase 3 API and then
 * ask the router to re-render the server component, so the list a user sees is
 * always what the database holds rather than optimistic local state.
 */
export function NewWorkflowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const workflow = await api.createWorkflow({ name: "Untitled workflow" });
      router.push(`/workflows/${workflow.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : "Could not create the workflow.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span role="alert" className="text-bad text-xs">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="btn btn-primary"
      >
        {busy ? "Creating…" : "New workflow"}
      </button>
    </div>
  );
}

export function DeleteWorkflowButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Two clicks rather than a `confirm()` dialog: a native modal blocks the page,
  // and deleting a workflow also deletes its run history (schema cascade).
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn btn-ghost hover:text-bad shrink-0 px-2 text-xs"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="animate-fade flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
      <span className="text-muted text-2xs">Delete {name} and its runs?</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api.deleteWorkflow(id).catch(() => undefined);
          router.refresh();
        }}
        className="btn btn-ghost text-bad px-2 text-xs disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="btn btn-ghost px-2 text-xs"
      >
        Cancel
      </button>
    </span>
  );
}
