"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Labelled, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, type Workflow, type WorkflowVisibility } from "@/lib/canvas/client";
import { formatUtc } from "@/lib/format/date";

/**
 * Who can see this workflow — **Phase 20**, and the one screen in the product where two
 * genuinely different kinds of sharing sit side by side.
 *
 * They are deliberately two sections and not one control, because they answer different
 * questions and collapsing them into a single "private / workspace / public" ladder would
 * teach the wrong model:
 *
 *   **Inside the workspace** is who among your colleagues may open it. It is a
 *   day-to-day setting, it is reversible with no consequences, and the people it governs
 *   are people you already share credentials with.
 *
 *   **A public link** is a URL that works for anybody who is handed it, signed in or not.
 *   It is an outward-facing act, it needs `admin`, and what it discloses is a redacted
 *   graph — so the dialog says exactly what a stranger holding it would see, in the
 *   place where the decision is made rather than in documentation nobody opens.
 *
 * The two are independent, which is why a private workflow can have a live link. That
 * combination is a real thing to want — not ready for my colleagues, ready for the person
 * I am showing it to — and the copy below states it rather than leaving it to be
 * discovered.
 */
export function ShareDialog({
  open,
  onClose,
  workflow,
  canShare,
  canSetVisibility,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** The workflow as last SAVED — a share link only exists once stored. */
  workflow: Workflow;
  /** `admin`: may publish and revoke the public link. */
  canShare: boolean;
  /** The creator, or an admin: may change who in the workspace sees it. */
  canSetVisibility: boolean;
  onChanged: (workflow: Workflow) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | "visibility" | "share" | "unshare">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const act = async (what: "visibility" | "share" | "unshare", run: () => Promise<Workflow>) => {
    setBusy(what);
    setError(null);
    try {
      onChanged(await run());
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : "That change could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  };

  const setVisibility = (visibility: WorkflowVisibility) =>
    act("visibility", async () => {
      const saved = await api.updateWorkflow(workflow.id, { visibility });
      toast({
        tone: "ok",
        title:
          visibility === "private"
            ? "Only you and the workspace's admins can see this now"
            : "Everybody in this workspace can see this now",
      });
      return saved;
    });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The link is in a selectable field either way, so this is a hint and not a failure.
      setCopied(false);
      setError("Could not copy automatically. Select the link and copy it.");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share this workflow"
      description="Two separate decisions: who in this workspace can open it, and whether anybody with a link can read it."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-5">
        {error && <Notice tone="bad" title={error} />}

        {/* ------------------------------------------------------------ *
            Inside the workspace
         * ------------------------------------------------------------ */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold">Inside this workspace</h3>

          {canSetVisibility ? (
            <Labelled
              label="Who can open it"
              hint="Admins and owners can always see every workflow in the workspace — a workflow runs with the workspace's credentials, and they are accountable for those."
            >
              <Select
                value={workflow.visibility}
                disabled={busy !== null}
                onChange={(event) => void setVisibility(event.target.value as WorkflowVisibility)}
              >
                <option value="workspace">Everybody in this workspace</option>
                <option value="private">Just me, and the admins</option>
              </Select>
            </Labelled>
          ) : (
            <p className="text-muted text-sm text-pretty">
              {workflow.visibility === "private"
                ? "This workflow is private to the person who made it. You can see it because you administer this workspace."
                : "Everybody in this workspace can open this workflow."}{" "}
              <span className="text-faint">
                Changing that needs to be done by whoever created it, or by an admin.
              </span>
            </p>
          )}
        </section>

        <hr className="border-line-soft" />

        {/* ------------------------------------------------------------ *
            A public link
         * ------------------------------------------------------------ */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold">A public link</h3>

          {!canShare ? (
            <p className="text-muted text-sm text-pretty">
              {workflow.shareUrl
                ? "This workflow has a public link. Only an admin can change or revoke it."
                : "Publishing a public link needs the admin role in this workspace."}
            </p>
          ) : workflow.shareUrl ? (
            <>
              <Notice
                tone="ok"
                title="Anybody with this link can read this workflow"
                action={
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button onClick={() => void copy(workflow.shareUrl ?? "")}>
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                    <Button
                      tone="danger"
                      loading={busy === "unshare"}
                      onClick={() =>
                        void act("unshare", async () => {
                          const saved = await api.unshareWorkflow(workflow.id);
                          toast({ tone: "ok", title: "That link is dead — nobody can use it now" });
                          setCopied(false);
                          return saved;
                        })
                      }
                    >
                      Stop sharing
                    </Button>
                    {workflow.sharedAt && (
                      <span className="text-faint text-2xs">
                        Shared {formatUtc(workflow.sharedAt)}
                      </span>
                    )}
                  </div>
                }
              >
                <p>
                  No sign-in, no account. They see the{" "}
                  <strong className="text-ink font-semibold">shape</strong> of this workflow —
                  its nodes, how they are wired, and each node&rsquo;s settings — and{" "}
                  <strong className="text-ink font-semibold">none of the values you typed</strong>:
                  no URLs, prompts, message bodies, email addresses or headers. No runs, no
                  credentials, and nothing about this workspace or who is in it.
                </p>
                {/* Read-only input rather than a code block: it has to be selectable on a
                    phone, where clipboard access is the flakiest. */}
                <input
                  readOnly
                  value={workflow.shareUrl}
                  aria-label="Public link to this workflow"
                  onFocus={(event) => event.currentTarget.select()}
                  className="field mt-2 font-mono text-2xs"
                />
              </Notice>
              <p className="text-faint text-2xs text-pretty">
                To change the link, stop sharing and share again — the old URL stops working
                immediately and cannot be brought back.
              </p>
            </>
          ) : (
            <>
              <p className="text-muted text-sm text-pretty">
                Publishes a read-only page anybody can open. Every value you typed into a node
                is withheld — the reader sees the graph and its settings, never its contents.
              </p>
              <Button
                tone="primary"
                loading={busy === "share"}
                onClick={() =>
                  void act("share", async () => {
                    const saved = await api.shareWorkflow(workflow.id);
                    toast({ tone: "ok", title: "A public link is live — copy it below" });
                    return saved;
                  })
                }
              >
                Create a public link
              </Button>
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}
