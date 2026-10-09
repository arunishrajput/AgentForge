"use client";

import { Labelled, Input, Toggle } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/components/ui/cn";
import type { CanvasNode, CanvasNote, CanvasNoteData } from "@/lib/canvas/bridge";
import { categoryLook } from "@/lib/canvas/categories";
import type { GraphProblem, NodeSummary, Run, RunSummary, TestScope, Workflow } from "@/lib/canvas/client";
import { canPin } from "@/lib/engine/partial";
import { manualTrigger, type ManualField } from "@/lib/nodes/core/manual-trigger";
import type { Platform } from "@/lib/ui/keys";

import { ConfigForm } from "./config-form";
import { NodeDocs } from "./node-docs";
import { NodeIcon } from "./node-icon";
import { NodeTestPanel } from "./node-test-panel";
import { NoteInspector } from "./note-inspector";
import { Panel } from "./panel";
import { PolicyForm } from "./policy-form";
import { RecentRuns } from "./recent-runs";
import { RunInput } from "./run-input";
import type { RunInputFacts } from "./node-test-panel";
import { RunPanel } from "./run-panel";
import { SelectionInspector } from "./selection-inspector";
import { TriggerPanel } from "./trigger-panel";

/**
 * The right-hand panel: the selected node's configuration, or — when nothing is
 * selected — why the workflow cannot run and what the last run did. **Since Phase 29 a
 * third state**: several nodes selected, and what can be done to all of them
 * (`selection-inspector.tsx`). **Phase 30 a fourth**: one sticky note (`note-inspector.tsx`),
 * and a node's on/off switch.
 *
 * Validation problems are **shown, not enforced**. A half-built canvas must be
 * saveable (`CONTRACT.md` → "Graph validation"), so the honest UI is "saved, and here
 * is what is still wrong" rather than a disabled Save button with no explanation.
 *
 * Two things Phase 16 changed beyond the layout:
 *
 *  - **Every message is a `Notice`.** Chapter 1 wrote the same shape by hand three
 *    times in this file as a translucent tint plus a hairline ring
 *    (`bg-warn/10 ring-warn/30 ring-1`). That is a dark-UI idiom — a tint only
 *    separates from its background when the background is dark — and on cream it
 *    reads as a smudge. `DESIGN.md` records that Phase 15 removed the last five
 *    copies elsewhere and that it must not come back; these were the three it could
 *    not reach, because the canvas was Phase 16's subject.
 *  - **A node's header wears its category**, with the fill, the icon and the word,
 *    so the panel is recognisably *about* the object that is selected on the canvas.
 *    That is the "form on a nice object" the phase asks for: the object is stated at
 *    the top, and everything below it is the quiet register — plain fields on paper,
 *    no fills, no shadows. Loud where you are, quiet where you work.
 */
