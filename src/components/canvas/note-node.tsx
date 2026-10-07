"use client";

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useEffect, useRef } from "react";

import { cn } from "@/components/ui/cn";
import type { CanvasNote } from "@/lib/canvas/bridge";
import { changeLook, fieldWords } from "@/lib/canvas/changes";
import { noteLook } from "@/lib/canvas/notes";
import { NOTE_SIZE, NOTE_TEXT_MAX } from "@/lib/workflow/graph";

import { useCanvas } from "./context";

/**
 * A sticky note on the canvas — Phase 30.
 *
 * **An object like every other object in this language**: a `-pop` fill, an `accent-ink`
 * label at full strength and a 2px ink outline with the hard shadow — `DESIGN.md`'s rule for
 * a fill, all three parts — so it reads in both themes on the gates' own terms (D126). It
 * sits behind the nodes (`zIndex: -1`, `bridge.ts`) and lifts when selected, like a card.
 *
 * **Plain text, always.** The text is a React text child, which React escapes; nothing here
 * or anywhere else renders a note as HTML or Markdown, so there is no markup a note can
 * carry — not even to a reader of a share link, who never receives the text at all.
 *
 * Editing is in place: **double-click** to type, Escape or a click away to stop. The
 * keyboard path is the inspector, which opens on a selected note with the same text in a
 * field. Each keystroke is a change to the graph, coalesced by the history into one step of
 * undo per pause (`history.ts`, `note:<id>`).
 */
export function NoteView({ id, data, selected }: NodeProps<CanvasNote>) {
  const { notes, noteDiffStates } = useCanvas();
  const look = noteLook(data.tone);

  // In diff mode the change owns the outline, exactly as on a node card.
  const diff = noteDiffStates.get(id);
  const change = diff ? changeLook(diff.change) : null;
  const removed = diff?.change === "removed";

  const editable = notes.editable && !change;
  const editing = editable && notes.editing === id;
  const withheld = notes.withheld.has(id);

  return (
    // The note fills the box React Flow sizes from its stored width and height.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- double-click is the pointer shortcut; the inspector is the keyboard path
    <div
      onDoubleClick={(event) => {
        if (!editable) return;
        // The canvas zooms on a double-click; on a note it means "write here".
        event.stopPropagation();
        notes.setEditing(id);
      }}
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-xl border-2 transition-[box-shadow,translate] duration-200",
        // A removed note is not in the newer workflow: recessed and dashed like a removed
        // card, and so not a fill — its words are ink, never `accent-ink` off a fill.
        removed ? cn(change?.surface, "text-ink") : cn(look.fill, "text-accent-ink"),
        change ? change.outline : "border-line",
        selected ? "shadow-lift -translate-x-px -translate-y-px" : (change?.shadow ?? "shadow-node"),
      )}
    >
      <NodeResizer
        isVisible={selected && editable && !editing}
        minWidth={NOTE_SIZE.minWidth}
        maxWidth={NOTE_SIZE.maxWidth}
        minHeight={NOTE_SIZE.minHeight}
        maxHeight={NOTE_SIZE.maxHeight}
        handleClassName="note-handle"
        lineClassName="note-line"
      />

      {change?.ribbon && (
        <div
          className={cn(
            "border-line flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-1",
            change.fill,
            change.ink,
          )}
        >
          <span aria-hidden="true" className="text-2xs leading-none font-bold">
            {change.glyph}
          </span>
          <span className="text-3xs font-bold tracking-wide uppercase">{change.label}</span>
          {diff && diff.fields.length > 0 && (
            <span className="text-3xs ml-auto truncate font-medium">{fieldWords(diff.fields)}</span>
          )}
        </div>
      )}

      {editing ? (
        <NoteEditor
          text={data.text}
          onChange={(text) => notes.change(id, { text })}
          onDone={() => notes.setEditing(null)}
        />
      ) : withheld ? (
        <p className="flex-1 px-3 py-2.5 text-xs leading-snug font-medium italic">
          <span aria-hidden="true">⊘ </span>A note — its text is not shared on this link.
        </p>
      ) : data.text === "" ? (
        editable && (
          <p className="flex-1 px-3 py-2.5 text-xs leading-snug italic">Double-click to write a note.</p>
        )
      ) : (
        <p className="flex-1 px-3 py-2.5 text-sm leading-snug break-words whitespace-pre-wrap">
          {data.text}
        </p>
      )}
    </div>
  );
}

/**
 * The note's text, being typed. `nodrag nowheel nopan` so selecting text, scrolling and
 * pressing keys stay the field's rather than the canvas's; every canvas shortcut already
 * stands aside for a textarea (`isTypingTarget`), as do React Flow's own Delete and arrows.
 */
function NoteEditor({
  text,
  onChange,
  onDone,
}: {
  text: string;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);

  // The caret goes at the end, so a double-click on a note continues it rather than
  // selecting a word the person then types over.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  return (
    <textarea
      ref={field}
      aria-label="Note text"
      value={text}
      maxLength={NOTE_TEXT_MAX}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onDone}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Done typing, not "close a panel": the editor's own Escape would do that too.
          event.stopPropagation();
          onDone();
        }
      }}
      placeholder="Write a note for whoever reads this workflow."
      className="nodrag nowheel nopan placeholder:text-accent-ink min-h-0 flex-1 resize-none rounded-[0.625rem] bg-transparent px-3 py-2.5 text-sm leading-snug placeholder:italic"
    />
  );
}
