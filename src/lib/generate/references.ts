import { describeNodes, type NodeSummary } from "@/lib/nodes";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { referencesIn } from "@/lib/workflow/template";

/**
 * **Does every `{{ }}` reference in a graph point at something that will be there? — Phase 34.**
 *
 * `validateGraph` proves a workflow *can* run. It cannot see that `{{steps.summarise.output.summary}}`
 * names a field the LLM node never produces, and the template layer turns a reference to nothing
 * into an empty string, or `null` for a whole-string one (`template.ts`) — so the run succeeds and
 * a Discord message goes out blank, or a Sheets cell refuses `null` and the run fails two nodes
 * later than the mistake. **That is the "valid graph, wrong behaviour" failure, and it is the one
 * `smoke.mjs` kept hitting** (`PROGRESS.md` → *Known Issues*).
 *
 * This is a static check over the stored graph, built for the eval set (`eval/score.ts`). It is
 * deliberately narrow — **a problem reported here is a reference that cannot resolve**, never a
 * matter of style:
 *
 *  - a root the run scope does not have (`{{summary}}`, `{{env.KEY}}`)
 *  - `steps.<id>` naming no node, or a node that cannot have run before this one
 *  - a field the source node's output does not declare, where the node says what it outputs
 *
 * Where the shape is not known — a webhook's body, a manual run's input, a node whose
 * `outputShape` is prose — it says nothing. A false alarm here would teach whoever reads the eval
 * report to ignore the column.
 */

export interface ReferenceProblem {
  /** The node whose config holds the reference. */
  nodeId: string;
  /** The path inside `{{ }}`, as written. */
  reference: string;
  message: string;
}

/** What a node's output can be asked for: named fields, or anything at all. */
type Fields = Set<string> | "any";

/** The run scope's roots — `execute.ts` → `templateScope`. */
const ROOTS = new Set(["run", "trigger", "input", "steps", "node"]);
const RUN_FIELDS = new Set(["id", "workflowId"]);
const NODE_FIELDS = new Set(["id", "iteration"]);

/** Nodes whose output is their input — `registry.test.ts` names the same four as pass-through. */
const PASS_THROUGH = new Set(["core.delay", "core.log", "core.assert"]);

/** `a.b[0].c` → `["a", "b", "0", "c"]`, as `template.ts` reads it. */
function segments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment.length > 0);
}

/**
 * The top-level keys of every `{ … }` in an `outputShape`. `"{ text: the answer, json: …, model }"`
 * → text, json, model. A node with several shapes (`transform.text`, the loop's two outputs) gets
 * the union, which errs towards accepting. `null` when the shape is prose with no braces.
 */
export function declaredFields(outputShape: string | undefined): Set<string> | null {
  if (!outputShape) return null;
  const fields = new Set<string>();
  let depth = 0;
  let part = "";

  // A shape may show a reference as an example ("Reach its fields with {{trigger.<field>}}"),
  // which is not a shape.
  for (const char of outputShape.replace(/\{\{[^}]*\}\}/g, "")) {
    if (char === "{") {
      depth += 1;
      if (depth === 1) {
        part = "";
        continue;
      }
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        addKey(fields, part);
        continue;
      }
    }
    if (depth === 1 && char === ",") {
      addKey(fields, part);
      part = "";
      continue;
    }
    if (depth >= 1) part += char;
  }

  return fields.size > 0 ? fields : null;
}

function addKey(fields: Set<string>, part: string) {
  const key = /^\s*([A-Za-z_]\w*)/.exec(part)?.[1];
  if (key) fields.add(key);
}