export function Inspector({
  id,
  open,
  collapsed,
  onClose,
  onExpand,
  onCollapse,
  node,
  definition,
  note,
  nodes,
  selection,
  selectedNotes,
  registry,
  platform,
  revision,
  workflow,
  dirty,
  problems,
  run,
  live,
  names,
  triggerInput,
  onChangeTriggerInput,
  queueing,
  canRun,
  canRotateWebhook,
  readOnly,
  onRotateWebhook,
  onRunDurably,
  onTest,
  onPin,
  onChangeNode,
  onDeleteNode,
  onSelectNode,
  onChangeNote,
  onSetDisabled,
  onCopySelection,
  onDuplicateSelection,
  onMoveSelection,
  onDeleteSelection,
  history,
}: {
  id: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  node: CanvasNode | null;
  definition: NodeSummary | undefined;
  /** One sticky note, selected alone — Phase 30. */
  note: CanvasNote | null;
  /** Every node on the canvas — Phase 31: the trigger's input fields, and what holds a pin. */
  nodes: CanvasNode[];
  /** Every selected node — Phase 29. Read as a selection only when more than one thing is. */
  selection: CanvasNode[];
  /** Every selected note — Phase 30. They count towards the selection with the nodes. */
  selectedNotes: CanvasNote[];
  registry: Map<string, NodeSummary>;
  platform: Platform;
  /**
   * Bumped by undo and redo (`use-history.ts`). The node's forms are keyed on it, so a
   * draft of a value that Undo just replaced is thrown away rather than shown.
   */
  revision: number;
  /** The workflow as last SAVED — a webhook URL or a due time only exists once stored. */
  workflow: Workflow;
  dirty: boolean;
  problems: GraphProblem[];
  run: Run | null;
  /** A stream is open on this run — the panel is watching, not showing history. */
  live: boolean;
  /** Node id → the label the canvas shows for it, for the run panel's step names. */
  names: Map<string, string>;
  triggerInput: string;
  onChangeTriggerInput: (value: string) => void;
  /** A durable run is being queued right now. */
  queueing: boolean;
  /** Nothing is busy and no run is in flight, so starting one is possible. */
  canRun: boolean;
  /**
   * Replacing the webhook URL is `admin` — **Phase 21**. Separate from `readOnly` on purpose:
   * an editor may change everything about this workflow and still may not invalidate a secret
   * that systems outside this product depend on.
   */
  canRotateWebhook: boolean;
  /**
   * The viewer's role does not carry editing — **Phase 20**. The panel stays open and
   * every value stays legible; nothing in it can be changed. Reading a node's
   * configuration is a read, and it is most of what a viewer opens this panel for.
   */
  readOnly: boolean;
  onRotateWebhook: () => Promise<void>;
  onRunDurably: () => void;
  /** Test part of the workflow — Phase 31. */
  onTest: (scope: Exclude<TestScope, "workflow">, nodeId: string) => void;
  /** Pin a node's output, or unpin it with `undefined`. False when refused for its size. */
  onPin: (nodeId: string, output: unknown) => boolean;
  onChangeNode: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDeleteNode: (id: string) => void;
  onSelectNode: (id: string) => void;
  onChangeNote: (id: string, patch: Partial<CanvasNoteData>) => void;
  /** Switch nodes off or back on — Phase 30. A trigger is left as it is. */
  onSetDisabled: (ids: readonly string[], off: boolean) => boolean;
  onCopySelection: () => void;
  onDuplicateSelection: () => void;
  onMoveSelection: (dx: number, dy: number) => void;
  onDeleteSelection: () => void;
  /** This workflow's recent runs, and what can be done with one — Phase 33. */
  history: RunHistory;
}) {
  // The panel's own title names what it is showing, so the rail does too — a
  // collapsed inspector that says "Send email" is worth reopening.
  const many = selection.length + selectedNotes.length > 1;
  const title = many
    ? `${selectionWords(selection.length, selectedNotes.length)} selected`
    : note
    ? "Sticky note"
    : node
    ? (node.data.label || definition?.label || node.data.nodeType)
    : run
      ? run.status === "running"
        ? "Running"
        : history.past
          ? "Earlier run"
          : "Last run"
      : "Workflow";

  return (
    <Panel
      id={id}
      side="right"
      title={title}
      width="lg:w-80"
      open={open}
      collapsed={collapsed}
      onClose={onClose}
      onExpand={onExpand}
      onCollapse={onCollapse}
    >
      {many ? (
        <SelectionInspector
          nodes={selection}
          notes={selectedNotes}
          registry={registry}
          platform={platform}
          readOnly={readOnly}
          onSelectNode={onSelectNode}
          onCopy={onCopySelection}
          onDuplicate={onDuplicateSelection}
          onMove={onMoveSelection}
          onDelete={onDeleteSelection}
          onSetDisabled={onSetDisabled}
        />
      ) : note ? (
        <NoteInspector note={note} readOnly={readOnly} onChange={onChangeNote} onDelete={onDeleteNode} />
      ) : node ? (
        <NodeInspector
          node={node}
          definition={definition}
          revision={revision}
          workflow={workflow}
          dirty={dirty}
          problems={problems.filter((problem) => problem.nodeId === node.id)}
          readOnly={readOnly}
          canRotateWebhook={canRotateWebhook}
          onRotateWebhook={onRotateWebhook}
          run={run}
          canRun={canRun}
          runInput={{
            ...runFacts(nodes, registry),
            value: triggerInput,
            onChange: onChangeTriggerInput,
          }}
          onTest={onTest}
          onPin={onPin}
          onChange={onChangeNode}
          onDelete={onDeleteNode}
          onSetDisabled={onSetDisabled}
        />
      ) : (
        <WorkflowInspector
          nodes={nodes}
          registry={registry}
          problems={problems}
          run={run}
          live={live}
          names={names}
          triggerInput={triggerInput}
          onChangeTriggerInput={onChangeTriggerInput}
          queueing={queueing}
          canRun={canRun}
          readOnly={readOnly}
          onRunDurably={onRunDurably}
          onSelectNode={onSelectNode}
          history={history}
        />
      )}
    </Panel>
  );
}

