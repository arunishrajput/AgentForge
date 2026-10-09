"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Labelled, Select, Textarea, Toggle } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, type Workflow, type WorkflowAgentTool } from "@/lib/canvas/client";
import { TOOL_FIELD_TYPES, toolWireName, workflowAgentToolSchema } from "@/lib/workflow/tool";

/**
 * **Offer this workflow to agents — Phase 39, task 2** (D186).
 *
 * A workflow is a tool for an agent only after two deliberate acts, and this is the first: somebody
 * with the `editor` role says so here, and describes it the way a model will read it — a name, what
 * it does, and the inputs it takes. The second is on the agent's node, which has to list the workflow
 * by id. So switching this on hands the workflow to no agent by itself, and the panel says so.
 *
 * It sits with the trigger because the trigger is where a payload comes in: whatever the agent
 * sends arrives as `{{trigger.<input name>}}`, and the panel prints exactly that.
 *
 * A property of the *workflow*, saved by its own request the moment it is chosen — not canvas state,
 * not undoable, not a version (it is `visibility`'s kind of setting) — so the panel says "Saved" and
 * does not wait for the canvas's Save.
 */
export function AgentToolPanel({
  workflow,
  readOnly,
  onChanged,
}: {
  workflow: Workflow;
  readOnly: boolean;
  onChanged: (workflow: Workflow) => void;
}) {
  const toast = useToast();
  const tool = workflow.agentTool;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "clear">(null);
  const [error, setError] = useState<string | null>(null);

  const clear = async () => {
    setBusy("clear");
    setError(null);
    try {
      onChanged(await api.clearAgentTool(workflow.id));
      toast({ tone: "ok", title: "Agents can no longer call this workflow" });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "That could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  if (editing) {
    return (
      <Section>
        <ToolForm
          workflow={workflow}
          initial={tool}
          busy={busy === "save"}
          error={error}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
          onSave={async (next) => {
            setBusy("save");
            setError(null);
            try {
              onChanged(await api.setAgentTool(workflow.id, next));
              toast({ tone: "ok", title: `Agents can call this as ${toolWireName(next)}` });
              setEditing(false);
            } catch (caught) {
              setError(caught instanceof ApiRequestError ? caught.message : "That could not be saved.");
            } finally {
              setBusy(null);
            }
          }}
        />
      </Section>
    );
  }

  return (
    <Section>
      {tool ? (
        <>
          <p className="text-2xs leading-relaxed">
            An agent that lists this workflow among its tools sees{" "}
            <code className="font-mono font-bold">{toolWireName(tool)}</code>:
          </p>
          <p className="border-line-soft bg-sunken rounded-lg border-2 p-2 text-2xs leading-relaxed text-pretty">
            {tool.description}
          </p>
          {tool.fields.length > 0 ? (
            <ul className="space-y-0.5 text-2xs">
              {tool.fields.map((field) => (
                <li key={field.name}>
                  <code className="font-mono font-bold">{`{{trigger.${field.name}}}`}</code>{" "}
                  <span className="text-muted">
                    {field.type}
                    {field.required ? "" : ", optional"}
                    {field.description ? ` — ${field.description}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-2xs">It takes no inputs.</p>
          )}
          {error && <Notice tone="bad" title={error} />}
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setEditing(true)}>Edit</Button>
              <Button tone="danger" loading={busy === "clear"} onClick={() => void clear()}>
                Stop offering
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-muted text-2xs leading-relaxed text-pretty">
            Let an agent call this workflow as a tool. It runs as a run of its own, and the arguments the
            agent sends arrive as this trigger&rsquo;s payload. An agent still has to list it among its
            tools — offering it here hands it to none.
          </p>
          {!readOnly && <Button onClick={() => setEditing(true)}>Offer to agents…</Button>}
        </>
      )}
    </Section>
  );
}

type DraftField = {
  /** Identity for the row in the form only — never sent. */
  key: number;
  name: string;
  type: (typeof TOOL_FIELD_TYPES)[number];
  description: string;
  required: boolean;
};

/** Rows get an identity of their own so removing one does not hand its form state to the next. */
let nextRowKey = 0;
const rowKey = () => nextRowKey++;

type Draft = {
  name: string;
  description: string;
  fields: DraftField[];
};

/** A first name for the tool, from the workflow's own: "Send receipt!" → `send_receipt`. */
function suggestName(workflowName: string): string {
  const slug = workflowName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(slug) && slug.length >= 2 ? slug : "";
}

function ToolForm({
  workflow,
  initial,
  busy,
  error,
  onCancel,
  onSave,
}: {
  workflow: Workflow;
  initial: WorkflowAgentTool | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (tool: WorkflowAgentTool) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    name: initial?.name ?? suggestName(workflow.name),
    description: initial?.description ?? "",
    fields: initial?.fields.map((field) => ({ ...field, key: rowKey() })) ?? [],
  }));
  const [problem, setProblem] = useState<string | null>(null);

  const setField = (index: number, patch: Partial<DraftField>) =>
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, at) => (at === index ? { ...field, ...patch } : field)),
    }));

  const submit = () => {
    const parsed = workflowAgentToolSchema.safeParse({
      ...draft,
      fields: draft.fields.map(({ key: _row, ...field }) => field),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]!;
      const where = first.path[0] === "fields" ? `Input ${Number(first.path[1]) + 1}: ` : "";
      setProblem(`${where}${first.message}`);
      return;
    }
    setProblem(null);
    void onSave(parsed.data);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Labelled
        label="Name"
        hint={
          <>
            What the model calls it: <code className="font-mono">workflow_{draft.name || "name"}</code>
          </>
        }
      >
        <Input
          value={draft.name}
          maxLength={40}
          spellCheck={false}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className="font-mono"
        />
      </Labelled>

      <Labelled
        label="What it does"
        hint={
          <>
            A model reads this to decide <em>when</em> to call it. Say what it does and when to use it.
          </>
        }
      >
        <Textarea
          rows={3}
          maxLength={500}
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </Labelled>

      <fieldset className="min-w-0 space-y-2 border-0 p-0">
        <legend className="text-ui font-semibold">Inputs</legend>
        {draft.fields.length === 0 && (
          <p className="text-muted text-2xs">None yet. A tool with no inputs is called with nothing.</p>
        )}
        {draft.fields.map((field, index) => (
          <div key={field.key} className="border-line-soft space-y-1.5 rounded-lg border-2 p-2">
            <div className="flex gap-1.5">
              <Input
                aria-label={`Input ${index + 1} name`}
                placeholder="order_id"
                value={field.name}
                maxLength={30}
                spellCheck={false}
                onChange={(event) => setField(index, { name: event.target.value })}
                className="min-w-0 font-mono"
              />
              <Select
                aria-label={`Input ${index + 1} type`}
                value={field.type}
                onChange={(event) => setField(index, { type: event.target.value as DraftField["type"] })}
                className="w-28 shrink-0"
              >
                {TOOL_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              aria-label={`Input ${index + 1} description`}
              placeholder="What the model should put here"
              value={field.description}
              maxLength={200}
              onChange={(event) => setField(index, { description: event.target.value })}
            />
            <div className="flex items-center justify-between gap-2">
              <Toggle
                label="Required"
                checked={field.required}
                onChange={(event) => setField(index, { required: event.target.checked })}
                className="text-2xs"
              />
              <button
                type="button"
                className="btn btn-quiet px-2 py-0.5 text-2xs"
                onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, at) => at !== index) })}
              >
                Remove<span className="sr-only"> input {index + 1}</span>
              </button>
            </div>
          </div>
        ))}
        {draft.fields.length < 12 && (
          <Button
            onClick={() =>
              setDraft({
                ...draft,
                fields: [...draft.fields, { key: rowKey(), name: "", type: "string", description: "", required: true }],
              })
            }
          >
            Add an input
          </Button>
        )}
      </fieldset>

      {(problem ?? error) && <Notice tone="bad" title={(problem ?? error)!} />}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" tone="primary" loading={busy}>
          {initial ? "Save" : "Offer to agents"}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <hr className="border-line-soft" />
      <h3 className="eyebrow">Agent tool</h3>
      {children}
    </section>
  );
}
