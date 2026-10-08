"use client";

import { useState } from "react";

import { Labelled, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/components/ui/cn";
import type { CanvasNode } from "@/lib/canvas/bridge";
import type { NodeSummary, Run, TestScope } from "@/lib/canvas/client";
import { nodeStatusLook } from "@/lib/canvas/status";
import { canPin } from "@/lib/engine/partial";
import type { ManualField } from "@/lib/nodes/core/manual-trigger";
import { jsonBytes, PIN_MAX_BYTES, valuesEqual } from "@/lib/workflow/graph";

import { RunInput } from "./run-input";

/** What the run will be started with — the same form the workflow panel shows. */
export interface RunInputFacts {
  fields: ManualField[];
  pinnedTrigger: boolean;
  value: string;
  onChange: (value: string) => void;
}

/**
 * **The test loop, in the node's own panel — Phase 31.** Three things an author building a
 * workflow step by step reaches for, in the order they reach for them:
 *
 *  1. **Test** — run this node alone, or the way from the trigger to it;
 *  2. **Output** — what this node produced in the run on screen, and *pin this output*;
 *  3. **Pinned output** — the fixed value a test uses instead of running the node: read it,
 *     edit it as JSON, unpin it.
 *
 * In the node's panel rather than the run panel, because the loop is *change this node's
 * config, test it, look at what it made* — and leaving the node to read its result breaks it.
 * Selecting stays put through a test for the same reason (`editor.tsx` → `prepare`).
 *
 * The inspector says, every time a pin is on screen, that **only a test uses it**: a webhook or
 * a schedule runs the node for real (`CONTRACT.md` → *Pinned output*).
 */
export function NodeTestPanel({
  node,
  definition,
  run,
  canRun,
  readOnly,
  runInput,
  onTest,
  onPin,
}: {
  node: CanvasNode;
  definition: NodeSummary | undefined;
  /** The run on screen, whatever started it. */
  run: Run | null;
  canRun: boolean;
  readOnly: boolean;
  /**
   * The run's input, when the manual trigger asks for some — *test up to here* runs the trigger,
   * so the form it needs is here too, not only in the workflow panel (found in the browser: with
   * a node selected the form was out of reach). A node tested alone does not use it.
   */
  runInput: RunInputFacts;
  onTest: (scope: Exclude<TestScope, "workflow">, nodeId: string) => void;
  /** `undefined` unpins. Answers false when the pin was refused for its size. */
  onPin: (nodeId: string, output: unknown) => boolean;
}) {
  const trigger = definition?.kind === "trigger";
  const pinnable = canPin(definition);
  const off = node.data.disabled === true;

  // The latest pass of this node in the run on screen — a looped node has several.
  const step = (run?.steps ?? []).findLast((candidate) => candidate.nodeId === node.id);
  const pin = node.data.pinned;

  return (
    <>
      {!readOnly && !trigger && (
        <section className="space-y-2" aria-labelledby={`test-${node.id}`}>
          <h3 id={`test-${node.id}`} className="eyebrow">
            Test
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!canRun || off}
              onClick={() => onTest("node", node.id)}
              className="btn btn-quiet"
            >
              Test this node
            </button>
            <button
              type="button"
              disabled={!canRun || off}
              onClick={() => onTest("path", node.id)}
              className="btn btn-quiet"
            >
              Test up to here
            </button>
          </div>
          <p className="text-muted text-2xs leading-relaxed text-pretty">
            {off
              ? "Switched off — switch it on to test it."
              : "This node alone is fed from the steps before it: their pinned output, or what they produced last time. Up to here runs from the trigger and stops at this node. Either is labelled a test and left out of analytics."}
          </p>
          {!off && runInput.fields.length > 0 && !runInput.pinnedTrigger && (
            <RunInput
              fields={runInput.fields}
              value={runInput.value}
              onChange={runInput.onChange}
              pinnedTrigger={false}
            />
          )}
        </section>
      )}

      {step && step.status !== "skipped" && (
        <StepOutput
          step={step}
          pinnable={pinnable && !readOnly}
          pinnedAlready={pin !== undefined && valuesEqual(pin.output, step.output)}
          agent={definition?.category === "agent"}
          onPin={() => onPin(node.id, step.output)}
        />
      )}

      {pinnable && <PinnedOutput nodeId={node.id} pin={pin} readOnly={readOnly} onPin={onPin} />}
    </>
  );
}