/**
 * **What the inspector needs for run history — Phase 33.** Grouped, because the six travel
 * together from the editor to `WorkflowInspector` and mean nothing apart.
 */
export interface RunHistory {
  workflowId: string;
  runs: RunSummary[];
  /** The run on the canvas, when it is one of `runs`. */
  shownId: string | null;
  /** A run being fetched to be shown. */
  opening: string | null;
  onOpen: (runId: string) => void;
  /** The run on the canvas is an earlier one, opened from the list; `onClose` puts back what was there. */
  past: { onClose: () => void } | null;
  /** Retry or re-run the run on the canvas. Null for a viewer. */
  restart: { onRestart: (kind: "rerun" | "retry") => void; busy: boolean } | null;
  /** Phase 36: ask the copilot why the run on the canvas failed. Null for a viewer. */
  diagnose: { onDiagnose: (runId: string) => void; disabled: boolean } | null;
  /** Phase 38: an approval was decided in the run panel — follow the run as it wakes. */
  onDecided?: () => void;
}

/**
 * What a run will be started with, read off the canvas — Phase 31: the manual trigger's declared
 * fields, the nodes standing in with a pin (`honouredPin`'s rule: present, switched on, on a node
 * that can hold one), and whether the trigger is one of them.
 */
function runFacts(nodes: CanvasNode[], registry: Map<string, NodeSummary>) {
  const trigger = nodes.find((node) => registry.get(node.data.nodeType)?.kind === "trigger");
  const declared =
    trigger?.data.nodeType === manualTrigger.type
      ? manualTrigger.configSchema.safeParse(trigger.data.config ?? {})
      : null;
  const fields: ManualField[] = declared?.success
    ? (declared.data as { fields: ManualField[] }).fields
    : [];
  const pinned = nodes.filter(
    (node) =>
      node.data.pinned !== undefined && !node.data.disabled && canPin(registry.get(node.data.nodeType)),
  );
  const pinnedTrigger = trigger !== undefined && pinned.some((node) => node.id === trigger.id);
  return { fields, pinned, pinnedTrigger };
}

/** "3 nodes", "a note", "2 nodes and a note" — the selection in words (Phase 30). */
export function selectionWords(nodes: number, notes: number): string {
  const nodeWords = nodes === 1 ? "1 node" : `${nodes} nodes`;
  const noteWords = notes === 1 ? "1 note" : `${notes} notes`;
  if (notes === 0) return nodeWords;
  if (nodes === 0) return noteWords;
  return `${nodeWords} and ${noteWords}`;
}

