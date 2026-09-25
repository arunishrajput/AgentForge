"use client";

import type { NodeSummary } from "@/lib/canvas/client";

import { CATEGORY_ORDER, CATEGORY_STYLE } from "./context";

/**
 * The node palette, built entirely from `GET /api/nodes`.
 *
 * Nothing here knows the name of a single node type. Phases 8 and 9 add entries to
 * the registry and they appear in this list with their config forms, with no UI
 * change — which is the whole reason the registry is the spine (ARCHITECTURE.md).
 *
 * Adding is a click rather than a drag: it places the node in clear space on the
 * canvas, works on any input device, and has no drop-target failure mode on the
 * demo path.
 */
export function Palette({
  nodes,
  onAdd,
  disabled,
}: {
  nodes: NodeSummary[];
  onAdd: (node: NodeSummary) => void;
  disabled?: boolean;
}) {
  const categories = [...new Set(nodes.map((node) => node.category))].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
  );

  return (
    <aside className="bg-canvas flex w-60 shrink-0 flex-col border-r border-white/10">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-medium">Nodes</h2>
        <p className="text-muted mt-0.5 text-[11px]">Click to add to the canvas</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {categories.map((category) => {
          const style = CATEGORY_STYLE[category] ?? {
            label: category,
            dot: "bg-muted",
            ring: "",
          };
          return (
            <section key={category} className="mb-4">
              <h3 className="text-muted px-2 pb-1.5 text-[11px] font-medium tracking-wide uppercase">
                {style.label}
              </h3>
              <ul className="space-y-1">
                {nodes
                  .filter((node) => node.category === category)
                  .map((node) => (
                    <li key={node.type}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onAdd(node)}
                        title={node.description}
                        className="hover:bg-surface flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-40"
                      >
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px]">{node.label}</span>
                          <span className="text-muted line-clamp-2 block text-[11px]">
                            {node.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
