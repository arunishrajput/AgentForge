"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError, api } from "@/lib/canvas/client";

/**
 * "New workflow": create an empty one through the Phase 3 API, then go to it.
 *
 * The failure used to be a red sentence that appeared beside the button and stayed
 * there. It is a toast now, because the failure of an action is about the action and
 * not about a region of the page — `DESIGN.md` → *Notice or toast*. `duration: null`
 * keeps it up until dismissed, since a failure worth acting on should not time out
 * (WCAG 2.2.1).
 *
 * Deleting a workflow used to live here too. It moved into the list, where the row
 * menu and the confirm dialog are.
 */
export function NewWorkflowButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const workflow = await api.createWorkflow({ name: "Untitled workflow" });
      router.push(`/workflows/${workflow.id}`);
    } catch (caught) {
      toast({
        tone: "bad",
        title: "Could not create the workflow",
        detail:
          caught instanceof ApiRequestError ? caught.message : "Nothing was saved. Try again.",
        duration: null,
      });
      setBusy(false);
    }
  };

  return (
    <Button tone="primary" loading={busy} onClick={create}>
      {busy ? "Creating…" : "New workflow"}
    </Button>
  );
}