function NodeInspector({
  node,
  definition,
  revision,
  workflow,
  dirty,
  problems,
  readOnly,
  canRotateWebhook,
  onRotateWebhook,
  run,
  canRun,
  runInput,
  onTest,
  onPin,
  onChange,
  onDelete,
  onSetDisabled,
}: {
  node: CanvasNode;
  definition: NodeSummary | undefined;
  revision: number;
  workflow: Workflow;
  dirty: boolean;
  problems: GraphProblem[];
  readOnly: boolean;
  canRotateWebhook: boolean;
  onRotateWebhook: () => Promise<void>;
  run: Run | null;
  canRun: boolean;
  /** The run input, so *test up to here* can be given what the trigger asks for — Phase 31. */
  runInput: RunInputFacts;
  onTest: (scope: Exclude<TestScope, "workflow">, nodeId: string) => void;
  onPin: (nodeId: string, output: unknown) => boolean;
  onChange: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDelete: (id: string) => void;
  onSetDisabled: (ids: readonly string[], off: boolean) => boolean;
}) {
  const category = categoryLook(definition?.category);

  return (
    <>
      {/* The object, stated. The one loud element in the panel. */}
      <div
        className={cn(
          "border-line text-accent-ink flex shrink-0 items-center gap-2 border-b-2 px-3 py-2",
          category.fill,
        )}
      >
        <NodeIcon type={node.data.nodeType} category={definition?.category} className="size-4" />
        <span className="text-3xs truncate font-bold tracking-wide uppercase">
          {category.noun}
        </span>
        {/* Full strength: `opacity-70` here measured 3.26:1 on Night's logic fill — D126's
            dimmed label on a fill, found by the contrast audit in Phase 30. Mono sets it apart. */}
        <span className="ml-auto shrink-0 font-mono text-3xs">{node.id}</span>
      </div>

      <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3.5">
        {definition ? (
          <NodeDocs definition={definition} />
        ) : (
          <Notice tone="bad" title="This node type is not in the registry">
            Nothing is registered for <code className="font-mono">{node.data.nodeType}</code>.
            The workflow cannot run until this node is removed.
          </Notice>
        )}

        {problems.length > 0 && (
          <Notice tone="warn" title="This node needs attention">
            <ul className="space-y-1">
              {problems.map((problem, index) => (
                <li key={index}>{problem.message}</li>
              ))}
            </ul>
          </Notice>
        )}

        <fieldset disabled={readOnly} className="min-w-0 border-0 p-0">
          <OnOffSwitch node={node} definition={definition} onSetDisabled={onSetDisabled} />
        </fieldset>

        {/* **One `<fieldset disabled>` rather than a `readOnly` prop threaded through
            four components** — Phase 20. A native disabled fieldset disables every form
            control inside it, however deeply nested and whatever type, which is exactly
            the guarantee wanted here: the config form builds its controls from a JSON
            schema at runtime, so a field type added later is covered without anybody
            remembering to cover it. A prop passed down through `ConfigForm` → `Field` →
            `Control` → six control components is the version of this that eventually
            misses one.

            `min-w-0` because a fieldset's default `min-inline-size: min-content` breaks
            the panel's flex layout, and `contents` is not usable — it drops the disabling.

            The values stay readable. That is the point: a viewer is here to read them. */}
        {readOnly && (
          <p className="text-faint text-2xs text-pretty">
            You can read this node&rsquo;s configuration and not change it.
          </p>
        )}
        <fieldset disabled={readOnly} className="min-w-0 space-y-4 border-0 p-0">
          <Labelled label="Label" hint="What this node is called on the canvas.">
            <Input
              type="text"
              value={node.data.label ?? ""}
              placeholder={definition?.label ?? ""}
              maxLength={200}
              onChange={(event) =>
                onChange(node.id, {
                  label: event.target.value === "" ? undefined : event.target.value,
                })
              }
            />
          </Labelled>

          {definition && (
            // Remounts on selection change, and on undo and redo, which reloads the
            // form's local drafts from the value now on the canvas.
            <ConfigForm
              key={`${node.id}:${revision}`}
              schema={definition.configSchema}
              config={node.data.config}
              onChange={(config) => onChange(node.id, { config })}
            />
          )}
        </fieldset>

        {/* A trigger's URL and its next due time are workflow state, not node config,
            so they sit below the form rather than inside it. */}
        <TriggerPanel
          node={node}
          workflow={workflow}
          dirty={dirty}
          canRotate={canRotateWebhook}
          onRotate={onRotateWebhook}
        />

        {/* The test loop — Phase 31. Right after the configuration, because the loop is
            "change this, test it, read what it made". */}
        <NodeTestPanel
          node={node}
          definition={definition}
          run={run}
          canRun={canRun}
          readOnly={readOnly}
          runInput={runInput}
          onTest={onTest}
          onPin={onPin}
        />

        {/* Retry and timeout are properties of *running* a node, so they sit below its
            configuration behind a rule of their own rather than inside the config form.
            Hidden on a trigger: a trigger turns a payload into an output and cannot fail
            in a way a second attempt would fix, so offering retries there would be an
            option that does nothing. */}
        {definition && definition.kind !== "trigger" && (
          <>
            <hr className="border-line-soft" />
            <fieldset disabled={readOnly} className="min-w-0 border-0 p-0">
              <PolicyForm
                key={`${node.id}:${revision}`}
                policy={node.data.policy}
                onChange={(policy) => onChange(node.id, { policy })}
                canContinue={definition.outputs.some((output) => output.key === null)}
              />
            </fieldset>
          </>
        )}
      </div>

      {/* The footer goes entirely rather than holding a disabled Delete. A whole bar
          whose only control can never be used is a permanent claim that something is
          available here, and it costs the panel 44px of the height a viewer is using to
          read. */}
      {!readOnly && (
        <footer className="border-line shrink-0 border-t-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="btn btn-danger w-full"
          >
            Delete node
          </button>
        </footer>
      )}
    </>
  );
}

