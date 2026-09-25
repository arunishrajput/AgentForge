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
      {error && <span className="text-[12px] text-red-300">{error}</span>}
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="bg-accent text-canvas rounded-lg px-3.5 py-2 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
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
        className="text-muted hover:text-red-300 text-[12px] transition-colors"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-muted text-[11px]">Delete {name} and its runs?</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api.deleteWorkflow(id).catch(() => undefined);
          router.refresh();
        }}
        className="text-[12px] text-red-300 disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-muted text-[12px]"
      >
        Cancel
      </button>
    </span>
  );
}
