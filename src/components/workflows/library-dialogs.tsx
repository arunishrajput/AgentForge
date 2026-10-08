"use client";

import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Input, Toggle } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError, api, type TagSummary } from "@/lib/canvas/client";
import { opened } from "@/lib/ui/subject";
import type { WorkflowCard } from "@/lib/workflow/list";
import {
  TAG_NAME_MAX,
  WORKFLOW_TAG_LIMIT,
  findTag,
  sortTags,
  tagNameSchema,
} from "@/lib/workflow/tags";
import { exportFilename } from "@/lib/workflow/transfer";

/**
 * The library's three dialogs — Phase 32: the tags one workflow wears, the workspace's tags,
 * and exporting a workflow that holds pinned outputs.
 *
 * Each is kept mounted by the list and opened by a non-null subject, the way the delete dialog
 * is, so the native `<dialog>` closes itself rather than being torn out of the DOM; every title
 * is guarded for the frame where the subject has just been cleared (`DESIGN.md` → *Traps*).
 *
 * The rules — what a tag name may be, how many a workflow wears, whether two names are one tag —
 * are `lib/workflow/tags.ts`, which the server applies too. These check first so a person is
 * told at once; the API is what refuses.
 */

/** A tag name typed into a box, checked the way the server will check it. */
function readTagName(raw: string): { name: string } | { error: string } {
  const parsed = tagNameSchema.safeParse(raw);
  return parsed.success ? { name: parsed.data } : { error: parsed.error.issues[0]?.message ?? "That name will not do." };
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiRequestError ? caught.message : fallback;
}

/**
 * A tag name and the buttons that act on it. **The buttons line up with the field, not with the
 * label block**: with the error inside the label, as `Labelled` puts it, a message under the
 * field pushed *Add* below it (Phase 32's browser walk). So the error sits under the row, tied
 * to the field by `aria-describedby` and announced as an alert.
 */
function TagNameForm({
  label,
  value,
  error,
  placeholder,
  focusOnMount,
  className,
  onChange,
  onSubmit,
  children,
}: {
  label: string;
  value: string;
  error: string | null;
  placeholder?: string;
  /** Only the rename field: the person just pressed Rename, and the field is where they are going. */
  focusOnMount?: boolean;
  className?: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  /** The buttons — the first is the form's submit. */
  children: ReactNode;
}) {
  const inputId = useId();
  const errorId = useId();
  return (
    <form
      className={cn("space-y-1.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <label htmlFor={inputId} className="text-ui block font-semibold">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- `focusOnMount` is set only by the rename field, which appears because the person pressed Rename.
          autoFocus={focusOnMount}
          value={value}
          maxLength={TAG_NAME_MAX + 8}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1"
          onChange={(event) => onChange(event.target.value)}
        />
        {children}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-bad text-2xs animate-wiggle font-semibold">
          {error}
        </p>
      )}
    </form>
  );
}

/* ------------------------- one workflow's tags ------------------------- */