/**
 * A node's on/off switch — Phase 30, `CONTRACT.md` → *Disabled nodes*.
 *
 * The hint says what *off* will do for this node in particular, because the answer differs:
 * most nodes pass their input straight through, a branch, a switch or a loop stops its path,
 * and an agent-callable node's type stays in any agent's tools. A trigger has no switch —
 * a run starts at it — unless it is somehow already off, when the switch is how it comes
 * back on.
 */
function OnOffSwitch({
  node,
  definition,
  onSetDisabled,
}: {
  node: CanvasNode;
  definition: NodeSummary | undefined;
  onSetDisabled: (ids: readonly string[], off: boolean) => boolean;
}) {
  const off = node.data.disabled === true;
  const trigger = definition?.kind === "trigger";
  if (trigger && !off) return null;

  const passes = definition?.outputs.some((output) => output.key === null) ?? true;
  const noun = definition?.label ?? "node";

  return (
    <div className="space-y-1.5">
      <Toggle
        kind="switch"
        label="Run this node"
        checked={!off}
        onChange={(event) => onSetDisabled([node.id], !event.target.checked)}
      />
      <p className="text-muted text-2xs leading-relaxed text-pretty">
        {trigger
          ? "A trigger cannot be switched off — every run starts at it. Switch it back on; to stop the workflow running by itself, use the Active switch."
          : passes
            ? `${off ? "Switched off:" : "Switch it off to skip it without deleting it:"} when a run reaches it, its input goes straight to the next node — nothing is sent, called or written.`
            : off
              ? `Switched off: this ${noun} decides nothing, so nothing after it runs — there is no neutral way for it to go.`
              : `Switch it off and this ${noun} decides nothing: nothing after it runs, because there is no neutral way for it to go.`}
        {definition?.agentCallable &&
          " An agent that lists this node's type among its tools can still call it."}
      </p>
    </div>
  );
}

