"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Select, Toggle } from "@/components/ui/field";
import { api, type CallableWorkflow, type NodeSummary } from "@/lib/canvas/client";
import type { SchemaField } from "@/lib/canvas/schema";
import { toolRef, workflowIdOf } from "@/lib/workflow/tool";

/**
 * **The two config fields that name a workflow — Phase 39.** Everything else in a node's form is
 * generated from its schema (`config-form.tsx`), and these two cannot be: a schema can say a
 * field is a string, and not that it is *one of this workspace's workflows*.
 *
 *  - `core.call_workflow` → `workflowId`: a picker of the workspace's workflows
 *  - `ai.agent` → `tools`: a checklist of the nodes an agent may call (the registry's
 *    `agentCallable` ones, D19) and the workflows marked callable by agents (D186)
 *
 * Both read `GET /api/workflows/callable` when the node is opened, which is id, name and marking
 * and never a graph. Both store what the engine already reads — a workflow's id, and
 * `workflow:<id>` in an agent's tools — so nothing about a saved graph changed with them.
 */

export interface FieldControl {
  control: ReactNode;
  /** More than one control: the form groups it under its caption instead of wrapping it in a `<label>`. */
  group?: boolean;
}

export function workflowFieldFor(options: {
  nodeType: string;
  field: SchemaField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  /** The workflow being edited: it is left out of every picker. */
  workflowId: string;
  registry: ReadonlyMap<string, NodeSummary>;
}): FieldControl | null {
  const { nodeType, field, value, onChange, workflowId, registry } = options;
  if (nodeType === "core.call_workflow" && field.key === "workflowId") {
    return { control: <WorkflowPicker current={typeof value === "string" ? value : ""} onPick={(id) => onChange(field.key, id)} exclude={workflowId} /> };
  }
  if (nodeType === "ai.agent" && field.key === "tools") {
    return {
      group: true,
      control: (
        <AgentToolsPicker
          selected={Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []}
          onChange={(next) => onChange(field.key, next)}
          registry={registry}
          exclude={workflowId}
        />
      ),
    };
  }
  return null;
}

type Callable = { status: "loading" } | { status: "error" } | { status: "ready"; list: CallableWorkflow[] };

function useCallable(exclude: string): Callable {
  const [state, setState] = useState<Callable>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    api
      .callableWorkflows(exclude)
      .then((list) => alive && setState({ status: "ready", list }))
      .catch(() => alive && setState({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [exclude]);
  return state;
}

function WorkflowPicker({ current, onPick, exclude }: { current: string; onPick: (id: string) => void; exclude: string }) {
  const callable = useCallable(exclude);
  const known = callable.status === "ready" && callable.list.some((workflow) => workflow.id === current);
  // A `{{ }}` reference resolves at run time and cannot be checked against a list: it stays as typed.
  const reference = current.includes("{{");

  if (reference) {
    return (
      <>
        <input
          className="field font-mono"
          value={current}
          onChange={(event) => onPick(event.target.value)}
          aria-label="Workflow"
        />
        <span className="text-faint mt-1 block text-2xs">A reference is read when the step runs.</span>
      </>
    );
  }

  return (
    <>
      <Select
        value={current}
        onChange={(event) => onPick(event.target.value)}
        disabled={callable.status === "loading"}
        aria-label="Workflow"
      >
        <option value="">{callable.status === "loading" ? "Loading workflows…" : "Choose a workflow…"}</option>
        {callable.status === "ready" &&
          callable.list.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        {current !== "" && !known && callable.status !== "loading" && (
          <option value={current}>{current} — not in this list</option>
        )}
      </Select>
      {callable.status === "error" && (
        <span className="text-bad mt-1 block text-2xs">The list of workflows could not be loaded.</span>
      )}
      {callable.status === "ready" && callable.list.length === 0 && (
        <span className="text-faint mt-1 block text-2xs">This workspace has no other workflow to call yet.</span>
      )}
      {current !== "" && !known && callable.status === "ready" && (
        <span className="text-warn mt-1 block text-2xs">
          This workflow is not in your list — it may be gone, or private to someone else. The step fails until it is.
        </span>
      )}
    </>
  );
}

function AgentToolsPicker({
  selected,
  onChange,
  registry,
  exclude,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  registry: ReadonlyMap<string, NodeSummary>;
  exclude: string;
}) {
  const callable = useCallable(exclude);
  const nodes = [...registry.values()].filter((node) => node.agentCallable);
  const offered = callable.status === "ready" ? callable.list.filter((workflow) => workflow.tool) : [];

  const known = new Set<string>([
    ...nodes.map((node) => node.type),
    ...offered.map((workflow) => toolRef(workflow.id)),
  ]);
  // Anything listed that is neither a callable node nor a workflow offered to agents: shown, so it can be removed.
  const leftover = selected.filter((entry) => !known.has(entry) && !(callable.status === "loading" && workflowIdOf(entry) !== null));

  const toggle = (entry: string, on: boolean) =>
    onChange(on ? [...selected.filter((candidate) => candidate !== entry), entry] : selected.filter((candidate) => candidate !== entry));

  return (
    <div className="space-y-3">
      <p className="text-faint text-2xs">
        The agent can call exactly what is ticked, and nothing when nothing is.
      </p>

      <ToolList title="Nodes">
        {nodes.map((node) => (
          <Toggle
            key={node.type}
            label={node.label}
            title={node.description}
            checked={selected.includes(node.type)}
            onChange={(event) => toggle(node.type, event.target.checked)}
            className="font-normal"
          />
        ))}
      </ToolList>

      <ToolList title="Workflows">
        {callable.status === "loading" && <p className="text-faint text-2xs">Loading workflows…</p>}
        {callable.status === "error" && <p className="text-bad text-2xs">The list of workflows could not be loaded.</p>}
        {offered.map((workflow) => (
          <Toggle
            key={workflow.id}
            label={
              <>
                {workflow.name}{" "}
                <span className="text-faint font-mono text-2xs">workflow_{workflow.tool!.name}</span>
              </>
            }
            title={workflow.tool!.description}
            checked={selected.includes(toolRef(workflow.id))}
            onChange={(event) => toggle(toolRef(workflow.id), event.target.checked)}
            className="font-normal"
          />
        ))}
        {callable.status === "ready" && offered.length === 0 && (
          <p className="text-faint text-2xs">
            No workflow is offered to agents yet. Open a workflow, select its trigger, and choose{" "}
            <em>Offer to agents</em>.
          </p>
        )}
      </ToolList>

      {leftover.length > 0 && (
        <ToolList title="Not available">
          {leftover.map((entry) => (
            <div key={entry} className="flex items-center justify-between gap-2 text-2xs">
              <span className="text-warn min-w-0 truncate font-mono">{entry}</span>
              <button type="button" className="btn btn-quiet px-2 py-0.5 text-2xs" onClick={() => toggle(entry, false)}>
                Remove
              </button>
            </div>
          ))}
        </ToolList>
      )}
    </div>
  );
}

function ToolList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="eyebrow">{title}</h4>
      <div className="border-line-soft bg-sunken max-h-44 space-y-2 overflow-y-auto rounded-lg border-2 p-2.5 relative">{children}</div>
    </div>
  );
}
