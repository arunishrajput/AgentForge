"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "@xyflow/react/dist/style.css";

import {
  CANVAS_NODE_TYPE,
  fromFlow,
  graphsEqual,
  nextEdgeId,
  nextNodeId,
  toFlow,
  type CanvasEdge,
  type CanvasNode,
} from "@/lib/canvas/bridge";
import {
  ApiRequestError,
  api,
  type NodeSummary,
  type Run,
  type Workflow,
} from "@/lib/canvas/client";
import { tweenMs } from "@/lib/canvas/motion";
import { useRunStream } from "@/lib/canvas/run-stream";
import { defaultConfig } from "@/lib/canvas/schema";

import { CanvasContext, type NodeRunState } from "./context";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { WorkflowNodeView } from "./workflow-node";

/**
 * The workflow editor.
 *
 * The server component hands it the workflow as already read from the database, so
 * a reload renders the saved graph directly — which is what makes "build it, hard
 * reload, it comes back identical" a real check rather than a cache artefact.
 * Everything after that goes through the Phase 3 API.
 *
 * `ReactFlowProvider` wraps the inner component because the canvas needs the flow
 * instance to place a new node at the centre of the current viewport.
 */
export function Editor({
  workflow,
  registry: palette,
  liveRun = null,
}: {
  workflow: Workflow;
  registry: NodeSummary[];
  /** A run of this workflow still in flight when the page was rendered. */
  liveRun?: Run | null;
}) {
  return (
    <ReactFlowProvider>
      <EditorInner workflow={workflow} palette={palette} liveRun={liveRun} />
    </ReactFlowProvider>
  );
}

// Defined once at module scope: React Flow warns when `nodeTypes` is a new object
// on every render, and re-creates every node when it changes.
const nodeTypes = { [CANVAS_NODE_TYPE]: WorkflowNodeView };