export function checkReferences(
  graph: WorkflowGraph,
  catalogue: NodeSummary[] = describeNodes(),
): ReferenceProblem[] {
  const summaries = new Map(catalogue.map((node) => [node.type, node]));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, { source: string; sourceHandle: string | null }[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push({ source: edge.source, sourceHandle: edge.sourceHandle ?? null });
    incoming.set(edge.target, list);
  }

  /** Every node with a path to `id`. A node in a loop is its own ancestor, which is right. */
  function ancestors(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = (incoming.get(id) ?? []).map((edge) => edge.source);
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      for (const edge of incoming.get(next) ?? []) stack.push(edge.source);
    }
    return seen;
  }

  const outputMemo = new Map<string, Fields>();

  /** What `{{input.x}}` can name inside `id`: the union of what every edge into it carries. */
  function inputFields(id: string, visiting: Set<string>): Fields {
    const edges = incoming.get(id) ?? [];
    if (edges.length === 0) return "any";
    const union = new Set<string>();
    for (const edge of edges) {
      const fields = edgeFields(edge.source, edge.sourceHandle, visiting);
      if (fields === "any") return "any";
      for (const field of fields) union.add(field);
    }
    return union;
  }

  /** The loop is the one node whose two outputs carry different shapes, so the handle decides. */
  function edgeFields(source: string, handle: string | null, visiting: Set<string>): Fields {
    if (byId.get(source)?.type === "core.loop") {
      if (handle === "loop") return new Set(["index", "item", "total"]);
      if (handle === "done") return new Set(["done", "iterations", "items"]);
    }
    return outputFields(source, visiting);
  }

  function outputFields(id: string, visiting: Set<string> = new Set()): Fields {
    const memo = outputMemo.get(id);
    if (memo) return memo;
    // A cycle through pass-through nodes says nothing definite. Accept rather than guess.
    if (visiting.has(id)) return "any";
    visiting.add(id);

    const node = byId.get(id);
    let fields: Fields = "any";
    if (node) {
      if (node.type === "core.schedule_trigger") {
        fields = new Set(["firedAt", "cron", "scheduledFor"]);
      } else if (PASS_THROUGH.has(node.type)) {
        fields = inputFields(id, visiting);
      } else if (node.type === "core.set") {
        const configured = node.config.fields;
        const own =
          configured && typeof configured === "object" && !Array.isArray(configured)
            ? Object.keys(configured)
            : null;
        if (own) {
          const merged = node.config.merge === true ? inputFields(id, visiting) : new Set<string>();
          fields = merged === "any" ? "any" : new Set([...merged, ...own]);
        }
      } else if (summaries.get(node.type)?.kind !== "trigger") {
        // A webhook body or a manual run's input is whatever the caller sends: unknowable here.
        fields = declaredFields(summaries.get(node.type)?.outputShape) ?? "any";
      }
    }

    visiting.delete(id);
    outputMemo.set(id, fields);
    return fields;
  }

  const problems: ReferenceProblem[] = [];

  for (const node of graph.nodes) {
    const upstream = ancestors(node.id);
    for (const reference of new Set(referencesIn(node.config))) {
      const parts = segments(reference);
      const [root, second, third, fourth] = parts;
      const problem = (message: string) => problems.push({ nodeId: node.id, reference, message });

      if (!root || !ROOTS.has(root)) {
        problem(`"${root ?? reference}" is not something a reference can read — use input, trigger, steps, run or node.`);
        continue;
      }
      if (root === "run" && second !== undefined && !RUN_FIELDS.has(second)) {
        problem(`run has no "${second}" — it has ${[...RUN_FIELDS].join(" and ")}.`);
        continue;
      }
      if (root === "node" && second !== undefined && !NODE_FIELDS.has(second)) {
        problem(`node has no "${second}" — it has ${[...NODE_FIELDS].join(" and ")}.`);
        continue;
      }
      if (root === "trigger" && second !== undefined) {
        const trigger = graph.nodes.find((entry) => summaries.get(entry.type)?.kind === "trigger");
        const fields = trigger ? outputFields(trigger.id) : "any";
        if (fields !== "any" && !fields.has(second)) {
          problem(`the trigger's output has no "${second}" — it has ${[...fields].join(", ")}.`);
        }
        continue;
      }
      if (root === "input" && second !== undefined) {
        const fields = inputFields(node.id, new Set());
        if (fields !== "any" && !fields.has(second)) {
          problem(
            `the input here has no "${second}" — it has ${[...fields].join(", ")}. ` +
              `Reach an earlier node's output with {{steps.<nodeId>.output.<field>}}.`,
          );
        }
        continue;
      }
      if (root === "steps") {
        if (second === undefined) continue;
        if (!byId.has(second)) {
          problem(`there is no node "${second}".`);
          continue;
        }
        if (!upstream.has(second)) {
          problem(`"${second}" cannot have run before "${node.id}" — no path leads from it to here.`);
          continue;
        }
        if (third !== "output") {
          if (third !== undefined) problem(`a step holds only its output: {{steps.${second}.output…}}.`);
          continue;
        }
        if (fourth === undefined) continue;
        const fields = outputFields(second);
        if (fields !== "any" && !fields.has(fourth)) {
          problem(`"${second}"'s output has no "${fourth}" — it has ${[...fields].join(", ")}.`);
        }
      }
    }
  }

  return problems;
}
