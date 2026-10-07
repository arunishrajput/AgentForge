"use client";

import { Background, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { useMemo } from "react";

import { CanvasContext, INERT_NOTES } from "@/components/canvas/context";
import { NoteView } from "@/components/canvas/note-node";
import { WorkflowNodeView } from "@/components/canvas/workflow-node";
import { useTheme } from "@/components/ui/theme";
import {
  CANVAS_NODE_TYPE,
  CANVAS_NOTE_TYPE,
  toFlow,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNote,
} from "@/lib/canvas/bridge";
import type { NodeSummary, SharedWorkflow } from "@/lib/canvas/client";
import { GRAPH_VERSION } from "@/lib/workflow/graph";

/**
 * The canvas on a public share page — **Phase 20**.
 *
 * **A separate component rather than `Editor` with a `readOnly` flag, and that is the
 * security argument for the whole page.** The editor is eleven hundred lines that exist to
 * mutate a workflow: it holds a save function, a run function, the API client, the SSE
 * stream and the palette. Handing it a flag would mean the thing standing between an
 * anonymous visitor and `api.updateWorkflow` was a boolean. This file cannot save anything
 * because it has no code that could — it imports no client, no store and no mutation.
 *
 * What it does reuse is everything about how a node *looks*: `WorkflowNodeView`, the
 * registry summaries and the same edge treatment. A shared workflow that were drawn in a
 * second, plainer style would be a worse page and a second thing to keep in step.
 *
 * The context defaults cover run status and diff state — there is neither here — so only
 * `registry` and `entryOrder` are supplied.
 *
 * **Phase 30.** Sticky notes are drawn where the author put them, in their tone, **without
 * their text** — the share response never carried it (`lib/workflow/share.ts`), and each
 * note says so rather than looking empty. A switched-off node is published and drawn off.
 */
const nodeTypes = { [CANVAS_NODE_TYPE]: WorkflowNodeView, [CANVAS_NOTE_TYPE]: NoteView };

const FIT = { padding: 0.18, maxZoom: 1 } as const;

const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: "var(--color-ink)",
} as const;

export function SharedCanvas({
  graph,
  registry,
}: {
  graph: SharedWorkflow["graph"];
  registry: NodeSummary[];
}) {
  const { theme } = useTheme();

  /**
   * The redacted graph mapped onto the canvas through the **same** `toFlow` the editor
   * uses, so a shared node is positioned and handled identically to an edited one.
   *
   * `config` is the redacted object and nothing reads it here — `WorkflowNodeView` draws
   * from the registry entry for `data.nodeType`. It is carried anyway rather than dropped,
   * because `toFlow` is the one mapping and forking it for this page is how the two
   * eventually disagree about what a node is.
   */
  const flow = useMemo(
    () =>
      toFlow({
        version: GRAPH_VERSION,
        nodes: graph.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          ...(node.label === undefined ? {} : { label: node.label }),
          position: node.position,
          config: node.config,
          ...(node.disabled ? { disabled: true as const } : {}),
        })),
        edges: graph.edges,
        // The text was never sent; an empty string is all this page has to give the note.
        ...(graph.notes?.length
          ? {
              notes: graph.notes.map((note) => ({
                id: note.id,
                position: note.position,
                size: note.size,
                text: "",
                tone: note.tone,
              })),
            }
          : {}),
      }),
    [graph],
  );

  const flowNodes = useMemo(
    () => [...flow.notes, ...flow.nodes] as (CanvasNode | CanvasNote)[],
    [flow.notes, flow.nodes],
  );

  const lookup = useMemo(() => new Map(registry.map((node) => [node.type, node])), [registry]);

  const entryOrder = useMemo(() => {
    const order = new Map<string, number>();
    [...flow.nodes]
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      .forEach((node, index) => order.set(node.id, index));
    return order;
  }, [flow.nodes]);

  const edges: CanvasEdge[] = useMemo(
    () => flow.edges.map((edge) => ({ ...edge, type: "smoothstep", markerEnd: EDGE_MARKER })),
    [flow.edges],
  );

  const value = useMemo(
    () => ({
      registry: lookup,
      runStates: new Map(),
      diffStates: new Map(),
      entryOrder,
      noteDiffStates: new Map(),
      notes: {
        ...INERT_NOTES,
        withheld: new Set((graph.notes ?? []).filter((note) => note.redacted.length > 0).map((note) => note.id)),
      },
    }),
    [lookup, entryOrder, graph.notes],
  );

  return (
    <CanvasContext value={value}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          // **Every handler is absent, not disabled.** React Flow reports edits through
          // `onNodesChange`; with no handler there is nothing for a drag to write to, so
          // the graph on screen cannot be moved away from the graph that was published.
          // Panning and zooming stay, because reading a graph of twenty nodes on a phone
          // needs them.
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          // The reader's resolved theme, as on the editor's canvas.
          colorMode={theme}
          fitView
          minZoom={0.15}
          fitViewOptions={FIT}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </CanvasContext>
  );
}
