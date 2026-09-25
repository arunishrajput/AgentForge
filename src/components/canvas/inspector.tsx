"use client";

import type { GraphProblem, NodeSummary, Run } from "@/lib/canvas/client";
import type { CanvasNode } from "@/lib/canvas/bridge";

import { ConfigForm } from "./config-form";
import { STATUS_STYLE } from "./context";

/**
 * The right-hand panel. It shows the selected node's configuration, or — when
 * nothing is selected — why the workflow cannot run and what the last run did.
 *
 * Validation problems are shown rather than blocking the save. A half-built canvas
 * must be saveable (CONTRACT.md → "Graph validation"), so the honest UI is "saved,
 * and here is what is still wrong".
 */
export function Inspector({
  node,
  definition,
  problems,
  run,
  triggerInput,
  onChangeTriggerInput,
  onChangeNode,
  onDeleteNode,
  onSelectNode,
}: {
  node: CanvasNode | null;
  definition: NodeSummary | undefined;
  problems: GraphProblem[];
  run: Run | null;
  triggerInput: string;
  onChangeTriggerInput: (value: string) => void;
  onChangeNode: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDeleteNode: (id: string) => void;
  onSelectNode: (id: string) => void;
}) {
  return (
    <aside className="bg-canvas flex w-80 shrink-0 flex-col border-l border-white/10">
      {node ? (
        <NodeInspector
          node={node}
          definition={definition}
          problems={problems.filter((problem) => problem.nodeId === node.id)}
          onChange={onChangeNode}
          onDelete={onDeleteNode}
        />
      ) : (
        <WorkflowInspector
          problems={problems}
          run={run}
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
  problems,
  onChange,
  onDelete,
}: {
  node: CanvasNode;
  definition: NodeSummary | undefined;
  problems: GraphProblem[];
  onChange: (id: string, data: Partial<CanvasNode["data"]>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <header className="border-b border-white/10 px-4 py-3">
        <h2 className="truncate text-sm font-medium">
          {definition?.label ?? node.data.nodeType}
        </h2>
        <p className="text-muted mt-0.5 font-mono text-[11px]">{node.id}</p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {definition ? (
          <p className="text-muted text-[12px] leading-relaxed">{definition.description}</p>
        ) : (
          <p className="text-[12px] text-red-300">
            No registry entry for <code>{node.data.nodeType}</code>. This workflow cannot
            run until the node is removed.
          </p>
        )}

        {problems.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-400/10 p-3 text-[12px] text-amber-200 ring-1 ring-amber-400/30">
            {problems.map((problem, index) => (
              <li key={index}>{problem.message}</li>
            ))}
          </ul>
        )}

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">Label</span>
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
            className="bg-canvas focus:border-accent/60 w-full rounded-lg border border-white/10 px-2.5 py-1.5 text-[13px] outline-none"
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
      </div>

      <footer className="border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          className="w-full rounded-lg border border-red-400/30 px-3 py-2 text-[13px] text-red-300 transition-colors hover:bg-red-400/10"
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
  triggerInput,
  onChangeTriggerInput,
  onSelectNode,
}: {
  problems: GraphProblem[];
  run: Run | null;
  triggerInput: string;
  onChangeTriggerInput: (value: string) => void;
  onSelectNode: (id: string) => void;
}) {
  return (
    <>
      <header className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-medium">{run ? "Last run" : "Workflow"}</h2>
        <p className="text-muted mt-0.5 text-[11px]">
          {run ? "Select a node to edit it" : "Select a node to edit its configuration"}
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {problems.length > 0 && (
          <section>
            <h3 className="text-muted mb-1.5 text-[11px] font-medium tracking-wide uppercase">
              Not runnable yet
            </h3>
            <ul className="space-y-1 rounded-lg bg-amber-400/10 p-3 text-[12px] text-amber-200 ring-1 ring-amber-400/30">
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

        {run ? <RunSteps run={run} onSelectNode={onSelectNode} /> : null}

        {!run && problems.length === 0 && (
          <p className="text-muted text-[12px]">
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
      <span className="text-muted mb-1.5 block text-[11px] font-medium tracking-wide uppercase">
        Trigger input
      </span>
      <textarea
        value={value}
        rows={3}
        spellCheck={false}
        placeholder={'{ "subject": "launch" }'}
        onChange={(event) => onChange(event.target.value)}
        className="bg-canvas focus:border-accent/60 w-full resize-y rounded-lg border border-white/10 px-2.5 py-1.5 font-mono text-[12px] outline-none"
      />
      {invalid ? (
        <span className="mt-1 block text-[11px] text-amber-300">
          Not valid JSON — the run will be blocked until this parses.
        </span>
      ) : (
        <span className="text-muted mt-1 block text-[11px]">
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

function RunSteps({ run, onSelectNode }: { run: Run; onSelectNode: (id: string) => void }) {
  const runTone =
    run.status === "succeeded"
      ? "text-emerald-300"
      : run.status === "failed"
        ? "text-red-300"
        : "text-sky-300";

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className={`text-[13px] font-medium ${runTone}`}>{run.status}</span>
        {run.durationMs !== null && (
          <span className="text-muted text-[11px]">{run.durationMs} ms</span>
        )}
      </div>

      {run.error && (
        <p className="rounded-lg bg-red-400/10 p-3 text-[12px] text-red-200 ring-1 ring-red-400/30">
          {run.error}
        </p>
      )}

      <ol className="space-y-1.5">
        {(run.steps ?? []).map((step) => (
          <li key={step.seq}>
            <button
              type="button"
              onClick={() => onSelectNode(step.nodeId)}
              className="hover:bg-surface w-full rounded-lg px-2 py-1.5 text-left transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-muted w-5 shrink-0 font-mono text-[11px]">
                  {step.seq}
                </span>
                <span className="truncate font-mono text-[12px]">{step.nodeId}</span>
                <span
                  className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ${STATUS_STYLE[step.status].className}`}
                >
                  {STATUS_STYLE[step.status].label}
                </span>
              </span>

              {step.error && (
                <span className="mt-1 block text-[11px] text-red-300">{step.error}</span>
              )}

              {(step.logs ?? []).map((log, index) => (
                <span key={index} className="text-muted mt-0.5 block pl-6 text-[11px]">
                  {log.message}
                </span>
              ))}
            </button>
          </li>
        ))}
      </ol>

      {run.output !== null && run.output !== undefined && (
        <div>
          <h3 className="text-muted mb-1.5 text-[11px] font-medium tracking-wide uppercase">
            Output
          </h3>
          <pre className="bg-surface overflow-x-auto rounded-lg p-3 font-mono text-[11px]">
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
