"use client";

import {
  Background,
  Controls,
  MarkerType,
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

import { CommandPalette } from "@/components/shell/command-palette";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
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
import { formatDuration } from "@/lib/format/duration";

import { CanvasContext, type NodeRunState } from "./context";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { useCollapsed } from "./panel";
import { WorkflowNodeView } from "./workflow-node";

/**
 * The workflow editor.
 *
 * The server component hands it the workflow as already read from the database, so a
 * reload renders the saved graph directly — which is what makes "build it, hard
 * reload, it comes back identical" a real check rather than a cache artefact.
 * Everything after that goes through the Phase 3 API.
 *
 * `ReactFlowProvider` wraps the inner component because the canvas needs the flow
 * instance to place a new node and to refit when the layout changes.
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

// Defined once at module scope: React Flow warns when `nodeTypes` is a new object on
// every render, and re-creates every node when it changes.
const nodeTypes = { [CANVAS_NODE_TYPE]: WorkflowNodeView };

/**
 * 0.18, not React Flow's 0.3. Padding is the one term in the fitView fraction worth
 * spending: Chapter 1 measured 0.39 → 0.46 zoom at 1440px from this change alone.
 * The larger share of that problem is now solved by the collapsible panels — see
 * `panel.tsx` — but the padding still earns its keep.
 */
const FIT = { padding: 0.18, maxZoom: 1 } as const;

/**
 * Edges as *drawn*, never as stored.
 *
 * `smoothstep` rather than the default bezier: a right-angled path with a fat corner
 * radius is the shape this language draws everywhere else, and on a dense graph an
 * orthogonal route is easier to follow with the eye than two crossing curves.
 *
 * The arrowhead matters more than it looks. A workflow graph is *directed* — the
 * whole meaning is which way data moves — and Chapter 1 drew it with an undecorated
 * 1px line, so direction was carried by nothing but node position. On a graph with a
 * loop edge running right to left that is genuinely ambiguous.
 *
 * `--color-ink` resolves here because it is declared on `:root`, and React Flow only
 * ever puts this string in a `fill` attribute inside its shared `<defs>`.
 */
const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: "var(--color-ink)",
} as const;

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
  const toast = useToast();

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(initial.edges);

  const [name, setName] = useState(workflow.name);
  const [saved, setSaved] = useState<Workflow>(workflow);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Two breakpoints, two behaviours, and no viewport measurement anywhere — CSS
   * decides which is in play (see `panel.tsx`).
   *
   *   `open`       below `lg`, where a panel is a drawer over the canvas
   *   `collapsed`  at `lg` and up, where it is a column that can rail itself
   *
   * The collapsed pair is what answers Phase 16's layout problem: two open columns
   * leave an 880px canvas at 1440px; two rails leave about 1360px.
   */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useCollapsed("palette-collapsed");
  const [inspectorCollapsed, setInspectorCollapsed] = useCollapsed("inspector-collapsed");

  const closePanels = useCallback(() => {
    setPaletteOpen(false);
    setInspectorOpen(false);
  }, []);

  const { run, live, watch, stop: stopStream, setRun } = useRunStream(workflow.id, liveRun);
  const [triggerInput, setTriggerInput] = useState("");
  const [busy, setBusy] = useState<null | "saving" | "running" | "queueing" | "stopping">(null);

  const { fitView, screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // The palette is the registry, delivered with the first render so every node draws
  // its real output handles immediately (see the page component).
  const registry = useMemo(
    () => new Map(palette.map((node) => [node.type, node])),
    [palette],
  );

  /**
   * Left-to-right order of the graph as it was first loaded, used only to stagger each
   * node's entry animation. Sorted by position rather than array index so a generated
   * graph assembles in reading order, and derived from `initial` so a node added later
   * has no entry and therefore no delay.
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

  /**
   * Node id → the name the canvas shows for it, so the run panel can say
   * "Decide the topic" where Chapter 1 said `agent_2`. Read from the live canvas
   * rather than from the run, because a step records the node's *type* and not the
   * label its owner gave it.
   */
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) {
      map.set(
        node.id,
        node.data.label ||
          registry.get(node.data.nodeType)?.label ||
          node.data.nodeType,
      );
    }
    return map;
  }, [nodes, registry]);

  /**
   * The canvas watches from the moment it opens, not only when it happened to load
   * mid-run. A run started anywhere else — a webhook, a schedule — is a run this page
   * is supposed to show. Watching only `liveRun` meant the page had to already be
   * loaded *during* a run to ever see one.
   *
   * `runId` is still pinned when the page did load mid-run, so a reload during
   * execution reattaches to that exact run rather than adopting it by guesswork (D29).
   */
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current) return;
    attached.current = true;
    watch(liveRun ? { runId: liveRun.id } : undefined);
  }, [liveRun, watch]);

  /**
   * Collapsing a panel hands the canvas a few hundred more pixels, and React Flow does
   * not refit on its own — so the graph would sit in the corner of the space it was
   * just given.
   *
   * Called from the collapse and expand handlers rather than from an effect watching
   * the two booleans. An effect keyed on a value it never reads is a lie about what it
   * depends on, and it would also have needed a ref to suppress the fit on mount that
   * the `fitView` prop has already done. The event that changed the layout is the
   * honest place to respond to it.
   *
   * One frame of delay, so the column is out of the layout before the viewport is
   * measured. `tweenMs` is 0 under `prefers-reduced-motion`: this tween is driven in
   * JavaScript, so the CSS media query in `globals.css` cannot reach it.
   */
  const refit = useCallback(() => {
    requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(220) }));
  }, [fitView]);

  /**
   * The edges as *drawn*. `edges` itself stays exactly what will be saved — the run
   * highlight and the routing are a projection over it, never state — which is what
   * keeps `fromFlow(nodes, edges)` the clean inverse `bridge.ts` promises. React Flow
   * reports changes by id, so selection and deletion still apply to the real state.
   *
   * Two run states, and they are the execution animation the phase asks for: an edge
   * into the node currently working animates its flow, and every edge the run has
   * actually crossed stays lit. On a branch the untaken edge never lights, so when the
   * run ends the canvas is showing the path the agent chose.
   */
  const displayEdges = useMemo(() => {
    const running = run?.status === "running";
    return edges.map((edge) => {
      const base = {
        ...edge,
        type: "smoothstep" as const,
        markerEnd: EDGE_MARKER,
      };

      const source = runStates.get(edge.source);
      if (source?.status !== "succeeded") return base;

      const target = runStates.get(edge.target);
      if (running && target?.status === "running") {
        return { ...base, animated: true, className: "edge-live" };
      }
      if (target && target.status !== "skipped") {
        return { ...base, className: "edge-traversed" };
      }
      return base;
    });
  }, [edges, run?.status, runStates]);

  const graph = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const dirty = !graphsEqual(graph, saved.graph) || name !== saved.name;

  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const id = params.nodes.length === 1 ? params.nodes[0].id : null;
    setSelectedId(id);
    // Selecting a node has to bring the inspector into view, or tapping a node on a
    // phone appears to do nothing at all — and at `lg` and up, a railed inspector
    // would swallow the selection just as silently.
    if (id !== null) {
      setInspectorOpen(true);
      setInspectorCollapsed(false);
    }
  }, [setInspectorCollapsed]);

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

        // New nodes land to the right of the rightmost one, so clicking through the
        // palette builds a readable left-to-right chain instead of a stack.
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
            data: {
              nodeType: definition.type,
              config: defaultConfig(definition.configSchema),
            },
          } satisfies CanvasNode,
        ];
      });

      // The chain grows rightwards, so without this the fourth node a user adds lands
      // outside the visible canvas and the click looks like it did nothing. Deferred a
      // frame so React Flow has measured the node it is fitting to. `tweenMs` is 0
      // when the user asks for reduced motion: this tween is driven in JavaScript, so
      // the CSS media query in `globals.css` cannot reach it.
      requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
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
    try {
      const updated = await api.updateWorkflow(workflow.id, {
        name: name.trim() === "" ? saved.name : name.trim(),
        graph: fromFlow(nodes, edges),
      });
      setSaved(updated);
      setName(updated.name);
      return updated;
    } catch (error) {
      toast({
        tone: "bad",
        title: "Could not save the workflow",
        detail: error instanceof ApiRequestError ? error.message : undefined,
        // A failure worth acting on stays up until it is dismissed (WCAG 2.2.1).
        duration: null,
      });
      return null;
    } finally {
      setBusy(null);
    }
  }, [edges, name, nodes, saved.name, toast, workflow.id]);

  /**
   * Everything both Run buttons do before they diverge: save what is unsaved, refuse a
   * graph that cannot run, parse the trigger input, clear the previous run and open the
   * stream.
   *
   * Extracted in Phase 17 rather than copied, because the two paths differ in exactly one
   * thing — whether the POST waits for the run — and duplicating thirty lines around that
   * one difference is how the two drift apart.
   *
   * Running always runs what is *stored*, so unsaved edits are saved first. The
   * alternative — running a graph the server has not seen — makes the run history
   * describe a workflow that never existed.
   */
  const prepare = useCallback(async (): Promise<{ input: unknown } | null> => {
    const current = dirty ? await save() : saved;
    if (!current) return null;

    if (!current.runnable) {
      toast({
        tone: "warn",
        title: "Saved, but this workflow cannot run yet",
        detail: `${current.problems.length} problem${current.problems.length === 1 ? "" : "s"} to fix — they are listed in the inspector.`,
      });
      setInspectorCollapsed(false);
      setInspectorOpen(true);
      return null;
    }

    let input: unknown = null;
    if (triggerInput.trim() !== "") {
      try {
        input = JSON.parse(triggerInput);
      } catch {
        toast({ tone: "bad", title: "Trigger input is not valid JSON" });
        return null;
      }
    }

    setSelectedId(null);
    setNodes((all) => all.map((node) => ({ ...node, selected: false })));
    // Clear the previous run first. The stream's first snapshot is a few hundred
    // milliseconds away, and leaving the old run on screen means pressing Run shows a
    // canvas full of green "Succeeded" badges for something that has not started.
    setRun(null);

    // The stream opens *before* the run is triggered. It has to: `POST /runs` is
    // synchronous and does not return until the run is over, so a client that waited for
    // a run id would have nothing left to watch. The stream works out which run is the
    // new one by itself (D28) — which is also why a *durable* run needed no new client
    // protocol: it is the same "watch a run this browser did not start" path.
    watch();

    return { input };
  }, [dirty, save, saved, setInspectorCollapsed, setNodes, setRun, toast, triggerInput, watch]);

  const start = useCallback(async () => {
    const prepared = await prepare();
    if (!prepared) return;
    const { input } = prepared;

    setBusy("running");

    try {
      // Authoritative, and it also covers the case where the stream never connected.
      const finished = await api.runWorkflow(workflow.id, input);
      setRun(finished);

      /**
       * A run that *fails* resolves this promise perfectly happily — the request
       * succeeded, the run did not. Without this the only sign is a red node card and
       * a line in the inspector, which on a shared screen is a run that looks like it
       * worked.
       *
       * The failing step is named because "the run failed" sends the reader hunting;
       * "Append to Google Sheet failed" is something to act on.
       */
      if (finished.status === "failed") {
        const failed = finished.steps?.find((step) => step.status === "failed");
        const label = failed
          ? (names.get(failed.nodeId) ??
            registry.get(failed.nodeType)?.label ??
            failed.nodeType)
          : null;
        toast({
          tone: "bad",
          title: label ? `${label} failed` : "The run failed",
          detail: failed?.error ?? finished.error ?? "No reason was recorded.",
          duration: null,
        });
      } else if (finished.status === "succeeded") {
        toast({
          tone: "ok",
          title: "Run finished",
          detail:
            finished.durationMs === null
              ? undefined
              : `${finished.steps?.length ?? 0} steps in ${formatDuration(finished.durationMs)}.`,
        });
      }
    } catch (error) {
      toast({
        tone: "bad",
        title: "The run could not start",
        detail: error instanceof ApiRequestError ? error.message : undefined,
        duration: null,
      });
    } finally {
      // The run is over by the time the POST resolves, so the stream has nothing left
      // to say and Cloud Run should stop billing for it.
      stopStream();
      setBusy(null);
    }
    // `stopStream` is the one identifier the two lint rules disagree about, and they
    // genuinely contradict each other: `react-hooks/exhaustive-deps` reports it as a
    // MISSING dependency if it is left out, and `react/memo-dependencies` reports it
    // as an EXTRA one if it is put in. Both cannot be satisfied.
    //
    // It stays in, and the newer rule is suppressed, because `useRunStream` defines it
    // as `useCallback(..., [])` — stable for the component's lifetime, so listing it
    // cannot cost a render, while omitting it would capture a stale closure the day
    // that hook is changed to close over anything. The cheap direction is the one that
    // survives a future edit to another file.
    //
    // This replaces Chapter 1's suppression of the same rule on the same array, whose
    // note read "an over-broad dependency list ... Phase 16 rebuilds this component".
    // The array is no longer over-broad: every other entry here was verified to be
    // required by removing it and watching `exhaustive-deps` ask for it back.
  }, [
    names,
    prepare,
    registry,
    setRun,
    // oxlint-disable-next-line react/memo-dependencies
    stopStream,
    toast,
    workflow.id,
  ]);

  /**
   * The durable path. It differs from `start` in one line — `runWorkflowDurably` answers
   * as soon as the run is on the queue rather than when it is over — and in one omission:
   * **the stream is deliberately left open.** `start` closes it in its `finally` because
   * the run is finished by then; here the run has not begun, and closing the stream is
   * exactly how a queued run would become invisible on the canvas. That is the Phase 12
   * defect (D59) in a new place, so it is worth saying out loud rather than leaving as an
   * absent line of code.
   */
  const startDurable = useCallback(async () => {
    const prepared = await prepare();
    if (!prepared) return;

    setBusy("queueing");

    try {
      const queued = await api.runWorkflowDurably(workflow.id, prepared.input);
      setRun(queued);

      toast(
        queued.status === "queued"
          ? {
              tone: "ok",
              title: "Queued",
              detail:
                "This run is on the queue. It survives a redeploy or a restart, and it streams here as it goes.",
            }
          : {
              // The fallback in `startDurableRun`: no queue was reachable, so it ran in
              // the request instead. Saying so matters — the user asked for durability
              // and did not get it.
              tone: "warn",
              title: "Ran without the queue",
              detail:
                "The queue was not available, so this ran immediately instead. It would not have survived a restart.",
              duration: null,
            },
      );
    } catch (error) {
      stopStream();
      toast({
        tone: "bad",
        title: "The run could not be queued",
        detail: error instanceof ApiRequestError ? error.message : undefined,
        duration: null,
      });
    } finally {
      setBusy(null);
    }
  }, [
    prepare,
    setRun,
    // oxlint-disable-next-line react/memo-dependencies
    stopStream,
    toast,
    workflow.id,
  ]);

  /**
   * Stop a run. Honest about what it can promise: a node already talking to Gmail is not
   * interrupted, because a request in flight cannot be recalled. So the toast says "the
   * step that is running will finish first" rather than "cancelled", unless the server
   * came back saying it really did cancel it — which happens when nothing had started it
   * yet (`api/runs/[id]/cancel`).
   */
  const stopRun = useCallback(async () => {
    if (!run) return;

    setBusy("stopping");
    try {
      const updated = await api.cancelRun(run.id);
      setRun(updated);

      toast(
        updated.status === "cancelled"
          ? { tone: "ok", title: "Run cancelled" }
          : {
              tone: "warn",
              title: "Stopping the run",
              detail:
                "No further nodes will start. The one that is running finishes first — a request already sent cannot be recalled.",
            },
      );
    } catch (error) {
      toast({
        tone: "bad",
        title: "The run could not be stopped",
        detail: error instanceof ApiRequestError ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }, [run, setRun, toast]);

  const canvasValue = useMemo(
    () => ({ registry, runStates, entryOrder }),
    [entryOrder, registry, runStates],
  );

  /**
   * A run nothing has finished yet. `queued` counts: a durable run sits there until a
   * delivery claims it, and that is precisely the window in which Stop is most useful and
   * cheapest — nothing has executed, so cancelling costs nothing and undoes everything.
   */
  const inFlight = run !== null && (run.status === "queued" || run.status === "running");

  const status =
    busy === "saving"
      ? "Saving…"
      : dirty
        ? "Unsaved changes"
        : saved.runnable
          ? "Saved"
          : `Saved · ${saved.problems.length} problem${saved.problems.length === 1 ? "" : "s"}`;

  return (
    <CanvasContext value={canvasValue}>
      {/* Not an interactive element — a keyboard-shortcut scope wrapping the page, so
          there is no role that would describe it honestly. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="flex h-dvh flex-col"
        // Escape closes whichever drawer is open. It is the expected key for a panel
        // over content, and the only way off the backdrop from a keyboard.
        onKeyDown={(event) => {
          if (event.key === "Escape") closePanels();
        }}
      >
        <header className="border-line bg-surface pad-safe flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b-2 pb-2">
          {/* The canvas had no `h1` at all before Phase 16 — the workflow's name is an
              editable `<input>`, which is a control and not a heading, so the document
              outline started at the panels' `h2`s. This is the same defect Phase 15
              shipped on the 404 for one deploy, and it is invisible until the page is
              asked for its headings rather than looked at.

              Visually hidden because the name is already on screen as the field
              beside it; duplicating it would be noise for everyone who can see it and
              structure for everyone who cannot. It tracks `name`, so renaming the
              workflow renames the document. */}
          <h1 className="sr-only">{name}</h1>

          <Link href="/workflows" className="btn btn-ghost shrink-0 px-2">
            <span aria-hidden="true">←</span>
            <span className="max-sm:sr-only">Workflows</span>
          </Link>

          <input
            aria-label="Workflow name"
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            className="field min-w-0 flex-1 basis-32 border-transparent bg-transparent font-bold shadow-none"
          />

          {/* Drawer toggles. Only below `lg`, where the panels are not columns — at
              `lg` and up each panel's own rail is the way back. */}
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
            <span className="text-muted shrink-0 text-2xs" role="status">
              {status}
            </span>

            <button
              type="button"
              onClick={save}
              disabled={busy !== null || !dirty}
              className="btn btn-quiet shrink-0"
            >
              Save
            </button>

            {/* Only while there is something to stop. A permanent, mostly-disabled Stop
                would sit in the tab order offering nothing for the whole time a person is
                building a workflow, which is almost all of the time. */}
            {inFlight && (
              <button
                type="button"
                onClick={stopRun}
                aria-busy={busy === "stopping"}
                className="btn btn-danger shrink-0"
              >
                {run.cancelRequested ? "Stopping…" : "Stop"}
              </button>
            )}

            <button
              type="button"
              onClick={start}
              // `aria-busy`, never `disabled`: a disabled button can lose its
              // accessible name mid-announcement and drops out of the tab order
              // under the user's cursor (`DESIGN.md`).
              aria-busy={busy === "running"}
              disabled={busy === "saving"}
              className={cn("btn btn-primary shrink-0", busy === "running" && "opacity-70")}
            >
              {busy === "running" ? (
                <>
                  <span aria-hidden="true" className="flex items-end gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        style={{ animationDelay: `${i * 140}ms` }}
                        className="animate-think bg-accent-ink size-1 rounded-full"
                      />
                    ))}
                  </span>
                  Running
                </>
              ) : (
                "Run"
              )}
            </button>

            {/* The shell's palette, mounted here rather than stacking a second bar
                above a viewport-height graph. It is how the canvas reaches the rest
                of the product without spending vertical space on nav links. */}
            <CommandPalette className="max-md:hidden" />
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Backdrop for the drawers. Not focusable — Escape and the panel's own
              close button are the keyboard paths, and a full-screen button in the tab
              order between the header and the canvas is worse than neither. */}
          {(paletteOpen || inspectorOpen) && (
            <div
              aria-hidden="true"
              onClick={closePanels}
              className="bg-ink/25 animate-fade absolute inset-0 z-20 lg:hidden"
            />
          )}

          <Palette
            id="node-palette"
            nodes={palette}
            onAdd={addNode}
            disabled={busy !== null}
            open={paletteOpen}
            collapsed={paletteCollapsed}
            onClose={closePanels}
            onExpand={() => {
              setPaletteCollapsed(false);
              refit();
            }}
            onCollapse={() => {
              setPaletteCollapsed(true);
              refit();
            }}
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
              // Light, because the product is light-first. The `dark` this replaces
              // was inert for our own custom node — React Flow's node colours only
              // reach its built-in types — but it left every variable Phase 14 did
              // not explicitly override falling back to a dark default, which is a
              // trap for the next person to add one.
              colorMode="light"
              fitView
              // Low enough that a seven-node graph still fits a 375px screen; the
              // default floor of 0.5 cropped it and the graph's spine ran off-canvas.
              minZoom={0.15}
              fitViewOptions={FIT}
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
            collapsed={inspectorCollapsed}
            onClose={closePanels}
            onExpand={() => {
              setInspectorCollapsed(false);
              refit();
            }}
            onCollapse={() => {
              setInspectorCollapsed(true);
              refit();
            }}
            node={selected}
            definition={selected ? registry.get(selected.data.nodeType) : undefined}
            workflow={saved}
            dirty={dirty}
            problems={saved.problems}
            run={run}
            live={live}
            names={names}
            triggerInput={triggerInput}
            onChangeTriggerInput={setTriggerInput}
            queueing={busy === "queueing"}
            canRun={busy === null && !inFlight}
            onRunDurably={startDurable}
            onChangeNode={changeNode}
            onDeleteNode={deleteNode}
            onSelectNode={selectNode}
          />
        </div>
      </div>
    </CanvasContext>
  );
}