function WorkflowInspector({
  nodes,
  registry,
  problems,
  run,
  live,
  names,
  triggerInput,
  onChangeTriggerInput,
  queueing,
  canRun,
  readOnly,
  onRunDurably,
  onSelectNode,
  history,
}: {
  nodes: CanvasNode[];
  registry: Map<string, NodeSummary>;
  problems: GraphProblem[];
  run: Run | null;
  live: boolean;
  names: Map<string, string>;
  triggerInput: string;
  onChangeTriggerInput: (value: string) => void;
  queueing: boolean;
  canRun: boolean;
  readOnly: boolean;
  onRunDurably: () => void;
  onSelectNode: (id: string) => void;
  history: RunHistory;
}) {
  /**
   * Phase 31. The manual trigger's declared fields become the form below, and any node standing
   * in with a pin is named here — the place a person looks before pressing Run — because a pin
   * turns their Run into a test that does not call those steps.
   */
  const { fields, pinned, pinnedTrigger } = runFacts(nodes, registry);

  return (
    <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3.5">
      {problems.length > 0 && (
        <Notice
          tone="warn"
          title={`Not runnable yet — ${problems.length} problem${problems.length === 1 ? "" : "s"}`}
        >
          <ul className="space-y-1">
            {problems.map((problem, index) => (
              <li key={index}>{problem.message}</li>
            ))}
          </ul>
        </Notice>
      )}

      {/* **Both of these go for a viewer — found in a browser, not by a test** (Phase 20).
          The trigger input is a payload for a run they cannot start, and the durable-run
          button was correctly disabled and still sat there under a paragraph explaining a
          feature they have no way to use. Two dead controls and an explanation of a third:
          the `canRun` flag made the button honest and left the panel dishonest. */}
      {!readOnly && (
        <>
          {/* The manual trigger exists to turn a payload into the first node's output, so
              the canvas has to be able to supply one. */}
          <RunInput
            fields={fields}
            value={triggerInput}
            onChange={onChangeTriggerInput}
            pinnedTrigger={pinnedTrigger}
          />

          {pinned.length > 0 && (
            <Notice
              tone="info"
              title={`${pinned.length === 1 ? "1 step uses" : `${pinned.length} steps use`} a pinned output`}
            >
              <span className="block">
                Run hands on{" "}
                {pinned.map((node, index) => (
                  <span key={node.id}>
                    {index > 0 && (index === pinned.length - 1 ? " and " : ", ")}
                    <button
                      type="button"
                      onClick={() => onSelectNode(node.id)}
                      className="font-semibold underline underline-offset-2"
                    >
                      {names.get(node.id) ?? node.id}
                    </button>
                  </span>
                ))}
                &rsquo;s pinned output instead of running {pinned.length === 1 ? "it" : "them"}, so it
                is a test run and stays out of analytics. A webhook or a schedule runs every step for
                real.
              </span>
            </Notice>
          )}

          {/* Durable running lives here rather than in the toolbar, and the reason is the
              explanation. "Run" and "Run in the background" are indistinguishable as two
              adjacent buttons — the difference is what happens when the server restarts,
              which is not something a label conveys — and the toolbar at 375 px has no room
              for a sentence. Here there is room, so the affordance and its meaning arrive
              together. */}
          <DurableRun queueing={queueing} canRun={canRun} onRun={onRunDurably} />
        </>
      )}

      <RecentRuns
        workflowId={history.workflowId}
        runs={history.runs}
        shownId={history.shownId}
        opening={history.opening}
        onOpen={history.onOpen}
      />

      {run ? (
        <RunPanel
          run={run}
          live={live}
          names={names}
          onSelectNode={onSelectNode}
          past={history.past}
          restart={history.restart}
          diagnose={history.diagnose}
          onDecided={history.onDecided}
        />
      ) : (
        problems.length === 0 &&
        (readOnly ? (
          <p className="text-muted text-xs leading-relaxed">
            Nobody has run this workflow recently. When somebody does, every step it takes
            appears here — a run is visible to everybody in the workspace, whoever started it.
          </p>
        ) : (
          <p className="text-muted text-xs leading-relaxed">
            Press <strong className="text-ink">Run</strong> to execute this workflow. Each
            node reports on the canvas as it goes, and every step it took appears here.
          </p>
        ))
      )}
    </div>
  );
}

/**
 * The durable-run affordance.
 *
 * Deliberately the quiet register (`DESIGN.md`): this is a considered choice made while
 * reading, not the primary action. The primary Run button stays in the toolbar and stays
 * loud.
 */
function DurableRun({
  queueing,
  canRun,
  onRun,
}: {
  queueing: boolean;
  canRun: boolean;
  onRun: () => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="eyebrow">Run in the background</h3>
      <p className="text-muted text-2xs leading-relaxed">
        Hands the run to a queue instead of this request. It keeps going if the server
        restarts or is redeployed mid-run, and picks up from the last step it finished.
        Scheduled runs always work this way.
      </p>
      <button
        type="button"
        onClick={onRun}
        aria-busy={queueing}
        disabled={!canRun && !queueing}
        className="btn btn-quiet w-full"
      >
        {queueing ? "Queueing…" : "Queue a run"}
      </button>
    </section>
  );
}
