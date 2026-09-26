"use client";

import type { NodeSummary } from "@/lib/canvas/client";

import { CATEGORY_ORDER, CATEGORY_STYLE } from "./context";

/**
 * The node palette, built entirely from `GET /api/nodes`.
 *
 * Nothing here knows the name of a single node type. Phases 8 and 9 added six entries
 * to the registry and they appeared in this list with their config forms, with no UI
 * change — which is the whole reason the registry is the spine (ARCHITECTURE.md), and
 * Phase 10 is the phase that must not be the one to break it. The only thing this
 * component reads per category is a colour token from `CATEGORY_STYLE`, which falls
 * back to the category's own name for a group it has never heard of.
 *
 * Adding is a click rather than a drag: it places the node in clear space on the
 * canvas, works on any input device, and has no drop-target failure mode on the
 * demo path.
 *
 * Below `lg` this is a drawer over the canvas rather than a column beside it. It is
 * always rendered and CSS decides which — `max-lg:invisible` rather than a JS
 * viewport check, so the closed drawer is out of the tab order and there is nothing
 * to mismatch on the server render.
 */
export function Palette({
  id,
  nodes,
  onAdd,
  disabled,
  open,
  onClose,
}: {
  id: string;
  nodes: NodeSummary[];
  onAdd: (node: NodeSummary) => void;
  disabled?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const categories = [...new Set(nodes.map((node) => node.category))].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
  );

  return (
    <aside
      id={id}
      aria-label="Node palette"
      className={`border-line bg-canvas flex w-60 shrink-0 flex-col border-r transition-[transform,visibility] duration-200 ease-out max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:w-[min(17rem,82vw)] max-lg:shadow-drawer lg:visible lg:translate-x-0 ${
        open ? "max-lg:translate-x-0" : "max-lg:invisible max-lg:-translate-x-full"
      }`}
    >
      <div className="border-line flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Nodes</h2>
          <p className="text-muted mt-0.5 text-2xs">Click to add to the canvas</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost -mr-1 shrink-0 px-2 lg:hidden"
        >
          <span aria-hidden="true">✕</span>
          <span className="sr-only">Close palette</span>
        </button>
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
              <h3 className="eyebrow px-2 pb-1.5">{style.label}</h3>
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
                        className="hover:bg-surface flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-100 hover:translate-x-0.5 disabled:opacity-40 disabled:hover:translate-x-0"
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-ui">{node.label}</span>
                          {/* `line-clamp-2` sets `display: -webkit-box` itself, so
                              pairing it with `block` is a coin toss over which
                              `display` Tailwind emits last — and the toss was lost,
                              which is why every description used to render in full. */}
                          <span className="text-muted line-clamp-2 text-2xs">
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
