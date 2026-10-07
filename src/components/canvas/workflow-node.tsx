"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@/components/ui/cn";
import type { CanvasNode } from "@/lib/canvas/bridge";
import { categoryLook } from "@/lib/canvas/categories";
import { changeLook, fieldWords } from "@/lib/canvas/changes";
import { nodeStatusLook } from "@/lib/canvas/status";

import { useCanvas } from "./context";
import { NodeIcon } from "./node-icon";

/**
 * The one node component on the canvas.
 *
 * Everything it draws comes from the registry entry for `data.nodeType` — label,
 * category strip, icon, and one source handle per declared output. No node type is
 * named here, which is what lets a node added to the registry in a later phase
 * appear on the canvas correctly with no change to this file.
 *
 * **The handle ids are contract.** React Flow reports the handle a connection left
 * from as `sourceHandle`, and the engine follows edges by matching that against the
 * node definition's `outputs[].key`. So the id here must be exactly that key, and
 * the default output (`key: null`) must have *no* id at all — React Flow then
 * reports `null`, which is what the stored graph uses.
 *
 * **Status is carried on four channels and only one is hue** — the word, the shape,
 * the outline and the motion. The table is `lib/canvas/status.ts` and it is tested
 * for distinctness, because "each visually distinct at a glance and without relying
 * on colour alone" (`BUILD_PLAN.md` Phase 16) is the kind of requirement that decays
 * quietly as five class strings drift together. A greyscale screenshot of a run
 * still reads: dashed and dim was skipped, bobbing is working, ticked finished.
 *
 * **Selection and status are deliberately different channels.** Status owns the
 * border colour, selection owns the lift — so a selected *failed* node still shows
 * it failed, which it would not if selection also recoloured the outline.
 *
 * All motion here is opacity and transform, never layout: a canvas of thirty cards
 * cannot afford a reflow per frame.
 *
 *  - **Entry** is a staggered `rise`, delayed by the node's position in the graph as
 *    first loaded, so a generated workflow assembles itself left to right instead of
 *    appearing all at once. A node added by clicking the palette has no entry in
 *    `entryOrder` and so no delay — that click must feel immediate.
 *  - **Running** draws a breathing ring as a separate absolutely-positioned overlay,
 *    so the pulse animates one element's opacity rather than the card's box-shadow.
 *  - **A status change** remounts the badge via `key`, which is what replays its
 *    one-shot animation. Without the key the element persists and it never runs again.
 */

/** Per-node stagger. Capped so a 20-node graph does not take four seconds to land. */
const STAGGER_MS = 55;
const STAGGER_CAP_MS = 660;

/** Matches the 224px `NODE_WIDTH` the editor's placement arithmetic assumes. */
const NODE_WIDTH = "w-56";

