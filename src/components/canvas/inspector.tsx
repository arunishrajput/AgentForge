"use client";

import { Labelled, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/components/ui/cn";
import type { CanvasNode } from "@/lib/canvas/bridge";
import { categoryLook } from "@/lib/canvas/categories";
import type { GraphProblem, NodeSummary, Run, Workflow } from "@/lib/canvas/client";

import { ConfigForm } from "./config-form";
import { NodeIcon } from "./node-icon";
import { Panel } from "./panel";
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
  onChange,
  onDelete,
}: {
  node: CanvasNode;
  definition: NodeSummary | undefined;
  workflow: Workflow;
  dirty: boolean;
  problems: GraphProblem[];
  onChange: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDelete: (id: string) => void;
}) {
  const category = categoryLook(definition?.category);

  return (
    <>
      {/* The object, stated. The one loud element in the panel. */}
      <div
        className={cn(
          "border-line text-ink flex shrink-0 items-center gap-2 border-b-2 px-3 py-2",
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
          <p className="text-muted text-xs leading-relaxed">{definition.description}</p>
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

        {/* A trigger's URL and its next due time are workflow state, not node config,
            so they sit below the form rather than inside it. */}
        <TriggerPanel node={node} workflow={workflow} dirty={dirty} />
      </div>

      <footer className="border-line shrink-0 border-t-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          className="btn btn-danger w-full"
        >
          Delete node
        </button>
      </footer>
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
  onSelectNode,
}: {
  problems: GraphProblem[];
  run: Run | null;
  live: boolean;
  names: Map<string, string>;
  triggerInput: string;
  onChangeTriggerInput: (value: string) => void;
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

      {/* The manual trigger exists to turn a payload into the first node's output, so
          the canvas has to be able to supply one. */}
      <TriggerInput value={triggerInput} onChange={onChangeTriggerInput} />

      {run ? (
        <RunPanel run={run} live={live} names={names} onSelectNode={onSelectNode} />
      ) : (
        problems.length === 0 && (
          <p className="text-muted text-xs leading-relaxed">
            Press <strong className="text-ink">Run</strong> to execute this workflow. Each
            node reports on the canvas as it goes, and every step it took appears here.
          </p>
        )
      )}
    </div>
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
