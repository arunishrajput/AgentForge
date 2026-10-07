"use client";

import { useCallback, useEffect, useRef } from "react";

import type { useToast } from "@/components/ui/toast";
import {
  copySelection,
  parseEnvelope,
  planPaste,
  serialiseEnvelope,
  type FlowRect,
} from "@/lib/canvas/clipboard";
import type { NodeSummary } from "@/lib/canvas/client";
import { isTypingTarget } from "@/lib/canvas/shortcuts";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNote } from "@/lib/workflow/graph";

/**
 * Copy, cut, paste and duplicate, wired to the editor — Phase 29. What a paste *does* is
 * `lib/canvas/clipboard.ts`, with tests; this file moves text in and out of the clipboard.
 *
 * **Copy writes with `navigator.clipboard.writeText`, from the key press. Paste reads the
 * `paste` event.** The asymmetry is deliberate. Writing needs no permission while the
 * user is acting, and doing it from the key press works whether or not the browser would
 * have fired a `copy` event with no text selected — Safari does not. Reading is the
 * other way round: `readText()` asks the user for permission to see their clipboard,
 * a prompt nobody expects for a paste, whereas the `paste` event hands the page what the
 * user chose to paste and nothing else.
 *
 * Neither ever takes a key from a text field, and copy steps aside when the reader has
 * selected text on the page — the run panel's output is something people copy.
 */

type Toast = ReturnType<typeof useToast>;

/** Text selected on the page — a copy of it is the browser's, not the canvas's. */
function textIsSelected(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
}

const nodesWord = (n: number) => `${n} node${n === 1 ? "" : "s"}`;

/** "2 nodes", "a note", "2 nodes and a note" — what a copy or a paste carried (Phase 30). */
function what(nodes: number, notes: number): string {
  const noteWords = notes === 1 ? "a note" : `${notes} notes`;
  if (notes === 0) return nodesWord(nodes);
  if (nodes === 0) return noteWords;
  return `${nodesWord(nodes)} and ${noteWords}`;
}

export function useClipboard({
  graph,
  selectedIds,
  registry,
  canCopy,
  canEdit,
  viewport,
  insert,
  remove,
  toast,
}: {
  graph: WorkflowGraph;
  selectedIds: readonly string[];
  registry: Map<string, NodeSummary>;
  /** Anywhere a node can be selected — a viewer may copy what they may read. */
  canCopy: boolean;
  /** Paste, cut and duplicate write to the graph: an editor, outside diff mode. */
  canEdit: boolean;
  /** The canvas on screen, in flow coordinates, for a paste of nodes that are not on it. */
  viewport: () => FlowRect | undefined;
  /** Add nodes, edges and notes to the canvas as one step, selected. */
  insert: (nodes: WorkflowNode[], edges: WorkflowEdge[], notes: WorkflowNote[]) => void;
  /** Delete nodes and notes, and every edge touching them, as one step. */
  remove: (ids: readonly string[]) => void;
  toast: Toast;
}) {
  const options = useCallback(
    (withViewport: boolean) => ({
      isTrigger: (type: string) => registry.get(type)?.kind === "trigger",
      isKnown: (type: string) => registry.has(type),
      viewport: withViewport ? viewport() : undefined,
    }),
    [registry, viewport],
  );

  const write = useCallback(
    async (ids: readonly string[]): Promise<boolean> => {
      const envelope = copySelection(graph, ids);
      if (!envelope) return false;
      try {
        await navigator.clipboard.writeText(serialiseEnvelope(envelope));
        return true;
      } catch {
        toast({
          tone: "bad",
          title: "The browser refused clipboard access",
          detail: "Nothing was copied. Duplicate still works within this workflow.",
          duration: null,
        });
        return false;
      }
    },
    [graph, toast],
  );

  /** ⌘C. `false` when there is nothing of the canvas's to copy, so the key stays the browser's. */
  const copy = useCallback((): boolean => {
    if (!canCopy || selectedIds.length === 0 || textIsSelected()) return false;
    const ids = [...selectedIds];
    const notes = (graph.notes ?? []).filter((note) => ids.includes(note.id)).length;
    void (async () => {
      if (!(await write(ids))) return;
      toast({
        tone: "ok",
        title: `Copied ${what(ids.length - notes, notes)}`,
        detail: `Paste ${ids.length === 1 ? "it" : "them"} here, or into another workflow — in this tab or another.`,
      });
    })();
    return true;
  }, [canCopy, graph, selectedIds, toast, write]);

  /** ⌘X — copied first, and deleted only once the clipboard has them. */
  const cut = useCallback((): boolean => {
    if (!canEdit || selectedIds.length === 0 || textIsSelected()) return false;
    const ids = [...selectedIds];
    void (async () => {
      if (await write(ids)) remove(ids);
    })();
    return true;
  }, [canEdit, remove, selectedIds, write]);

  /** ⌘D — a copy beside the original, without touching the clipboard. */
  const duplicate = useCallback((): boolean => {
    if (!canEdit || selectedIds.length === 0) return false;
    const envelope = copySelection(graph, selectedIds);
    if (!envelope) return false;
    const plan = planPaste(graph, envelope, options(false));
    if (!plan.ok) {
      toast({ tone: "warn", title: "Could not duplicate that", detail: plan.reason });
      return true;
    }
    insert(plan.nodes, plan.edges, plan.notes);
    if (plan.note) toast({ tone: "warn", title: "Duplicated, with one thing left out", detail: plan.note });
    return true;
  }, [canEdit, graph, insert, options, selectedIds, toast]);

  // The paste listener reads its inputs through a ref, so it is attached once rather than
  // re-attached on every render a drag causes.
  const latest = useRef({ canEdit, graph, insert, options, toast });
  useEffect(() => {
    latest.current = { canEdit, graph, insert, options, toast };
  });

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const { canEdit, graph, insert, options, toast } = latest.current;
      if (!canEdit || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isTypingTarget(target as HTMLElement | null) || target?.closest("dialog")) return;

      // Anything that is not one of our envelopes — a shopping list, a URL — is not ours
      // to refuse, so it is left alone without a word.
      const envelope = parseEnvelope(event.clipboardData?.getData("text/plain") ?? "");
      if (!envelope) return;
      event.preventDefault();

      const plan = planPaste(graph, envelope, options(true));
      if (!plan.ok) {
        toast({ tone: "warn", title: "Nothing was pasted", detail: plan.reason, duration: null });
        return;
      }
      insert(plan.nodes, plan.edges, plan.notes);
      if (plan.note) {
        toast({ tone: "warn", title: `Pasted ${what(plan.nodes.length, plan.notes.length)}`, detail: plan.note });
      }
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return { copy, cut, duplicate };
}