function size(value: unknown): string {
  const bytes = jsonBytes(value);
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    // Height-capped, because a pin may be 32 KB. A scroller with no focusable content inside
    // is keyboard-focusable by itself in current browsers, so it needs no tabIndex.
    <pre
      aria-label={label}
      className="bg-sunken border-line max-h-56 overflow-auto rounded-lg border-2 p-2.5 font-mono text-2xs leading-relaxed"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StepOutput({
  step,
  pinnable,
  pinnedAlready,
  agent,
  onPin,
}: {
  step: NonNullable<Run["steps"]>[number];
  pinnable: boolean;
  pinnedAlready: boolean;
  agent: boolean;
  onPin: () => void;
}) {
  const look = nodeStatusLook(step.status, agent);
  const finished = step.status === "succeeded";

  return (
    <section className="space-y-2" aria-labelledby={`output-${step.nodeId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`output-${step.nodeId}`} className="eyebrow">
          Output
        </h3>
        <span className={cn("chip", look.tone)}>
          <span aria-hidden="true" className="leading-none font-bold">
            {look.glyph || "…"}
          </span>
          {look.label}
        </span>
        {finished && <span className="text-muted font-mono text-3xs">{size(step.output)}</span>}
      </div>

      {step.error ? (
        <p className="text-bad text-2xs leading-relaxed">{step.error}</p>
      ) : step.status === "running" ? (
        <p className="text-muted text-2xs">Still running.</p>
      ) : (
        <JsonBlock value={step.output} label="This node's output in the run on screen" />
      )}

      {pinnable && finished && (
        <button
          type="button"
          onClick={onPin}
          disabled={pinnedAlready}
          className="btn btn-quiet w-full"
        >
          {pinnedAlready ? "This output is pinned" : "Pin this output"}
        </button>
      )}
    </section>
  );
}

function PinnedOutput({
  nodeId,
  pin,
  readOnly,
  onPin,
}: {
  nodeId: string;
  pin: { output: unknown } | undefined;
  readOnly: boolean;
  onPin: (nodeId: string, output: unknown) => boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const parsed = (() => {
    if (draft === null) return { ok: false as const, error: null };
    if (draft.trim() === "") return { ok: false as const, error: "Type the JSON to pin." };
    try {
      const value: unknown = JSON.parse(draft);
      const bytes = jsonBytes(value);
      return bytes > PIN_MAX_BYTES
        ? { ok: false as const, error: `${Math.ceil(bytes / 1024)} KB — a pinned output can be at most ${PIN_MAX_BYTES / 1024} KB.` }
        : { ok: true as const, value, error: null };
    } catch {
      return { ok: false as const, error: "Not valid JSON yet." };
    }
  })();

  if (!pin && draft === null) {
    if (readOnly) return null;
    return (
      <section className="space-y-2">
        <h3 className="eyebrow">Pinned output</h3>
        <p className="text-muted text-2xs leading-relaxed text-pretty">
          Pin an output and a test uses it instead of running this node — so nothing is sent or
          called while you build what comes after it.
        </p>
        <button type="button" onClick={() => setDraft("{\n  \n}")} className="btn btn-quiet w-full">
          Pin JSON…
        </button>
      </section>
    );
  }

  if (draft !== null) {
    return (
      <section className="space-y-2">
        <h3 className="eyebrow">Pinned output</h3>
        <Labelled label="Output to pin, as JSON" error={parsed.error ?? undefined}>
          <Textarea
            value={draft}
            rows={6}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono text-2xs"
          />
        </Labelled>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setDraft(null)} className="btn btn-quiet">
            Cancel
          </button>
          <button
            type="button"
            disabled={!parsed.ok}
            onClick={() => {
              if (parsed.ok && onPin(nodeId, parsed.value)) setDraft(null);
            }}
            className="btn btn-primary"
          >
            Pin
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="eyebrow">Pinned output</h3>
        <span className="text-muted font-mono text-3xs">
          {size(pin!.output)} of {PIN_MAX_BYTES / 1024} KB
        </span>
      </div>
      <Notice tone="info" title="Tests use this instead of running the node">
        Run and the test buttons hand this on without calling anything. A webhook or a schedule
        still runs the node for real.
      </Notice>
      <JsonBlock value={pin!.output} label="The pinned output" />
      {!readOnly && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDraft(JSON.stringify(pin!.output, null, 2))}
            className="btn btn-quiet"
          >
            Edit
          </button>
          <button type="button" onClick={() => onPin(nodeId, undefined)} className="btn btn-quiet">
            Unpin
          </button>
        </div>
      )}
    </section>
  );
}
