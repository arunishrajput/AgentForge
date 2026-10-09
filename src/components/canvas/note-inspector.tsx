"use client";

import { useId } from "react";

import { Labelled, Textarea } from "@/components/ui/field";
import { cn } from "@/components/ui/cn";
import type { CanvasNote, CanvasNoteData } from "@/lib/canvas/bridge";
import { NOTE_TONE_ORDER, noteLook } from "@/lib/canvas/notes";
import { NOTE_TEXT_MAX } from "@/lib/workflow/graph";

/** "2,000" — grouped by hand, not `toLocaleString`, which can differ between server and browser (#418). */
const GROUPED_MAX = String(NOTE_TEXT_MAX).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * The inspector for one selected sticky note — Phase 30.
 *
 * **The keyboard path to a note.** On the canvas a note is edited by double-clicking it;
 * here the same text is a field, reached by selecting the note — Tab to it, Enter — so a
 * person who never touches a pointer can still write one. The two are the same value: a
 * keystroke in either is a change to the graph, and the history folds a run of them into one
 * step of undo.
 *
 * The tone is a radio group of swatches built like the theme switch (`ui/theme.tsx`): real
 * radio inputs, visually hidden, so the arrow keys move and choose, and a screen reader hears
 * each tone's name. The chosen swatch carries a tick as well as being pressed in, so the
 * choice is never shown by colour alone.
 */
export function NoteInspector({
  note,
  readOnly,
  onChange,
  onDelete,
}: {
  note: CanvasNote;
  readOnly: boolean;
  onChange: (id: string, patch: Partial<CanvasNoteData>) => void;
  onDelete: (id: string) => void;
}) {
  const look = noteLook(note.data.tone);
  const group = useId();

  return (
    <>
      {/* The object, stated — in the note's own fill, as a node's header wears its category. */}
      <div
        className={cn(
          "border-line text-accent-ink flex shrink-0 items-center gap-2 border-b-2 px-3 py-2",
          look.fill,
        )}
      >
        <span className="text-3xs truncate font-bold tracking-wide uppercase">Sticky note</span>
        <span className="ml-auto shrink-0 font-mono text-3xs">{note.id}</span>
      </div>

      <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3.5">
        <p className="text-muted text-2xs leading-relaxed text-pretty">
          A note is for people. A run never reads it, an agent never sees it, and a share link
          shows that it is there but not what it says.
        </p>

        {readOnly && (
          <p className="text-faint text-2xs text-pretty">You can read this note and not change it.</p>
        )}

        <fieldset disabled={readOnly} className="min-w-0 space-y-4 border-0 p-0">
          <Labelled label="Text" hint={`Plain text, up to ${GROUPED_MAX} characters.`}>
            <Textarea
              value={note.data.text}
              rows={8}
              maxLength={NOTE_TEXT_MAX}
              onChange={(event) => onChange(note.id, { text: event.target.value })}
            />
          </Labelled>

          <fieldset className="min-w-0 border-0 p-0">
            <legend className="text-ui mb-1.5 font-semibold">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {NOTE_TONE_ORDER.map((tone) => {
                const swatch = noteLook(tone);
                const checked = note.data.tone === tone;
                return (
                  <label
                    key={tone}
                    title={swatch.label}
                    className={cn(
                      "focus-ring-within border-line text-accent-ink grid size-9 cursor-pointer place-items-center rounded-lg border-2 transition-[translate,box-shadow]",
                      swatch.fill,
                      checked ? "translate-x-[2px] translate-y-[2px] shadow-(--shadow-press)" : "shadow-flat",
                    )}
                  >
                    <input
                      type="radio"
                      name={group}
                      value={tone}
                      checked={checked}
                      onChange={() => onChange(note.id, { tone })}
                      className="sr-only"
                    />
                    <span aria-hidden="true" className="text-sm leading-none font-bold">
                      {checked ? "✓" : ""}
                    </span>
                    <span className="sr-only">{swatch.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </fieldset>
      </div>

      {!readOnly && (
        <footer className="border-line shrink-0 border-t-2 px-3 py-2.5">
          <button type="button" onClick={() => onDelete(note.id)} className="btn btn-danger w-full">
            Delete note
          </button>
        </footer>
      )}
    </>
  );
}
