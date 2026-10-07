"use client";

import { useMemo, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import { categoryLook } from "@/lib/canvas/categories";
import type { NodeSummary } from "@/lib/canvas/client";
import { groupNodes, rankNodes } from "@/lib/canvas/palette-search";

import { NodeIcon } from "./node-icon";
import { Panel } from "./panel";

/**
 * The node palette, built entirely from `GET /api/nodes`.
 *
 * Nothing here knows the name of a single node type. Phases 8 and 9 added six
 * entries to the registry and they appeared in this list with their config forms and
 * no UI change, which is the whole reason the registry is the spine
 * (`ARCHITECTURE.md`). Phase 16 keeps that: the only things read per node are its
 * category's look and its icon, and both fall back rather than fail.
 *
 * **Browsable *and* searchable**, which `BUILD_PLAN.md` Phase 16 asks for in place of
 * "a long list". Those are two different jobs and the palette does both:
 *
 *   no query   grouped by category, in reading order, headings visible. A menu.
 *   a query    one flat list in rank order, each row tagged with its category so
 *              the grouping is not simply lost. A search.
 *
 * The ranking is the command palette's, reused — see `lib/canvas/palette-search.ts`
 * for why, and for the reason searching `gmail` finds a node labelled "Send email".
 *
 * Adding is a **click**, not a drag: it places the node in clear space on the canvas,
 * works on any input device, and has no drop-target failure mode. Pressing Enter in
 * the search box adds the top match, so "gmail⏎" is the whole interaction for
 * someone who knows what they want.
 */
export function Palette({
  id,
  nodes,
  onAdd,
  disabled,
  open,
  collapsed,
  onClose,
  onExpand,
  onCollapse,
}: {
  id: string;
  nodes: NodeSummary[];
  onAdd: (node: NodeSummary) => void;
  disabled?: boolean;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => rankNodes(nodes, query), [nodes, query]);
  const groups = useMemo(() => groupNodes(matches), [matches]);
  const searching = query.trim() !== "";

  const add = (node: NodeSummary) => {
    if (!disabled) onAdd(node);
  };

  return (
    <Panel
      id={id}
      side="left"
      title="Nodes"
      width="lg:w-60"
      open={open}
      collapsed={collapsed}
      onClose={onClose}
      onExpand={onExpand}
      onCollapse={onCollapse}
      header={
        <span className="chip text-muted shrink-0">
          {matches.length}
          <span className="sr-only"> nodes {searching ? "found" : "available"}</span>
        </span>
      }
    >
      <form
        // Enter adds the top match. `onSubmit` rather than a key handler so the
        // browser's own "this field submits" behaviour is what runs it.
        onSubmit={(event) => {
          event.preventDefault();
          const first = matches[0];
          if (first) add(first);
        }}
        className="border-line shrink-0 border-b-2 px-3 py-2.5"
      >
        <label className="block">
          <span className="sr-only">Search nodes</span>
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="Search nodes…"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape clears the box first and closes the drawer second. Stopping
              // the event only when there is something to clear is what keeps the
              // editor's Escape-closes-the-panel behaviour reachable.
              if (event.key === "Escape" && query !== "") {
                event.stopPropagation();
                setQuery("");
              }
            }}
            className="field text-2xs"
          />
        </label>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5">
        {matches.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-ui font-bold">No node matches that.</p>
            <p className="text-muted mt-1 text-2xs">
              Search a name, a type like <code className="font-mono">core.set</code>, or
              a service.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                search.current?.focus();
              }}
              className="btn btn-quiet mt-3"
            >
              Clear search
            </button>
          </div>
        ) : searching ? (
          // Ranked, flat. Grouping a three-item result into three headed sections
          // costs more vertical space than it explains, and reorders the ranking.
          <ul className="space-y-1">
            {matches.map((node) => (
              <NodeRow key={node.type} node={node} disabled={disabled} onAdd={add} tagged />
            ))}
          </ul>
        ) : (
          groups.map((group) => (
            <section key={group.category} className="mb-3.5 last:mb-0">
              <h3 className="eyebrow px-2 pb-1.5">{group.look.label}</h3>
              <ul className="space-y-1">
                {group.nodes.map((node) => (
                  <NodeRow key={node.type} node={node} disabled={disabled} onAdd={add} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Panel>
  );
}

/**
 * One row. The **icon tile** is the outlined, pop-filled object — the row itself is
 * not. Fifteen outlined buttons in a 240px column read as a fence
 * (`DESIGN.md` → `btn-ghost`), so the character sits in the tile and the row gets a
 * hover fill and a small shift instead.
 */
function NodeRow({
  node,
  disabled,
  onAdd,
  tagged = false,
}: {
  node: NodeSummary;
  disabled?: boolean;
  onAdd: (node: NodeSummary) => void;
  /** Show the category as a word. Only while searching, where the headings are gone. */
  tagged?: boolean;
}) {
  const look = categoryLook(node.category);

  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAdd(node)}
        className={cn(
          "hover:bg-surface flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-[background-color,transform] duration-100",
          "hover:translate-x-0.5 disabled:opacity-40 disabled:hover:translate-x-0",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "border-line text-accent-ink grid size-7 shrink-0 place-items-center rounded-lg border-2",
            look.fill,
          )}
        >
          <NodeIcon type={node.type} category={node.category} className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="text-ui truncate font-bold">{node.label}</span>
            {tagged && (
              <span className="text-muted text-3xs shrink-0 font-bold tracking-wide uppercase">
                {look.noun}
              </span>
            )}
          </span>
          {/* `line-clamp-2` sets `display: -webkit-box` itself, so pairing it with
              `block` is a coin toss over which `display` Tailwind emits last — and
              the toss was lost, which is why every description used to render in
              full in Chapter 1. */}
          <span className="text-muted line-clamp-2 text-2xs leading-snug">
            {node.description}
          </span>
        </span>
      </button>
    </li>
  );
}
