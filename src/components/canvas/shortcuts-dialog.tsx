"use client";

import { Fragment } from "react";

import { Dialog } from "@/components/ui/dialog";
import { Keys } from "@/components/ui/kbd";
import { SHORTCUT_GROUPS, SHORTCUTS } from "@/lib/canvas/shortcuts";
import type { Platform } from "@/lib/ui/keys";

/**
 * The `?` dialog — every canvas shortcut, for the reader's keyboard (Phase 29).
 *
 * Rendered from the same table the key handler matches against
 * (`lib/canvas/shortcuts.ts`), so it cannot promise a key that does nothing. Reachable
 * three ways, because a list of shortcuts that needs a shortcut to find is a riddle: the
 * `?` key, the `?` button in the canvas controls, and *Keyboard shortcuts* in ⌘K.
 *
 * The quiet register (`DESIGN.md`): a reference card, plain rows on paper. A definition
 * list per group — the action is the term, the keys are its definition — so a screen
 * reader hears "Undo, Command Z" in that order.
 */
export function ShortcutsDialog({
  open,
  onClose,
  platform,
}: {
  open: boolean;
  onClose: () => void;
  platform: Platform;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="None of these fire while you are typing in a field — except Save."
      className="w-[min(36rem,calc(100vw-2rem))]"
    >
      <div className="space-y-5">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group}>
            <h3 className="eyebrow mb-2">{group}</h3>
            <dl className="divide-line-soft divide-y">
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.id} className="flex items-center justify-between gap-4 py-1.5">
                  <dt className="text-ui min-w-0">{shortcut.title}</dt>
                  <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {shortcut.chords.map((chord, index) => (
                      <Fragment key={`${chord.mod ? "mod+" : ""}${chord.shift === true ? "shift+" : ""}${chord.key}`}>
                        {index > 0 && <span className="text-faint text-2xs">or</span>}
                        <Keys chord={chord} platform={platform} />
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
