"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Labelled, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError, api, type Workflow } from "@/lib/canvas/client";
import { IMPORT_MAX_BYTES } from "@/lib/workflow/transfer";

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

/**
 * What an import's refusal says, as lines a person can act on — Phase 32. The message is the
 * server's; the details add the paths that failed the shape, or the steps whose type is missing.
 */
function refusalLines(caught: unknown): { title: string; lines: string[] } {
  if (!(caught instanceof ApiRequestError)) {
    return { title: "That could not be imported", lines: ["Nothing was saved. Try again."] };
  }
  const details = caught.details as
    | { issues?: { path: string; message: string }[] }
    | { nodeId?: string; message: string }[]
    | undefined;
  const lines = Array.isArray(details)
    ? details.map((problem) => problem.message)
    : (details?.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`);
  return { title: caught.message, lines: lines.slice(0, 6) };
}

/** What to tell the person about the workflow they just imported, beyond its name. */
function importedDetail(workflow: Workflow): string | undefined {
  const notes: string[] = [];
  if (!workflow.active && (workflow.scheduleCron !== null || workflow.webhookUrl !== null)) {
    notes.push("It is switched off, so its trigger will not run it until you switch it on.");
  }
  if (!workflow.runnable) {
    const count = workflow.problems.length;
    notes.push(`It needs attention before it can run: ${count} problem${count === 1 ? "" : "s"}.`);
  }
  return notes.length > 0 ? notes.join(" ") : undefined;
}

/**
 * **Import a workflow — Phase 32.** From a file or a paste, into the workspace you are in.
 *
 * The file is read in the browser and sent as the JSON it holds; the server decides whether it
 * is an export it can read (`CONTRACT.md` → *The workflow export*). JSON that does not parse is
 * caught here, because the server would only say the same thing a round trip later. On success
 * it opens the new workflow on the canvas, as *New workflow* does.
 */
export function ImportWorkflowButton() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ title: string; lines: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setText("");
    setFileName(null);
    setRefusal(null);
  };

  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    setRefusal(null);
    if (picked.size > IMPORT_MAX_BYTES) {
      setFileName(picked.name);
      setText("");
      setRefusal({
        title: `That file is larger than any workflow export can be (${IMPORT_MAX_BYTES / 1_000_000} MB).`,
        lines: [],
      });
      return;
    }
    setFileName(picked.name);
    setText(await picked.text());
  };

  const submit = async () => {
    if (text.trim().length === 0) {
      setRefusal({ title: "Choose an export file, or paste one, first.", lines: [] });
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      setRefusal({
        title: "That is not valid JSON, so it cannot be a workflow export.",
        lines: ["Choose the .json file AgentForge downloaded, or paste all of it."],
      });
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const workflow = await api.importWorkflow(value);
      toast({ tone: "ok", title: `Imported “${workflow.name}”`, detail: importedDetail(workflow) });
      close();
      router.push(`/workflows/${workflow.id}`);
    } catch (caught) {
      setRefusal(refusalLines(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Import</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Import a workflow"
        description="From a file another AgentForge exported. It arrives in this workspace and uses this workspace's connections."
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button tone="primary" loading={busy} onClick={submit}>
              {busy ? "Importing…" : "Import workflow"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* The native input is the control — focusable, named by its label, opened by
                Space and Enter as a file input always is — and the label is what is drawn,
                as a button wearing the input's focus ring (`focus-ring-within`, the theme
                switch's pattern). The input itself is out of sight because its own rendering
                cannot be Toybox and says "No file chosen" in the browser's language. */}
            <label className="btn btn-quiet focus-ring-within cursor-pointer">
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              Choose a file…
            </label>
            <span className="text-muted text-2xs min-w-0 truncate" aria-live="polite">
              {fileName ?? "No file chosen"}
            </span>
          </div>

          <Labelled label="Or paste the export" hint='It starts with { "format": "agentforge/workflow"'>
            <Textarea
              rows={8}
              value={text}
              spellCheck={false}
              className="font-mono text-2xs"
              onChange={(event) => {
                setText(event.target.value);
                setFileName(null);
                setRefusal(null);
              }}
            />
          </Labelled>

          {refusal && (
            <Notice tone="bad" title={refusal.title}>
              {refusal.lines.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4">
                  {refusal.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
        </div>
      </Dialog>
    </>
  );
}
