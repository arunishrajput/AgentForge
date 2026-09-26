"use client";

import type { GraphProblem, NodeSummary, Run, Workflow } from "@/lib/canvas/client";
import type { CanvasNode } from "@/lib/canvas/bridge";

import { ConfigForm } from "./config-form";
import { STATUS_STYLE } from "./context";
import { TriggerPanel } from "./trigger-panel";

/**
 * The right-hand panel. It shows the selected node's configuration, or — when
 * nothing is selected — why the workflow cannot run and what the last run did.
 *
 * Validation problems are shown rather than blocking the save. A half-built canvas
 * must be saveable (CONTRACT.md → "Graph validation"), so the honest UI is "saved,
 * and here is what is still wrong".
 *
 * Below `lg` it is a drawer over the canvas instead of a column beside it, opened by
 * the header toggle or by selecting a node. Always rendered, with CSS deciding —
 * `max-lg:invisible` keeps the closed drawer out of the tab order without a viewport
 * measurement that could differ between the server render and the browser.
 */
export function Inspector({
  id,
  open,
  onClose,
  node,
  definition,
  workflow,
  dirty,
  problems,
  run,
  live,
  triggerInput,
  onChangeTriggerInput,
  onChangeNode,
  onDeleteNode,
  onSelectNode,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  node: CanvasNode | null;
  definition: NodeSummary | undefined;
  /** The workflow as last SAVED — a webhook URL or a due time only exists once stored. */
  workflow: Workflow;
  dirty: boolean;
  problems: GraphProblem[];
  run: Run | null;
  /** A stream is open on this run — the panel is watching, not showing history. */
  live: boolean;
  triggerInput: string;
  onChangeTriggerInput: (value: string) => void;
  onChangeNode: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDeleteNode: (id: string) => void;
  onSelectNode: (id: string) => void;
}) {
  return (
    <aside
      id={id}
      aria-label="Inspector"
      className={`border-line bg-canvas flex w-80 shrink-0 flex-col border-l transition-[transform,visibility] duration-200 ease-out max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-[min(22rem,90vw)] max-lg:shadow-drawer lg:visible lg:translate-x-0 ${
        open ? "max-lg:translate-x-0" : "max-lg:invisible max-lg:translate-x-full"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className="btn btn-ghost absolute top-2 right-2 z-10 px-2 lg:hidden"
      >
        <span aria-hidden="true">✕</span>
        <span className="sr-only">Close inspector</span>
      </button>

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
          triggerInput={triggerInput}
          onChangeTriggerInput={onChangeTriggerInput}
          onSelectNode={onSelectNode}
        />
      )}
    </aside>
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
  return (
    <>
      <header className="border-line border-b px-4 py-3 max-lg:pr-12">
        <h2 className="truncate text-sm font-medium">
          {definition?.label ?? node.data.nodeType}
        </h2>
        <p className="text-muted mt-0.5 font-mono text-2xs">{node.id}</p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {definition ? (
          <p className="text-muted text-xs leading-relaxed">{definition.description}</p>
        ) : (
          <p className="text-xs text-bad">
            No registry entry for <code>{node.data.nodeType}</code>. This workflow cannot
            run until the node is removed.
          </p>
        )}

        {problems.length > 0 && (
          <ul className="bg-warn/10 text-warn ring-warn/30 animate-fade space-y-1 rounded-lg p-3 text-xs ring-1">
            {problems.map((problem, index) => (
              <li key={index}>{problem.message}</li>
            ))}
          </ul>
        )}

        <label className="block">
          <span className="mb-1 block text-ui font-medium">Label</span>
          <input
            type="text"
            value={node.data.label ?? ""}
            placeholder={definition?.label ?? ""}
            maxLength={200}
            onChange={(event) =>
              onChange(node.id, {
                label: event.target.value === "" ? undefined : event.target.value,
              })
            }
            className="field"
          />
        </label>

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

      <footer className="border-t border-line px-4 py-3">
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
  triggerInput,
  onChangeTriggerInput,
  onSelectNode,
}: {
  problems: GraphProblem[];
  run: Run | null;
  live: boolean;
  triggerInput: string;
  onChangeTriggerInput: (value: string) => void;
  onSelectNode: (id: string) => void;
}) {
  const watching = live && run?.status === "running";

  return (
    <>
      <header className="border-line flex items-start justify-between gap-2 border-b px-4 py-3 max-lg:pr-12">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">
            {run ? (run.status === "running" ? "Running" : "Last run") : "Workflow"}
          </h2>
          <p className="text-muted mt-0.5 text-2xs">
            {run ? "Select a node to edit it" : "Select a node to edit its configuration"}
          </p>
        </div>

        {watching && (
          <span className="chip bg-sunken text-live shrink-0">
            <span
              aria-hidden="true"
              className="animate-breathe bg-live h-1.5 w-1.5 rounded-full"
            />
            Live
          </span>
        )}
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {problems.length > 0 && (
          <section>
            <h3 className="eyebrow mb-1.5">Not runnable yet</h3>
            <ul className="space-y-1 rounded-lg bg-warn/10 p-3 text-xs text-warn ring-1 ring-warn/30">
              {problems.map((problem, index) => (
                <li key={index}>{problem.message}</li>
              ))}
            </ul>
          </section>
        )}

        {/* The manual trigger exists to turn a payload into the first node's output,
            so the canvas has to be able to supply one. It is also the demo's fallback
            when the webhook does not land (DEMO.md, contingency F). */}
        <TriggerInput value={triggerInput} onChange={onChangeTriggerInput} />

        {run ? <RunSteps run={run} live={live} onSelectNode={onSelectNode} /> : null}

        {!run && problems.length === 0 && (
          <p className="text-muted text-xs">
            Press Run to execute this workflow and see each node&apos;s outcome on the
            canvas.
          </p>
        )}
      </div>
    </>
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
    <label className="block">
      <span className="eyebrow mb-1.5 block">Trigger input</span>
      <textarea
        value={value}
        rows={3}
        spellCheck={false}
        placeholder={'{ "subject": "launch" }'}
        onChange={(event) => onChange(event.target.value)}
        className="field resize-y font-mono text-xs"
      />
      {invalid ? (
        <span className="mt-1 block text-2xs text-warn">
          Not valid JSON — the run will be blocked until this parses.
        </span>
      ) : (
        <span className="text-muted mt-1 block text-2xs">
          JSON handed to the trigger. Reach it with <code>{"{{input.x}}"}</code>.
        </span>
      )}
    </label>
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

function RunSteps({
  run,
  live,
  onSelectNode,
}: {
  run: Run;
  live: boolean;
  onSelectNode: (id: string) => void;
}) {
  const runTone =
    run.status === "succeeded"
      ? "text-ok"
      : run.status === "failed"
        ? "text-bad"
        : "text-live";

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className={`text-ui font-medium capitalize ${runTone}`}>{run.status}</span>
        <span className="text-muted text-2xs">
          {run.durationMs !== null
            ? `${run.durationMs} ms`
            : live
              ? "streaming"
              : "in flight"}
        </span>
      </div>

      {run.error && (
        <p className="bg-bad/10 text-bad ring-bad/30 animate-fade rounded-lg p-3 text-xs ring-1">
          {run.error}
        </p>
      )}

      <ol className="space-y-1.5">
        {(run.steps ?? []).map((step) => (
          <li key={step.seq}>
            <button
              type="button"
              onClick={() => onSelectNode(step.nodeId)}
              className="hover:bg-surface animate-fade w-full rounded-lg px-2 py-1.5 text-left transition-colors duration-100"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-muted w-5 shrink-0 font-mono text-2xs">
                  {step.seq}
                </span>
                <span className="truncate font-mono text-xs">{step.nodeId}</span>
                <span
                  key={step.status}
                  className={`chip animate-pop ml-auto shrink-0 ${STATUS_STYLE[step.status].className}`}
                >
                  {STATUS_STYLE[step.status].label}
                </span>
              </span>

              {step.error && (
                <span className="mt-1 block text-2xs text-bad">{step.error}</span>
              )}

              {(step.logs ?? []).map((log, index) => (
                <span key={index} className="text-muted mt-0.5 block pl-6 text-2xs">
                  {log.message}
                </span>
              ))}
            </button>
          </li>
        ))}
      </ol>

      {run.output !== null && run.output !== undefined && (
        <div>
          <h3 className="eyebrow mb-1.5">Output</h3>
          <pre className="bg-sunken border-line overflow-x-auto rounded-lg border p-3 font-mono text-2xs">
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