export function WorkflowNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const { registry, runStates, diffStates, entryOrder } = useCanvas();
  const definition = registry.get(data.nodeType);
  const state = runStates.get(id);

  /**
   * In diff mode the node's *change* owns the outline and the surface, which is why
   * it is resolved here and why `status` is not consulted below when it is set. The
   * two would otherwise fight over the same two channels: a diff showing run status
   * is a diff of a graph that was never run in that shape, so status has nothing
   * true to say about it.
   */
  const diff = diffStates.get(id);
  const change = diff ? changeLook(diff.change) : null;

  const category = categoryLook(definition?.category);

  /**
   * **Switched off — Phase 30.** A property of the graph, so the card wears it whether or not
   * a run has reached the node: what it has to say is *this will not run*, and it says it in
   * the status vocabulary's own channels — the word, the glyph, a dotted outline and a
   * recessed card (`status.ts`). It outranks the last run's status, which described a node
   * that was on. In diff mode the change still owns the outline and the surface, but the
   * chip stays: being off is a fact about that version of the graph, not about a run.
   */
  const off = data.disabled === true;
  const status = off
    ? nodeStatusLook("disabled")
    : nodeStatusLook(state?.status ?? "idle", definition?.category === "agent", state?.paused ?? false);

  const outputs = definition?.outputs ?? [{ key: null, label: "Out" }];
  const isTrigger = definition?.kind === "trigger";
  // A step paused inside a waiting run (Phase 26) is not working, so it gets no live edge.
  const running = !off && state?.status === "running" && !state.paused;

  const delayMs = Math.min((entryOrder.get(id) ?? 0) * STAGGER_MS, STAGGER_CAP_MS);

  return (
    // The entry animation is on this wrapper and NOT on the card, which is not a
    // stylistic split. `animate-rise` fills both ways, so once it ends its keyframe
    // keeps `opacity: 1` applied to whatever element carries it — and a filled
    // animation outranks an ordinary declaration, so an `opacity-*` utility on that
    // same element is silently dead. Keeping the animation one level out leaves the
    // card's own opacity usable.
    //
    // The selected lift is a separate matter and was never caught by this: Tailwind
    // compiles `-translate-x-px` to the `translate` property, while the keyframe
    // animates `transform`, so the two never met.
    <div style={{ animationDelay: `${delayMs}ms` }} className="animate-rise">
      <div
        className={cn(
          "relative rounded-xl border-2 transition-[border-color,background-color,box-shadow,translate] duration-200",
          NODE_WIDTH,
          // Status owns the outline and the surface. `idle`, `running` and `succeeded`
          // all keep the plain ink outline on a raised card — a canvas where three
          // quarters of the cards are tinted is a canvas with no signal in the tint.
          // In diff mode the change owns them instead, for the same reason: the two
          // cannot both have the border.
          change ? change.outline : status.outline,
          change ? change.surface : status.surface,
          // Selection owns the lift, and nothing else, so a selected *failed* node
          // still shows that it failed.
          selected
            ? "shadow-lift -translate-x-px -translate-y-px"
            : (change?.shadow ?? status.shadow),
        )}
      >
        {/* The diff ribbon. Above the category strip rather than inside the card body,
            because at a 0.4 zoom — which is where a whole-graph diff is read — the body
            is unreadable and the top two centimetres are all there is. The word rides
            with the glyph: `DESIGN.md` → *Never colour alone*. */}
        {change?.ribbon && (
          <div
            className={cn(
              "border-line flex items-center gap-1.5 rounded-t-[0.875rem] border-b-2 px-2.5 py-1",
              change.fill,
              change.ink,
            )}
          >
            <span aria-hidden="true" className="text-2xs leading-none font-bold">
              {change.glyph}
            </span>
            <span className="text-3xs font-bold tracking-wide uppercase">{change.label}</span>
            {/* At full strength, and told apart from the word by weight. It was dimmed with
                `opacity-75` — D126's dimmed label on a fill, by another mechanism — until
                Phase 30 added "switched off" here and measured it. */}
            {diff && diff.fields.length > 0 && (
              <span className="text-3xs ml-auto truncate font-medium">
                {fieldWords(diff.fields, off)}
              </span>
            )}
          </div>
        )}
        {/* The running pulse. An overlay rather than a box-shadow on the card, so the
            animation touches opacity only and stays on the compositor. */}
        {running && (
          <span
            aria-hidden="true"
            className="animate-breathe ring-live pointer-events-none absolute -inset-0.5 rounded-xl ring-2"
          />
        )}

        {/* A trigger starts the run, so nothing may connect into it (`validateGraph`
            enforces the same rule server-side). Omitting the handle stops the user
            drawing an edge that would only come back as a problem. */}
        {!isTrigger && (
          <Handle
            type="target"
            position={Position.Left}
            className="!bg-elevated !border-line !size-3.5 !border-2"
          />
        )}

        {/* The category strip: a `-pop` fill, an ink label and an ink icon, inside the
            card's own outline — `DESIGN.md`'s rule for a pop fill, in all three parts.
            The radius is the card's less its border, so the strip does not poke out. */}
        <div
          className={cn(
            "border-line text-accent-ink flex items-center gap-1.5 border-b-2 px-2.5 py-1.5",
            // Square when the diff ribbon is above it, or two stacked radii poke
            // through each other at the card's top corners.
            change?.ribbon ? "" : "rounded-t-[0.875rem]",
            category.fill,
          )}
        >
          <NodeIcon type={data.nodeType} category={definition?.category} className="size-4" />
          <span className="text-3xs truncate font-bold tracking-wide uppercase">
            {category.noun}
          </span>
        </div>

        <div className="space-y-1.5 px-2.5 py-2">
          {/* The node's name, and the largest type on the card. At a 0.4 zoom this is
              the only thing still readable, so it is what the card is *for*. */}
          <p className="text-sm leading-snug font-bold break-words">
            {data.label || definition?.label || data.nodeType}
          </p>
          <p className="text-muted truncate font-mono text-3xs">{data.nodeType}</p>

          {!definition && (
            <p className="text-bad text-2xs font-medium">
              Unknown node type — this workflow cannot run.
            </p>
          )}

          {/* Run status is suppressed in diff mode: the union graph on screen was never
              anybody's workflow, so no run ever executed it and a green "Succeeded"
              badge on a node in a diff would be a statement about a different graph. */}
          {((state && !change) || off) && (
            <div className="flex flex-wrap items-center gap-1">
              <span
                // Remounting on a status change is what replays the one-shot motion.
                key={off ? "off" : state?.status}
                className={cn("chip", status.tone, status.motion)}
              >
                {status.dots ? (
                  <span aria-hidden="true" className="flex items-end gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        style={{ animationDelay: `${i * 140}ms` }}
                        className="animate-think bg-live size-1 rounded-full"
                      />
                    ))}
                  </span>
                ) : (
                  <span aria-hidden="true" className="leading-none font-bold">
                    {status.glyph}
                  </span>
                )}
                {status.label}
              </span>

              {state && !change && state.executions > 1 && (
                <span className="text-muted text-3xs font-bold">×{state.executions}</span>
              )}
              {state?.branch && !change && !off && (
                <span className="text-muted font-mono text-3xs">→ {state.branch}</span>
              )}
            </div>
          )}

          {/* A failure from a run that reached this node while it was on describes a node
              that is not there any more. */}
          {state?.error && !change && !off && (
            <p className="text-bad line-clamp-3 text-2xs leading-snug">{state.error}</p>
          )}
        </div>

        {/* One labelled row per declared output, each with its handle centred on it.
            Even a single default output gets a row, so the connection point is always
            where the label says it is rather than at the bottom edge of the card. */}
        <div className="border-line border-t-2">
          {outputs.map((output, index) => (
            <div
              key={output.key ?? "default"}
              className={cn(
                "relative flex h-7 items-center justify-end pr-2.5",
                index > 0 && "border-line-soft border-t",
              )}
            >
              <span className="text-muted text-3xs font-bold">{output.label}</span>
              <Handle
                // `undefined` for the default output, so React Flow reports null.
                id={output.key ?? undefined}
                type="source"
                position={Position.Right}
                data-output={output.key ?? "default"}
                className={cn(
                  "!border-line !size-3.5 !border-2",
                  // A branch's two exits are told apart by fill as well as by label:
                  // this is the one place on the card where a handle is the only thing
                  // there is room to distinguish, and the label sits beside it.
                  output.key === "true" || output.key === "loop"
                    ? "!bg-ok-pop"
                    : output.key === "false"
                      ? "!bg-bad-pop"
                      : "!bg-elevated",
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