export function WorkflowTagsDialog({
  card,
  tags,
  onClose,
  onSaved,
}: {
  /** The workflow being tagged; null closes the dialog. */
  card: WorkflowCard | null;
  /** The workspace's tags. */
  tags: TagSummary[];
  onClose: () => void;
  /** After a save, or after a tag was created — so the list re-reads its tags. */
  onSaved: () => void;
}) {
  const toast = useToast();
  const [shown, setShown] = useState<WorkflowCard | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<TagSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // Every opening starts from the workflow's saved tags (`lib/ui/subject.ts`) — React's "adjust
  // state when a prop changes", done during render so the first frame already shows them. A
  // Cancel therefore really cancels: reopening does not bring back what was ticked and dropped.
  if (card !== shown) {
    setShown(card);
    if (opened(shown, card) && card) {
      setSelected(new Set(card.tags.map((tag) => tag.id)));
      setCreated([]);
      setDraft("");
      setDraftError(null);
    }
  }

  const all = sortTags([...tags, ...created.filter((tag) => !tags.some((known) => known.id === tag.id))]);
  const full = selected.size >= WORKFLOW_TAG_LIMIT;

  const close = () => {
    // A tag made here exists in the workspace whether or not this workflow keeps it, so the
    // list re-reads its tags even on Cancel.
    if (created.length > 0) onSaved();
    onClose();
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const add = async () => {
    const read = readTagName(draft);
    if ("error" in read) {
      setDraftError(read.error);
      return;
    }
    if (full) {
      setDraftError(`A workflow can wear at most ${WORKFLOW_TAG_LIMIT} tags.`);
      return;
    }
    // A name the workspace already has is that tag — ticked, not created twice.
    const existing = findTag(all, read.name);
    if (existing) {
      toggle(existing.id, true);
      setDraft("");
      setDraftError(null);
      return;
    }
    setAdding(true);
    try {
      const tag = await api.createTag(read.name);
      setCreated((current) => [...current, tag]);
      toggle(tag.id, true);
      setDraft("");
      setDraftError(null);
    } catch (caught) {
      setDraftError(errorMessage(caught, "That tag could not be created. Try again."));
    } finally {
      setAdding(false);
    }
  };

  const save = async () => {
    if (!card) return;
    setSaving(true);
    try {
      await api.setWorkflowTags(card.id, [...selected]);
      toast({ tone: "ok", title: `Tags saved on “${card.name}”` });
      onSaved();
      onClose();
    } catch (caught) {
      toast({
        tone: "bad",
        title: "Could not save those tags",
        detail: errorMessage(caught, "Nothing changed. Try again."),
        duration: null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={card !== null}
      onClose={close}
      title={card ? `Tags on “${card.name}”` : "Tags"}
      description={`Tags belong to the workspace, so everybody here files with the same words. Up to ${WORKFLOW_TAG_LIMIT} on a workflow.`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button tone="primary" loading={saving} onClick={save}>
            {saving ? "Saving…" : "Save tags"}
          </Button>
        </>
      }
    >
      {all.length === 0 ? (
        <p className="text-muted text-ui">This workspace has no tags yet. Name the first one below.</p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="eyebrow mb-2">Wears</legend>
          {all.map((tag) => {
            const on = selected.has(tag.id);
            return (
              <Toggle
                key={tag.id}
                label={tag.name}
                checked={on}
                disabled={!on && full}
                onChange={(event) => toggle(tag.id, event.target.checked)}
                className="min-h-6"
              />
            );
          })}
        </fieldset>
      )}

      <TagNameForm
        label="New tag"
        value={draft}
        error={draftError}
        placeholder="billing, weekly, needs-review…"
        className="border-line-soft mt-4 border-t-2 pt-4"
        onChange={(value) => {
          setDraft(value);
          setDraftError(null);
        }}
        onSubmit={add}
      >
        <Button type="submit" loading={adding} className="shrink-0">
          Add
        </Button>
      </TagNameForm>
    </Dialog>
  );
}

/* ------------------------- the workspace's tags ------------------------- */

export type TagChange = { renamed: { from: string; to: string } } | { deleted: string } | { created: string };

export function ManageTagsDialog({
  open,
  tags,
  counts,
  onClose,
  onChanged,
}: {
  open: boolean;
  tags: TagSummary[];
  /** How many of the workflows this reader can see wear each tag, by id. */
  counts: Map<string, number>;
  onClose: () => void;
  onChanged: (change: TagChange) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; error: string | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const sorted = sortTags(tags);

  const create = async () => {
    const read = readTagName(draft);
    if ("error" in read) {
      setDraftError(read.error);
      return;
    }
    const existing = findTag(tags, read.name);
    if (existing) {
      // Named as it is spelled, not as it was typed — the server's refusal says the same.
      setDraftError(`This workspace already has a tag called “${existing.name}”.`);
      return;
    }
    setCreating(true);
    try {
      await api.createTag(read.name);
      setDraft("");
      setDraftError(null);
      onChanged({ created: read.name });
    } catch (caught) {
      setDraftError(errorMessage(caught, "That tag could not be created. Try again."));
    } finally {
      setCreating(false);
    }
  };

  const rename = async (tag: TagSummary) => {
    if (!editing) return;
    const read = readTagName(editing.name);
    if ("error" in read) {
      setEditing({ ...editing, error: read.error });
      return;
    }
    if (read.name === tag.name) {
      setEditing(null);
      return;
    }
    const clash = findTag(tags, read.name);
    if (clash && clash.id !== tag.id) {
      setEditing({ ...editing, error: `This workspace already has a tag called “${clash.name}”.` });
      return;
    }
    setBusy(tag.id);
    try {
      await api.renameTag(tag.id, read.name);
      setEditing(null);
      onChanged({ renamed: { from: tag.name, to: read.name } });
    } catch (caught) {
      setEditing({ ...editing, error: errorMessage(caught, "That tag could not be renamed. Try again.") });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (tag: TagSummary) => {
    setBusy(tag.id);
    try {
      await api.deleteTag(tag.id);
      setConfirming(null);
      toast({ tone: "ok", title: `Deleted the tag “${tag.name}”` });
      onChanged({ deleted: tag.name });
    } catch (caught) {
      toast({
        tone: "bad",
        title: "Could not delete that tag",
        detail: errorMessage(caught, "It is still here. Try again."),
        duration: null,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setEditing(null);
        setConfirming(null);
        onClose();
      }}
      title="Tags in this workspace"
      description="Renaming a tag renames it on every workflow that wears it, and deleting one takes it off them all."
    >
      <TagNameForm
        label="New tag"
        value={draft}
        error={draftError}
        onChange={(value) => {
          setDraft(value);
          setDraftError(null);
        }}
        onSubmit={create}
      >
        <Button type="submit" loading={creating} className="shrink-0">
          Add tag
        </Button>
      </TagNameForm>

      {sorted.length === 0 ? (
        <p className="text-muted text-ui mt-4">No tags yet.</p>
      ) : (
        <ul className="divide-line-soft mt-4 divide-y-2">
          {sorted.map((tag) => {
            const count = counts.get(tag.id) ?? 0;
            const isEditing = editing?.id === tag.id;
            const isConfirming = confirming === tag.id;
            return (
              <li key={tag.id} className="py-2.5">
                {isEditing ? (
                  <TagNameForm
                    label={`Rename “${tag.name}”`}
                    value={editing.name}
                    error={editing.error}
                    focusOnMount
                    onChange={(value) => setEditing({ id: tag.id, name: value, error: null })}
                    onSubmit={() => rename(tag)}
                  >
                    <Button type="submit" tone="primary" size="sm" loading={busy === tag.id} className="shrink-0">
                      Save
                    </Button>
                    <Button size="sm" onClick={() => setEditing(null)} className="shrink-0">
                      Cancel
                    </Button>
                  </TagNameForm>
                ) : isConfirming ? (
                  <div className="space-y-2">
                    <p className="text-ui">
                      Delete <strong className="font-semibold">“{tag.name}”</strong>? It comes off every workflow
                      that wears it.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" tone="danger" loading={busy === tag.id} onClick={() => remove(tag)}>
                        Delete tag
                      </Button>
                      <Button size="sm" onClick={() => setConfirming(null)}>
                        Keep it
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-ui min-w-0 flex-1 truncate font-semibold">{tag.name}</span>
                    <span className="text-faint text-2xs">
                      {count} workflow{count === 1 ? "" : "s"}
                    </span>
                    <Button
                      size="sm"
                      tone="ghost"
                      onClick={() => {
                        setConfirming(null);
                        setEditing({ id: tag.id, name: tag.name, error: null });
                      }}
                    >
                      Rename<span className="sr-only"> {tag.name}</span>
                    </Button>
                    <Button
                      size="sm"
                      tone="ghost"
                      onClick={() => {
                        setEditing(null);
                        setConfirming(tag.id);
                      }}
                    >
                      Delete<span className="sr-only"> {tag.name}</span>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

/* ------------------------------- export ------------------------------- */

/**
 * Fetch the export envelope and hand it to the browser as a file. The API answers `{ data }`
 * like every other route (D146), so the file is made here: a Blob, an object URL and a
 * throwaway link, released again at once.
 */
export async function downloadExport(card: Pick<WorkflowCard, "id" | "name">, includePinned: boolean) {
  const envelope = await api.exportWorkflow(card.id, { includePinned });
  const blob = new Blob([`${JSON.stringify(envelope, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(card.name);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Asked only when the workflow holds a pinned output — otherwise *Export* simply downloads.
 * **Left out by default** (D146): a pin is captured from a real run, and a file is easy to
 * attach to an issue or commit to a repository.
 */
export function ExportDialog({ card, onClose }: { card: WorkflowCard | null; onClose: () => void }) {
  const toast = useToast();
  const [includePinned, setIncludePinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<WorkflowCard | null>(null);

  // Left out, every time it opens — not only the first time for each workflow (D146).
  if (card !== shown) {
    setShown(card);
    if (opened(shown, card)) setIncludePinned(false);
  }

  const pins = card?.pinnedCount ?? 0;

  const run = async () => {
    if (!card) return;
    setBusy(true);
    try {
      await downloadExport(card, includePinned);
      toast({
        tone: "ok",
        title: `Exported “${card.name}”`,
        detail: includePinned ? "Pinned outputs included." : "Pinned outputs left out.",
      });
      onClose();
    } catch (caught) {
      toast({
        tone: "bad",
        title: "Could not export that workflow",
        detail: errorMessage(caught, "Nothing was downloaded. Try again."),
        duration: null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={card !== null}
      onClose={onClose}
      title={card ? `Export “${card.name}”` : "Export"}
      description="A JSON file another AgentForge can import. Connections are never in it: each node uses whatever the importing workspace has connected."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" loading={busy} onClick={run}>
            {busy ? "Exporting…" : "Download file"}
          </Button>
        </>
      }
    >
      <Toggle
        label={`Include pinned outputs (${pins} step${pins === 1 ? "" : "s"})`}
        checked={includePinned}
        onChange={(event) => setIncludePinned(event.target.checked)}
      />
      <p className="text-muted text-2xs mt-2 text-pretty">
        A pin is test data captured from a real run — a message, a page of an API&apos;s answer. Leave it out if the file
        is going anywhere public. Notes and switched-off steps are part of the workflow and always travel.
      </p>
    </Dialog>
  );
}
