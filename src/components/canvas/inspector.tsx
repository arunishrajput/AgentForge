"use client";

import { Labelled, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/components/ui/cn";
import type { CanvasNode } from "@/lib/canvas/bridge";
import { categoryLook } from "@/lib/canvas/categories";
import type { GraphProblem, NodeSummary, Run, Workflow } from "@/lib/canvas/client";

import { ConfigForm } from "./config-form";
import { NodeDocs } from "./node-docs";
import { NodeIcon } from "./node-icon";
import { Panel } from "./panel";
import { PolicyForm } from "./policy-form";
import { RunPanel } from "./run-panel";
import { TriggerPanel } from "./trigger-panel";

/**
 * The right-hand panel: the selected node's configuration, or — when nothing is
 * selected — why the workflow cannot run and what the last run did.
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
  onChangeNode,
  onDeleteNode,
  onSelectNode,
}: {
  id: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  node: CanvasNode | null;
  definition: NodeSummary | undefined;
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
  onChangeNode: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDeleteNode: (id: string) => void;
  onSelectNode: (id: string) => void;
}) {
  // The panel's own title names what it is showing, so the rail does too — a
  // collapsed inspector that says "Send email" is worth reopening.
  const title = node
    ? (node.data.label || definition?.label || node.data.nodeType)
    : run
      ? run.status === "running"
        ? "Running"
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
      {node ? (
        <NodeInspector
          node={node}
          definition={definition}
          workflow={workflow}
          dirty={dirty}
          problems={problems.filter((problem) => problem.nodeId === node.id)}
          readOnly={readOnly}
          canRotateWebhook={canRotateWebhook}
          onRotateWebhook={onRotateWebhook}
          onChange={onChangeNode}
          onDelete={onDeleteNode}
        />
      ) : (
        <WorkflowInspector
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
        />
      )}
    </Panel>
  );
}

function NodeInspector({
  node,
  definition,
  workflow,
  dirty,
  problems,
  readOnly,
  canRotateWebhook,
  onRotateWebhook,
  onChange,
  onDelete,
}: {
  node: CanvasNode;
  definition: NodeSummary | undefined;
  workflow: Workflow;
  dirty: boolean;
  problems: GraphProblem[];
  readOnly: boolean;
  canRotateWebhook: boolean;
  onRotateWebhook: () => Promise<void>;
  onChange: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDelete: (id: string) => void;
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
        <span className="ml-auto shrink-0 font-mono text-3xs opacity-70">{node.id}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3.5">
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
            // Remounts on selection change, which reloads the form's local drafts.
            <ConfigForm
              key={node.id}
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
                key={node.id}
                policy={node.data.policy}
                onChange={(policy) => onChange(node.id, { policy })}
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

function WorkflowInspector({
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
}: {
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
}) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3.5">
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
          <TriggerInput value={triggerInput} onChange={onChangeTriggerInput} />

          {/* Durable running lives here rather than in the toolbar, and the reason is the
              explanation. "Run" and "Run in the background" are indistinguishable as two
              adjacent buttons — the difference is what happens when the server restarts,
              which is not something a label conveys — and the toolbar at 375 px has no room
              for a sentence. Here there is room, so the affordance and its meaning arrive
              together. */}
          <DurableRun queueing={queueing} canRun={canRun} onRun={onRunDurably} />
        </>
      )}

      {run ? (
        <RunPanel run={run} live={live} names={names} onSelectNode={onSelectNode} />
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

function TriggerInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const invalid = value.trim() !== "" && !parses(value);

  return (
    <Labelled
      label="Trigger input"
      hint={
        <>
          JSON handed to the trigger. Reach it with <code className="font-mono">{"{{input.x}}"}</code>.
        </>
      }
      error={invalid ? "Not valid JSON — the run will be blocked until this parses." : undefined}
    >
      <Textarea
        value={value}
        rows={3}
        spellCheck={false}
        placeholder={'{ "subject": "launch" }'}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-2xs"
      />
    </Labelled>
  );
}

function parses(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