function EditorInner({
  workflow,
  palette,
  liveRun,
}: {
  workflow: Workflow;
  palette: NodeSummary[];
  liveRun: Run | null;
}) {
  const initial = useMemo(() => toFlow(workflow.graph), [workflow.graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(initial.edges);

  const [name, setName] = useState(workflow.name);
  const [saved, setSaved] = useState<Workflow>(workflow);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Below `lg` the palette and the inspector are overlay drawers rather than
  // columns — three fixed columns do not fit a 375px screen and the canvas is the
  // part that must survive. Both are always rendered; CSS decides whether they are
  // in the layout or over it, so there is no viewport measurement to get wrong on
  // the server render.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const closePanels = useCallback(() => {
    setPaletteOpen(false);
    setInspectorOpen(false);
  }, []);

  const { run, live, watch, stop, setRun } = useRunStream(workflow.id, liveRun);
  const [triggerInput, setTriggerInput] = useState("");
  const [busy, setBusy] = useState<null | "saving" | "running">(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(
    null,
  );

  const { fitView, screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // The palette is the registry, delivered with the first render so every node
  // draws its real output handles immediately (see the page component).
  const registry = useMemo(
    () => new Map(palette.map((node) => [node.type, node])),
    [palette],
  );

  /**
   * Left-to-right order of the graph as it was first loaded, used only to stagger
   * each node's entry animation. Sorted by position rather than array index so a
   * generated graph assembles in reading order (`DEMO.md` Beat 3), and derived from
   * `initial` so a node added later has no entry and therefore no delay.
   */
  const entryOrder = useMemo(() => {
    const order = new Map<string, number>();
    [...initial.nodes]
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      .forEach((node, index) => order.set(node.id, index));
    return order;
  }, [initial.nodes]);

  /** Per-node outcome of the last run. A looped node contributes several steps. */
  const runStates = useMemo(() => {
    const states = new Map<string, NodeRunState>();
    for (const step of run?.steps ?? []) {
      const existing = states.get(step.nodeId);
      states.set(step.nodeId, {
        status: step.status,
        executions: (existing?.executions ?? 0) + 1,
        branch: step.branch,
        error: step.error,
      });
    }
    return states;
  }, [run]);

  // A page loaded mid-run reattaches to that run, so a reload during execution
  // keeps showing it live instead of going blank until it finishes.
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current || !liveRun) return;
    attached.current = true;
    watch({ runId: liveRun.id });
  }, [liveRun, watch]);

  /**
   * The edges as *drawn*. `edges` itself stays exactly what will be saved — the run
   * highlight is a projection over it, never state — which is what keeps
   * `fromFlow(nodes, edges)` the clean inverse `bridge.ts` promises. React Flow
   * reports changes by id, so selection and deletion still apply to the real state.
   *
   * Two states, and they are the execution animation BUILD_PLAN Phase 10 asks for:
   * an edge into the node currently working pulses, and every edge the run has
   * actually crossed stays lit. On a branch the untaken edge never lights, so when
   * the run ends the canvas is showing the path the agent chose (`DEMO.md` Beat 7).
   */
  const displayEdges = useMemo(() => {
    const live = run?.status === "running";
    return edges.map((edge) => {
      const source = runStates.get(edge.source);
      if (source?.status !== "succeeded") return edge;

      const target = runStates.get(edge.target);
      if (live && target?.status === "running") {
        return { ...edge, animated: true, className: "edge-live" };
      }
      if (target && target.status !== "skipped") {
        return { ...edge, className: "edge-traversed" };
      }
      return edge;
    });
  }, [edges, run?.status, runStates]);

  const graph = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const dirty = !graphsEqual(graph, saved.graph) || name !== saved.name;

  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const id = params.nodes.length === 1 ? params.nodes[0].id : null;
    setSelectedId(id);
    // On a phone the inspector is a drawer, so selecting a node has to bring it in —
    // otherwise tapping a node appears to do nothing at all (`DEMO.md` Beat 4).
    if (id !== null) setInspectorOpen(true);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      // Our own id, rather than React Flow's generated one: edge ids are persisted
      // and `e1`/`e2` read far better in a graph a person or a model has to follow.
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: nextEdgeId(current.map((edge) => edge.id)),
            sourceHandle: connection.sourceHandle ?? null,
          },
          current,
        ),
      );
    },
    [setEdges],
  );

  const addNode = useCallback(
    (definition: NodeSummary) => {
      // The drawer covers the canvas below `lg`, so leaving it open would hide the
      // node that was just added.
      setPaletteOpen(false);
      const bounds = wrapper.current?.getBoundingClientRect();
      const viewportPosition = bounds
        ? screenToFlowPosition({ x: bounds.x + 140, y: bounds.y + bounds.height / 2 })
        : { x: 0, y: 0 };

      setNodes((current) => {
        const id = nextNodeId(
          current.map((node) => node.id),
          definition.type,
        );

        // New nodes land to the right of the rightmost one, so clicking through
        // the palette builds a readable left-to-right chain instead of a stack.
        // NODE_WIDTH 224 + a 56px gutter.
        const rightmost = current.reduce<CanvasNode | null>(
          (furthest, node) =>
            furthest === null || node.position.x > furthest.position.x ? node : furthest,
          null,
        );
        const position = rightmost
          ? { x: rightmost.position.x + 280, y: rightmost.position.y }
          : { x: Math.round(viewportPosition.x), y: Math.round(viewportPosition.y) };

        return [
          ...current.map((node) => ({ ...node, selected: false })),
          {
            id,
            type: CANVAS_NODE_TYPE,
            position,
            selected: true,
            data: { nodeType: definition.type, config: defaultConfig(definition.configSchema) },
          } satisfies CanvasNode,
        ];
      });

      // The chain grows rightwards, so without this the fourth node a user adds
      // lands outside the visible canvas and the click looks like it did nothing.
      // Deferred a frame so React Flow has measured the node it is fitting to.
      // `tweenMs` is 0 when the user asks for reduced motion: this tween is driven
      // in JavaScript, so the CSS media query in `globals.css` cannot reach it.
      requestAnimationFrame(() =>
        fitView({ padding: 0.25, maxZoom: 1, duration: tweenMs(250) }),
      );
    },
    [fitView, screenToFlowPosition, setNodes],
  );

  const changeNode = useCallback(
    (id: string, data: Partial<CanvasNode["data"]>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...data } } : node,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) =>
        current.filter((edge) => edge.source !== id && edge.target !== id),
      );
      setSelectedId(null);
    },
    [setEdges, setNodes],
  );

  const selectNode = useCallback(
    (id: string) => {
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: node.id === id })),
      );
      setSelectedId(id);
    },
    [setNodes],
  );

  /** One PATCH carrying the whole graph — a single atomic row update (D14). */
  const save = useCallback(async (): Promise<Workflow | null> => {
    setBusy("saving");
    setMessage(null);
    try {
      const updated = await api.updateWorkflow(workflow.id, {
        name: name.trim() === "" ? saved.name : name.trim(),
        graph: fromFlow(nodes, edges),
      });
      setSaved(updated);
      setName(updated.name);
      return updated;
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof ApiRequestError ? error.message : "Could not save the workflow.",
      });
      return null;
    } finally {
      setBusy(null);
    }
  }, [edges, name, nodes, saved.name, workflow.id]);

  /**
   * Running always runs what is *stored*, so unsaved edits are saved first. The
   * alternative — running a graph the server has not seen — makes the run history
   * describe a workflow that never existed.
   */
  const start = useCallback(async () => {
    const current = dirty ? await save() : saved;
    if (!current) return;

    if (!current.runnable) {
      setMessage({
        tone: "error",
        text: "Saved, but this workflow cannot run yet. See the problems on the right.",
      });
      return;
    }

    let input: unknown = null;
    if (triggerInput.trim() !== "") {
      try {
        input = JSON.parse(triggerInput);
      } catch {
        setMessage({ tone: "error", text: "Trigger input is not valid JSON." });
        return;
      }
    }

    setBusy("running");
    setMessage(null);
    setSelectedId(null);
    setNodes((all) => all.map((node) => ({ ...node, selected: false })));
    // Clear the previous run first. The stream's first snapshot is a few hundred
    // milliseconds away, and leaving the old run on screen means pressing Run shows
    // a canvas full of green "Succeeded" badges for something that has not started.
    setRun(null);

    // The stream opens *before* the run is triggered. It has to: `POST /runs` is
    // synchronous and does not return until the run is over, so a client that waited
    // for a run id would have nothing left to watch. The stream works out which run
    // is the new one by itself (D28).
    watch();

    try {
      // Authoritative, and it also covers the case where the stream never connected.
      const finished = await api.runWorkflow(workflow.id, input);
      setRun(finished);

      /**
       * A run that *fails* resolves this promise perfectly happily — the request
       * succeeded, the run did not. Without this the header says nothing at all and
       * the only sign is a red node card and a line in the inspector, which on a
       * shared screen is a demo that looks like it worked (Phase 11, task 4).
       *
       * The failing step is named because "the run failed" sends the presenter
       * hunting; "Append to Google Sheet failed: …" is the sentence `DEMO.md`
       * Fallback E is recovered from.
       */
      if (finished.status === "failed") {
        const failed = finished.steps?.find((step) => step.status === "failed");
        const label = failed ? (registry.get(failed.nodeType)?.label ?? failed.nodeType) : null;
        const reason = failed?.error ?? finished.error ?? "No reason was recorded.";
        setMessage({
          tone: "error",
          text: label ? `${label} failed: ${reason}` : `The run failed: ${reason}`,
        });
      }
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof ApiRequestError ? error.message : "The run could not start.",
      });
    } finally {
      // The run is over by the time the POST resolves, so the stream has nothing
      // left to say and Cloud Run should stop billing for it.
      stop();
      setBusy(null);
    }
  }, [dirty, registry, save, saved, setNodes, setRun, stop, triggerInput, watch, workflow.id]);

  const canvasValue = useMemo(
    () => ({ registry, runStates, entryOrder }),
    [entryOrder, registry, runStates],
  );

  return (
    <CanvasContext value={canvasValue}>
      <div
        className="flex h-dvh flex-col"
        // Escape closes whichever drawer is open. It is the expected key for a
        // panel over content, and the only way off the backdrop from a keyboard.
        onKeyDown={(event) => {
          if (event.key === "Escape") closePanels();
        }}
      >
        <header className="border-line pad-safe flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b pb-2">
          <Link href="/workflows" className="btn btn-ghost shrink-0 px-2">
            <span aria-hidden="true">←</span>
            <span className="max-sm:sr-only">Workflows</span>
          </Link>

          <input
            aria-label="Workflow name"
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            className="field hover:border-line min-w-0 flex-1 basis-32 border-transparent bg-transparent font-medium"
          />

          {/* Drawer toggles. Only below `lg`, where the panels are not columns. */}
          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <button
              type="button"
              aria-expanded={paletteOpen}
              aria-controls="node-palette"
              onClick={() => {
                setPaletteOpen((open) => !open);
                setInspectorOpen(false);
              }}
              className="btn btn-quiet px-2.5"
            >
              Nodes
            </button>
            <button
              type="button"
              aria-expanded={inspectorOpen}
              aria-controls="node-inspector"
              onClick={() => {
                setInspectorOpen((open) => !open);
                setPaletteOpen(false);
              }}
              className="btn btn-quiet px-2.5"
            >
              Details
            </button>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 max-sm:order-last max-sm:basis-full sm:flex-1">
            {message && (
              <span
                role={message.tone === "error" ? "alert" : "status"}
                className={`min-w-0 truncate text-xs ${
                  message.tone === "error" ? "text-bad" : "text-muted"
                }`}
              >
                {message.text}
              </span>
            )}

            <span className="text-muted shrink-0 text-xs" role="status">
              {busy === "saving"
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : saved.runnable
                    ? "Saved"
                    : `Saved · ${saved.problems.length} problem${saved.problems.length === 1 ? "" : "s"}`}
            </span>

            <button
              type="button"
              onClick={save}
              disabled={busy !== null || !dirty}
              className="btn btn-quiet shrink-0"
            >
              Save
            </button>

            <button
              type="button"
              onClick={start}
              disabled={busy !== null}
              className="btn btn-primary shrink-0"
            >
              {busy === "running" ? (
                <>
                  <span
                    aria-hidden="true"
                    className="animate-breathe bg-accent-ink h-1.5 w-1.5 rounded-full"
                  />
                  Running…
                </>
              ) : (
                "Run"
              )}
            </button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Backdrop for the drawers. Not focusable — Escape and the panel's own
              close button are the keyboard paths, and a full-screen button in the
              tab order between the header and the canvas is worse than neither. */}
          {(paletteOpen || inspectorOpen) && (
            <div
              aria-hidden="true"
              onClick={closePanels}
              className="bg-sunken/70 animate-fade absolute inset-0 z-20 lg:hidden"
            />
          )}

          <Palette
            id="node-palette"
            nodes={palette}
            onAdd={addNode}
            disabled={busy !== null}
            open={paletteOpen}
            onClose={closePanels}
          />

          <main id="main" ref={wrapper} className="min-w-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              deleteKeyCode={["Delete", "Backspace"]}
              colorMode="dark"
              fitView
              // Low enough that a seven-node graph still fits a 375px screen; the
              // default floor of 0.5 cropped it and the demo's spine ran off-canvas.
              minZoom={0.15}
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              {/* A minimap on a phone costs a quarter of the canvas and duplicates
                  what panning already gives. */}
              <MiniMap pannable zoomable className="max-sm:!hidden" />
            </ReactFlow>
          </main>

          <Inspector
            id="node-inspector"
            open={inspectorOpen}
            onClose={closePanels}
            node={selected}
            definition={selected ? registry.get(selected.data.nodeType) : undefined}
            workflow={saved}
            dirty={dirty}
            problems={saved.problems}
            run={run}
            live={live}
            triggerInput={triggerInput}
            onChangeTriggerInput={setTriggerInput}
            onChangeNode={changeNode}
            onDeleteNode={deleteNode}
            onSelectNode={selectNode}
          />
        </div>
      </div>
    </CanvasContext>
  );
}
