"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { CanvasNode } from "@/lib/canvas/bridge";

import { CATEGORY_STYLE, STATUS_STYLE, useCanvas } from "./context";

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
 */
export function WorkflowNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const { registry, runStates } = useCanvas();
  const definition = registry.get(data.nodeType);
  const state = runStates.get(id);
  const category = CATEGORY_STYLE[definition?.category ?? ""] ?? {
    label: "Unknown",
    dot: "bg-red-400",
    ring: "ring-red-400/40",
  };

  const outputs = definition?.outputs ?? [{ key: null, label: "Out" }];
  const isTrigger = definition?.kind === "trigger";

  return (
    <div
      className={`bg-surface w-56 rounded-xl border border-white/10 shadow-lg ring-2 transition-shadow ${
        selected ? category.ring : "ring-transparent"
      } ${state?.status === "failed" ? "ring-red-400/60" : ""}`}
    >
      {/* A trigger starts the run, so nothing may connect into it (validateGraph
          enforces the same rule server-side). Omitting the handle stops the user
          drawing an edge that would only come back as a problem. */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-2 !border-white/30 !bg-canvas"
        />
      )}

      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${category.dot}`} />
        <span className="truncate text-sm font-medium">
          {data.label || definition?.label || data.nodeType}
        </span>
      </div>

      <div className="space-y-2 px-3 py-2">
        <p className="text-muted truncate font-mono text-[11px]">{data.nodeType}</p>

        {!definition && (
          <p className="text-[11px] text-red-300">
            Unknown node type — this workflow cannot run.
          </p>
        )}

        {state && (
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${STATUS_STYLE[state.status].className}`}
            >
              {STATUS_STYLE[state.status].label}
            </span>
            {state.executions > 1 && (
              <span className="text-muted text-[10px]">×{state.executions}</span>
            )}
            {state.branch && (
              <span className="text-muted font-mono text-[10px]">→ {state.branch}</span>
            )}
          </div>
        )}

        {state?.error && (
          <p className="line-clamp-2 text-[11px] text-red-300">{state.error}</p>
        )}
      </div>

      {/* One labelled row per declared output, each with its handle centred on it.
          Even a single default output gets a row, so the connection point is always
          where the label says it is rather than at the bottom edge of the card. */}
      <div className="border-t border-white/10">
        {outputs.map((output) => (
          <div
            key={output.key ?? "default"}
            className="relative flex h-7 items-center justify-end pr-3"
          >
            <span className="text-muted text-[10px]">{output.label}</span>
            <Handle
              // `undefined` for the default output, so React Flow reports null.
              id={output.key ?? undefined}
              type="source"
              position={Position.Right}
              data-output={output.key ?? "default"}
              className={`!h-3 !w-3 !border-2 !border-white/30 ${
                output.key === "true" || output.key === "loop"
                  ? "!bg-emerald-400"
                  : output.key === "false"
                    ? "!bg-red-400"
                    : "!bg-canvas"
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
