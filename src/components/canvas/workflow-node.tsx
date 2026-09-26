"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { CanvasNode } from "@/lib/canvas/bridge";

import {
  CATEGORY_STYLE,
  STATUS_STYLE,
  UNKNOWN_CATEGORY_STYLE,
  useCanvas,
} from "./context";

/**
 * The one node component on the canvas. Everything it draws comes from the
 * registry entry for `data.nodeType` — label, category accent, and one source
 * handle per declared output.
 *
 * **The handle ids are contract.** React Flow reports the handle a connection left
 * from as `sourceHandle`, and the engine follows edges by matching that against
 * the node definition's `outputs[].key`. So the id here must be exactly that key,
 * and the default output (`key: null`) must have *no* id at all — React Flow then
 * reports `null`, which is what the stored graph uses.
 *
 * Phase 10's motion lives here and is all opacity and transform, never layout:
 * a card on a canvas of thirty nodes cannot afford a reflow per frame.
 *
 *  - **Entry** is a staggered `rise`, delayed by the node's position in the graph as
 *    first loaded, so a generated workflow assembles itself left to right instead of
 *    appearing all at once (`DEMO.md` Beat 3). A node added by clicking the palette
 *    has no entry in `entryOrder` and so no delay.
 *  - **Running** draws a breathing ring as a separate absolutely-positioned overlay,
 *    so the pulse animates one element's opacity rather than the card's box-shadow.
 *  - **A status change** remounts the badge via `key`, which is what replays its pop.
 *    Without the key the element persists and the animation never runs again.
 */

/** Per-node stagger. Capped so a 20-node graph does not take four seconds to land. */
const STAGGER_MS = 55;
const STAGGER_CAP_MS = 660;

export function WorkflowNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const { registry, runStates, entryOrder } = useCanvas();
  const definition = registry.get(data.nodeType);
  const state = runStates.get(id);
  const category = definition
    ? CATEGORY_STYLE[definition.category] ?? UNKNOWN_CATEGORY_STYLE
    : UNKNOWN_CATEGORY_STYLE;

  const outputs = definition?.outputs ?? [{ key: null, label: "Out" }];
  const isTrigger = definition?.kind === "trigger";

  const delayMs = Math.min((entryOrder.get(id) ?? 0) * STAGGER_MS, STAGGER_CAP_MS);

  return (
    <div
      style={{ animationDelay: `${delayMs}ms` }}
      className={`animate-rise bg-elevated shadow-node relative w-56 rounded-xl border transition-[border-color,box-shadow] duration-200 ${
        state?.status === "failed"
          ? "border-bad/60"
          : selected
            ? "border-accent/70"
            : "border-line"
      } ${selected ? `ring-2 ${category.ring}` : ""}`}
    >
      {/* The running pulse. An overlay rather than a box-shadow on the card, so the
          animation touches opacity only and stays on the compositor. */}
      {state?.status === "running" && (
        <span
          aria-hidden="true"
          className="animate-breathe ring-live pointer-events-none absolute -inset-px rounded-xl ring-2"
        />
      )}

      {/* A trigger starts the run, so nothing may connect into it (validateGraph
          enforces the same rule server-side). Omitting the handle stops the user
          drawing an edge that would only come back as a problem. */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-canvas !border-line-strong !h-3 !w-3 !border-2"
        />
      )}

      <div className="border-line flex items-center gap-2 border-b px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${category.dot}`} />
        <span className="truncate text-sm font-medium">
          {data.label || definition?.label || data.nodeType}
        </span>
      </div>

      <div className="space-y-2 px-3 py-2">
        <p className="text-muted truncate font-mono text-2xs">{data.nodeType}</p>

        {!definition && (
          <p className="text-bad text-2xs">
            Unknown node type — this workflow cannot run.
          </p>
        )}

        {state && (
          <div className="flex items-center gap-1.5">
            <span
              key={state.status}
              className={`chip animate-pop ${STATUS_STYLE[state.status].className}`}
            >
              {STATUS_STYLE[state.status].label}
            </span>
            {state.executions > 1 && (
              <span className="text-muted text-3xs">×{state.executions}</span>
            )}
            {state.branch && (
              <span className="text-muted font-mono text-3xs">→ {state.branch}</span>
            )}
          </div>
        )}

        {state?.error && (
          <p className="text-bad line-clamp-2 text-2xs">{state.error}</p>
        )}
      </div>

      {/* One labelled row per declared output, each with its handle centred on it.
          Even a single default output gets a row, so the connection point is always
          where the label says it is rather than at the bottom edge of the card. */}
      <div className="border-line border-t">
        {outputs.map((output) => (
          <div
            key={output.key ?? "default"}
            className="relative flex h-7 items-center justify-end pr-3"
          >
            <span className="text-muted text-3xs">{output.label}</span>
            <Handle
              // `undefined` for the default output, so React Flow reports null.
              id={output.key ?? undefined}
              type="source"
              position={Position.Right}
              data-output={output.key ?? "default"}
              className={`!border-line-strong !h-3 !w-3 !border-2 ${
                output.key === "true" || output.key === "loop"
                  ? "!bg-ok"
                  : output.key === "false"
                    ? "!bg-bad"
                    : "!bg-canvas"
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
