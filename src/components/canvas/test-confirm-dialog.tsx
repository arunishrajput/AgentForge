"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * **"This will post to Slack" — Phase 31.** Before a test of part of a workflow reaches a step
 * that acts outside the product, the author is told which steps, and what each will do, and
 * chooses. A test is the moment somebody is least expecting a real message to go out, which is
 * why this asks and a full Run does not.
 *
 * The list comes from `planTest` (`lib/engine/partial.ts`), the arithmetic the engine itself
 * uses, so it names exactly what will execute. It covers both sides of any branch on the way,
 * which is the right reading for a warning.
 */
export function TestConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { title: string; effects: { name: string; does: string }[]; aimedOnly: boolean } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = pending?.effects.length ?? 0;
  return (
    <Dialog
      open={pending !== null}
      onClose={onCancel}
      title={pending?.title ?? "Run this test?"}
      description={
        count === 1
          ? "One step in this test acts outside AgentForge, and a test runs it for real."
          : `${count} steps in this test act outside AgentForge, and a test runs them for real.`
      }
      footer={
        <>
          <Button tone="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button tone="primary" onClick={onConfirm}>
            Run the test
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
        {pending?.effects.map((effect) => (
          <li key={effect.name} className="card px-3 py-2">
            <span className="text-ui block font-bold">{effect.name}</span>
            <span className="text-muted text-2xs">This will {effect.does}.</span>
          </li>
        ))}
      </ul>
      <p className="text-muted mt-3 text-2xs leading-relaxed">
        {pending?.aimedOnly
          ? "The step being tested always runs, even when it holds a pinned output — the pin is for the steps after it."
          : `To test without sending anything, pin ${count === 1 ? "that step's" : "those steps'"} output first — a test uses a pinned output instead of running the step.`}
      </p>
    </Dialog>
  );
}
