"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError, api, type Workflow, type WorkflowVersion } from "@/lib/canvas/client";
import { formatUtc } from "@/lib/format/date";
import { summaryParts } from "@/lib/workflow/diff";

/**
 * Version history — `BUILD_PLAN.md` Phase 18's "history panel".
 *
 * **A dialog, not a third panel**, and that is a layout decision Phase 16 already
 * paid for. The canvas has two side panels and solving their cost took the whole of
 * that phase: at 1440px two open columns leave an 880px canvas. A third column would
 * undo it. History is also read occasionally and in a considered way — you open it,
 * look, decide — which is exactly the shape a modal fits and a persistent column does
 * not.
 *
 * **Two panes**: the list of versions, and the one you picked. The list is the part
 * that has to be scannable, so every row carries what it changed rather than only when
 * it happened — "+2 −1" is how you find the version you are looking for, and a column
 * of identical timestamps is not.
 *
 * The three things you can do to a version are the three the phase asks for: read it,
 * compare it against another, and restore it. Restoring is a **forward** operation
 * here as it is on the server — it writes a new version on top — so this dialog never
 * has to explain a history that changed shape underneath it.
 */
export function History({
  open,
  onClose,
  workflow,
  dirty,
  readOnly,
  onRestored,
  onCompare,
}: {
  open: boolean;
  onClose: () => void;
  /** The workflow as last SAVED. `workflow.version` is the number at the top. */
  workflow: Workflow;
  /** The canvas has edits the server has not seen — restoring would discard them. */
  dirty: boolean;
  /**
   * The viewer's role does not carry editing — Phase 20. Reading the history and comparing
   * two versions are reads and stay; naming a version and restoring one are writes the API
   * refuses below `editor`, so their controls go rather than sit here disabled.
   */
  readOnly: boolean;
  onRestored: (workflow: Workflow) => void;
  onCompare: (from: number, to: number) => void;
}) {
  const toast = useToast();
  const [versions, setVersions] = useState<WorkflowVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "restoring" | "labelling">(null);

  /**
   * Load the history whenever the dialog opens — not once on mount. A save made while
   * it was closed, which is most saves, adds a version, and a history that silently
   * stopped at the state it had on first open would be worse than no history.
   *
   * Written as a promise chain with a liveness guard rather than `void load()`, for
   * two reasons that happen to agree. The honest one: closing the dialog mid-request
   * should not write into a component nobody is looking at, and `live` is what stops
   * it. The mechanical one: `react/set-state-in-effect` reports an async call in an
   * effect as a cascading render, and it is right to — the guarded continuation is
   * what makes the state update belong to the *response* rather than to the render.
   */
  useEffect(() => {
    if (!open) return;

    let live = true;
    api
      .listVersions(workflow.id)
      .then((list) => {
        if (!live) return list;
        setError(null);
        setVersions(list);
        // The newest, every time it opens — the dialog has something to read straight
        // away, and after a restore the version just written is the one selected.
        setSelected(list[0]?.number ?? null);
        return list;
      })
      .catch((problem: unknown) => {
        if (!live) return [];
        setVersions([]);
        setError(
          problem instanceof ApiRequestError
            ? problem.message
            : "The history could not be loaded.",
        );
        return [];
      });

    return () => {
      live = false;
    };
  }, [open, workflow.id]);

  const chosen = versions?.find((version) => version.number === selected) ?? null;

  const restore = useCallback(async () => {
    if (!chosen) return;
    setBusy("restoring");
    try {
      const updated = await api.restoreVersion(workflow.id, chosen.number);
      onRestored(updated);
      toast({
        tone: "ok",
        title: `Restored v${chosen.number}`,
        detail: `Saved as v${updated.version}. Nothing in between was deleted — the history moves forward.`,
      });
      onClose();
    } catch (problem) {
      toast({
        tone: "bad",
        title: "Could not restore that version",
        detail: problem instanceof ApiRequestError ? problem.message : undefined,
        duration: null,
      });
    } finally {
      setBusy(null);
    }
  }, [chosen, onClose, onRestored, toast, workflow.id]);

  const relabel = useCallback(
    async (label: string | null) => {
      if (!chosen) return;
      setBusy("labelling");
      try {
        const updated = await api.labelVersion(workflow.id, chosen.number, label);
        setVersions(
          (current) =>
            current?.map((version) =>
              version.number === updated.number ? { ...version, label: updated.label } : version,
            ) ?? null,
        );
      } catch (problem) {
        toast({
          tone: "bad",
          title: "Could not rename that version",
          detail: problem instanceof ApiRequestError ? problem.message : undefined,
        });
      } finally {
        setBusy(null);
      }
    },
    [chosen, toast, workflow.id],
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Version history"
      description={`Every save is a version. ${workflow.name} is at v${workflow.version}.`}
      className="w-[min(52rem,calc(100vw-2rem))]"
    >
      {error && (
        <Notice tone="bad" title="The history could not be loaded">
          {error}
        </Notice>
      )}

      {versions === null ? (
        <p className="text-muted text-xs">Loading the history…</p>
      ) : versions.length === 0 ? (
        <p className="text-muted text-xs leading-relaxed">
          No versions recorded yet. The next time this workflow is saved with a change, it
          appears here.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <ol className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-0.5">
            {versions.map((version) => (
              <li key={version.number}>
                <VersionRow
                  version={version}
                  selected={version.number === selected}
                  onSelect={() => setSelected(version.number)}
                />
              </li>
            ))}
          </ol>

          {chosen && (
            <Detail
              key={chosen.number}
              version={chosen}
              workflow={workflow}
              dirty={dirty}
              busy={busy}
              readOnly={readOnly}
              onLabel={relabel}
              onRestore={restore}
              onCompare={() => {
                onCompare(chosen.number, workflow.version);
                onClose();
              }}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}

/**
 * One row of the list.
 *
 * `aria-current` rather than only a fill, because "which version am I looking at" is
 * state a screen reader has to get too — the same three-channel rule the shell's nav
 * follows (`DESIGN.md` → *The shell*).
 */
function VersionRow({
  version,
  selected,
  onSelect,
}: {
  version: WorkflowVersion;
  selected: boolean;
  onSelect: () => void;
}) {
  const parts = version.changes ? summaryParts(version.changes) : [];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "card w-full space-y-1 p-2.5 text-left transition-colors duration-100",
        // The same three channels the shell marks its current nav item with
        // (`DESIGN.md` → *The shell*): `aria-current`, a different fill, and the
        // pressed position. A selected row is an object that has been clicked, so it
        // sits where a clicked object sits.
        selected ? "bg-sunken shadow-press translate-x-px translate-y-px" : "hover:bg-canvas",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-ui font-bold">v{version.number}</span>
        {version.current && (
          <span className="chip shrink-0">
            <span aria-hidden="true">●</span>
            Current
          </span>
        )}
        <span className="text-faint ml-auto shrink-0 font-mono text-3xs">
          {formatUtc(version.createdAt)}
        </span>
      </span>

      {version.label && (
        <span className="text-ink block truncate text-2xs font-bold">{version.label}</span>
      )}
      <span className="text-muted block truncate text-2xs">{version.name}</span>

      {parts.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {parts.map((part) => (
            // The symbol is decoration; the words are the content. A reader who
            // cannot parse `+2` at a glance gets "2 nodes added" announced instead.
            <span key={part.symbol} className="text-muted font-mono text-3xs tabular-nums">
              <span aria-hidden="true">{part.symbol}</span>
              <span className="sr-only">{part.words}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function Detail({
  version,
  workflow,
  dirty,
  busy,
  readOnly,
  onLabel,
  onRestore,
  onCompare,
}: {
  version: WorkflowVersion;
  workflow: Workflow;
  dirty: boolean;
  busy: null | "restoring" | "labelling";
  readOnly: boolean;
  onLabel: (label: string | null) => void;
  onRestore: () => void;
  onCompare: () => void;
}) {
  const [label, setLabel] = useState(version.label ?? "");
  const parts = version.changes ? summaryParts(version.changes) : [];

  return (
    <section className="space-y-3.5">
      <header className="space-y-1">
        <h3 className="text-base font-bold">
          v{version.number}
          {version.current && <span className="text-muted font-normal"> · current</span>}
        </h3>
        <p className="text-muted font-mono text-2xs">{formatUtc(version.createdAt)}</p>
      </header>

      <dl className="space-y-1.5 text-2xs">
        <div className="flex gap-2">
          <dt className="text-muted w-20 shrink-0">Named</dt>
          <dd className="min-w-0 flex-1 font-bold break-words">{version.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted w-20 shrink-0">Changed</dt>
          <dd className="min-w-0 flex-1">
            {version.changes === null ? (
              // Null, not a zeroed summary: the version below this one may simply have
              // been pruned, and "12 nodes added" for a version that added one would be
              // a confident lie.
              <span className="text-muted">
                The oldest version kept — there is nothing before it to compare against.
              </span>
            ) : parts.length === 0 ? (
              <span className="text-muted">Renamed only.</span>
            ) : (
              <span>{parts.map((part) => part.words).join(", ")}</span>
            )}
          </dd>
        </div>
      </dl>

      {/* Naming a version is a write. A viewer reading the history sees what each version
          is called and cannot rename one. */}
      {readOnly ? (
        version.label && (
          <div className="space-y-1.5">
            <span className="eyebrow block">Named</span>
            <p className="text-sm font-semibold">{version.label}</p>
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="version-label" className="eyebrow block">
            Name this version
          </label>
          <div className="flex gap-2">
            <Input
              id="version-label"
              value={label}
              maxLength={80}
              placeholder="Before the rewrite"
              onChange={(event) => setLabel(event.target.value)}
              onBlur={() => {
                const next = label.trim() === "" ? null : label.trim();
                if (next !== version.label) onLabel(next);
              }}
              className="min-w-0 flex-1"
            />
          </div>
          <p className="text-muted text-3xs leading-relaxed">
            A named version is kept for ever. Unnamed ones are trimmed to the most recent 50,
            so naming one is how you keep it.
          </p>
        </div>
      )}

      {dirty && !readOnly && (
        <Notice tone="warn" title="You have unsaved changes">
          Restoring replaces what is on the canvas. Save first if you want to keep it.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button tone="quiet" onClick={onCompare} disabled={version.current}>
          {version.current ? "This is the current version" : `Compare with v${workflow.version}`}
        </Button>
        {!readOnly && (
          <Button
            tone="primary"
            onClick={onRestore}
            loading={busy === "restoring"}
            disabled={version.current}
          >
            Restore this version
          </Button>
        )}
      </div>

      {!version.current && !readOnly && (
        <p className="text-muted text-3xs leading-relaxed">
          Restoring saves v{version.number}&rsquo;s graph as a new version on top. Nothing
          between is deleted, and every past run still points at the version it actually ran.
        </p>
      )}
    </section>
  );
}
