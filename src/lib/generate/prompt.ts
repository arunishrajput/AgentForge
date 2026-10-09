import { describeNodes, type NodeSummary } from "@/lib/nodes";
import type { WorkflowGraph } from "@/lib/workflow/graph";

/**
 * The prompt the generator sends — BUILD_PLAN.md Phase 7, "Feed the model the
 * registry's node catalogue so it can only reference nodes that exist".
 *
 * The catalogue is rendered from `describeNodes()`, the same projection the canvas
 * palette and the agent's tool set read. A hand-written node list in a prompt would
 * drift the first time a node changed its config or its outputs, and the drift would
 * surface as a model emitting a config the engine rejects — i.e. on demo day. This
 * way, registering a node in Phase 8 or 9 makes it generatable with no change here.
 *
 * Every rule below is one `validateGraph` actually enforces. The prompt states them
 * so the first attempt usually passes; validation is what makes it safe when it does
 * not (CONTRACT.md → "Graph validation").
 */

/** Rendered per node so the model sees which config keys exist and what they accept. */
interface JsonSchemaLike {
  type?: unknown;
  enum?: unknown;
  default?: unknown;
  properties?: Record<string, JsonSchemaLike>;
  required?: unknown;
  items?: JsonSchemaLike;
}

function describeType(schema: JsonSchemaLike): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `one of ${schema.enum.map((value) => JSON.stringify(value)).join(" | ")}`;
  }
  if (schema.type === "array") {
    const item = schema.items ? describeType(schema.items) : "any";
    return `array of ${item}`;
  }
  if (typeof schema.type === "string") return schema.type;
  // `z.unknown()` emits `{}` — a field that takes any JSON value, such as a
  // branch's `left`. Saying so is more useful to a model than saying nothing.
  return "any";
}

/**
 * One line per config field. Only the facts a model needs to fill the field in:
 * name, what it accepts, whether it must be present, and what happens if it is not.
 */
export function describeConfigSchema(schema: unknown): string[] {
  const root = schema as JsonSchemaLike | undefined;
  const properties = root?.properties;
  if (!properties || Object.keys(properties).length === 0) return [];

  const required = new Set(
    Array.isArray(root?.required) ? root.required.filter((key): key is string => typeof key === "string") : [],
  );

  return Object.entries(properties).map(([key, field]) => {
    const parts = [`${key}: ${describeType(field)}`];
    if (required.has(key)) parts.push("REQUIRED");
    else if (field.default !== undefined) parts.push(`default ${JSON.stringify(field.default)}`);
    else parts.push("optional");
    return `      - ${parts.join(", ")}`;
  });
}

function describeOutputs(node: NodeSummary): string {
  return node.outputs
    .map((output) => (output.key === null ? "(default, omit sourceHandle)" : `"${output.key}"`))
    .join(", ");
}

export function renderCatalogue(nodes: NodeSummary[] = describeNodes()): string {
  return nodes
    .map((node) => {
      const lines = [
        `  - type: "${node.type}"  (${node.kind}, ${node.category})`,
        `    name: ${node.label}`,
        `    what it does: ${node.description}`,
        `    outputs: ${describeOutputs(node)}`,
      ];
      // What the node produces, so a {{ }} reference to it can be written correctly.
      // Without this a model writes `{{steps.x.output}}` where it means
      // `{{steps.x.output.text}}`, and the graph is valid but does the wrong thing.
      if (node.outputShape) lines.push(`    output value: ${node.outputShape}`);
      const config = describeConfigSchema(node.configSchema);
      if (config.length > 0) lines.push("    config:", ...config);
      else lines.push("    config: none");
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * The output contract, stated as a shape rather than as a JSON Schema. Gemini's JSON
 * mode is asked for separately (`json: true`); this is what tells the model which
 * keys to fill, and it deliberately omits `position`, edge `id` and `version`, which
 * the system supplies (see `schema.ts`).
 */
const OUTPUT_SHAPE = `{
  "name": "short title for the workflow",
  "description": "one sentence on what it does",
  "nodes": [
    { "id": "trigger", "type": "core.manual_trigger", "label": "optional display name", "config": {} }
  ],
  "edges": [
    { "source": "trigger", "target": "summarise", "sourceHandle": null }
  ],
  "unsupported": ["any part of the request no node above can do"]
}`;

/**
 * **The index — Phase 34.** One line for every node, always sent: the model knows everything that
 * exists even when only some of it is defined in full, so it can still reach an unselected node
 * and can still say honestly what does *not* exist. The line is the type, the label and the first
 * sentence of the model-facing description — the sentence that says what the node is.
 */
export function indexLine(node: NodeSummary): string {
  const first = node.description.split(/(?<=\.)\s+(?=[A-Z])/)[0] ?? node.description;
  return `  - "${node.type}" (${node.label}) — ${first}`;
}

export function renderIndex(nodes: NodeSummary[] = describeNodes()): string {
  return nodes.map(indexLine).join("\n");
}

/**
 * Advice the prompt gives about particular nodes, sent only when that node is defined in full.
 * Keyed by type so it follows the selection, and so a test can hold every key to a registered
 * node — **a prompt that names specifics dates like code** (`nodes/index.ts`), and a key for a node
 * that no longer exists is exactly that rot.
 */
export const GUIDANCE: { section: "ai" | "integration"; type: string; text: string }[] = [
  {
    section: "ai",
    type: "ai.llm",
    text: '"ai.llm" is one model call. Use it to summarise, classify, rewrite or extract. Its answer is output.text.',
  },
  {
    section: "ai",
    type: "ai.agent",
    text: '"ai.agent" decides at runtime and can call other nodes as tools. Give it an "objective", and list the node types it may call in "tools" — only types from the list of node types above. It can call only what it lists: an agent that only decides needs no "tools".',
  },
  {
    section: "ai",
    type: "ai.agent",
    text: 'When the workflow has to CHOOSE between named outcomes — urgent or not, approve or reject, which category — use "ai.agent" with "choices", not an "ai.llm" whose text you then compare. The agent\'s output.decision is constrained to your list, so the branch is exact instead of depending on how the model happened to word a sentence.',
  },
  {
    section: "ai",
    type: "ai.agent",
    text: 'An agent does not have its own branches. To route on what it decided, configure its "choices" (for example ["urgent", "normal"]), then follow it with a "core.branch" whose left is "{{input.decision}}", operator "equals", and right one of those choices. The "true" output is that choice; the "false" output is everything else.',
  },
  {
    section: "ai",
    type: "ai.agent",
    text: 'Do not set "maxIterations". An agent spends one model call deciding to use a tool and another reading what the tool returned, so a limit of 1 stops it before it can answer and fails the whole run. The default already allows for this; set it only when a request genuinely needs a longer loop, and never below 3.',
  },
  {
    section: "integration",
    type: "integration.discord",
    text: '"integration.discord" posts to the one Discord channel the user connected in Settings. You choose the message; you cannot choose the channel, and there is no channel field.',
  },
  {
    section: "integration",
    type: "integration.sheets",
    text: '"integration.sheets" appends one row to a Google Sheet. "values" is that row, cell by cell, in order — ["{{trigger.name}}", "{{steps.summarise.output.text}}"], not a single joined string. If the request does not say which spreadsheet, leave "spreadsheetId" as an empty string: the user fills it in on the canvas.',
  },
  {
    section: "integration",
    type: "integration.gmail",
    text: '"integration.gmail" sends mail from the user\'s connected account. Use it only when the request actually asks for email. If the request does not say who to write to, leave "to" as an empty string rather than inventing an address — the user fills it in on the canvas.',
  },
  {
    section: "integration",
    type: "integration.http",
    text: '"integration.http" calls any other HTTPS API. Use it only when the request names an endpoint or a service with no node of its own. It cannot reach a service that needs a credential you were not given.',
  },
];

function renderGuidance(selected: Set<string>): string {
  const sections: [string, string][] = [
    ["ai", "Designing with the AI nodes:"],
    ["integration", "Designing with the integration nodes:"],
  ];
  return sections
    .map(([section, heading]) => {
      const lines = GUIDANCE.filter((entry) => entry.section === section && selected.has(entry.type));
      return lines.length === 0 ? "" : `${heading}\n\n${lines.map((entry) => `  - ${entry.text}`).join("\n")}\n\n`;
    })
    .join("");
}

/**
 * **What the copilot is told on top of everything generation is told — Phase 35.** The catalogue,
 * the rules and the references are the same prompt, because an edited workflow must pass exactly
 * what a generated one passes; these are only the things that are true of an edit.
 */
const EDIT_RULES = `Editing rules — this is a change to a workflow somebody already built:

  - Change only what the request asks for. Every node and connection the change does not touch stays exactly as it is: the same id, type, label and config, copied unchanged.
  - Never change an existing node's id. Other nodes read it as {{steps.<id>…}} and its run history is filed under it. A node you add gets a new id, by the same rule as any other.
  - To remove a node, leave it out together with every edge to or from it, and fix any {{steps.<id>…}} that read it.
  - "Rename" a step means its "label". Keep "name" and "description" exactly as they are: the workflow's own name is not yours to change. If you are asked to rename the workflow itself, list "rename the workflow — type the new name in the toolbar" in "unsupported".
  - An edge with "sourceHandle": "error" leaves a node's Error output, which carries that node's failures; keep it unless the request is about it. Whether a node sends its failures there is a setting only the person can change, in the step's inspector — if a request needs it, build the rest and list "send <step>'s failures to its Error path" in "unsupported".
  - "unsupported" lists the parts of this change you could not make. An empty list means you made all of it.

`;

/** The opening line: what the model is given, and what it answers with. */
const OPENING = {
  generate:
    "You design workflows for AgentForge, an automation platform. You are given a request in plain language and you answer with one workflow as JSON.",
  edit: "You edit workflows for AgentForge, an automation platform. You are given a workflow that already exists, as JSON, and a change somebody wants made to it, in plain language. You answer with the whole workflow after the change, as JSON, in the same shape.",
} as const;

export type PromptMode = keyof typeof OPENING;

/**
 * The generation system prompt. `selected` names the nodes defined in full (`select.ts`); every
 * other node appears only as its index line. Omitted, every node is defined — the whole catalogue,
 * which is what generation sent before Phase 34 and what the `full` strategy still sends.
 *
 * `mode` is Phase 35's: `edit` is the copilot's prompt, which is this one with a different opening
 * and the editing rules — never a second prompt that could drift from the first.
 */
export function systemPrompt(
  nodes: NodeSummary[] = describeNodes(),
  selected?: string[],
  mode: PromptMode = "generate",
): string {
  const chosen = new Set(selected ?? nodes.map((node) => node.type));
  const defined = nodes.filter((node) => chosen.has(node.type));
  const everything = defined.length === nodes.length;
  const triggers = nodes.filter((node) => node.kind === "trigger").map((node) => `"${node.type}"`);

  const catalogue = everything
    ? `You may only use these node types. Nothing else exists; a type that is not on this list makes the workflow invalid.

${renderCatalogue(defined)}`
    : `The node types that exist — every one, and nothing else. A type that is not on this list makes the workflow invalid:

${renderIndex(nodes)}

Full definitions of the nodes this request most likely needs — their config fields and what they output:

${renderCatalogue(defined)}

If the request needs a node from the list whose definition is not here, use it all the same, setting only the config its line implies; if that config is wrong you will be shown its full definition.`;

  return `${OPENING[mode]}

Answer with JSON only. No prose, no markdown fence.

Shape:
${OUTPUT_SHAPE}

${catalogue}

Rules — a workflow that breaks any of these is rejected:

1. Exactly one trigger node. The available trigger types are: ${triggers.join(", ")}. No edge may point AT a trigger.
2. Node ids are short, readable, lowercase, derived from what the node does ("summarise", "route", "log_urgent"). Unique within the workflow. They are persisted and shown to the user, so they are never uuids or "node1".
3. Every edge "source" and "target" must be an id in your own nodes array.
4. "sourceHandle" must be one of the source node's declared outputs, exactly as written above. Omit it, or use null, for a node whose only output is the default one. A branch node's edges must use "true" and "false"; a loop node's must use "loop" and "done".
5. The only legal cycle is one that closes back through a loop node's "loop" output. Never point a node back at an earlier node otherwise.
6. Connect every node. A node with no edges does nothing.

Config values may reference earlier data with {{ }} — a plain lookup, not an expression. There are no operators, no arithmetic and no function calls inside {{ }}: "{{input.name}}" works, "{{input.a + input.b}}" does not. Available references:

  {{input.x}}                     the output of the node that led here
  {{trigger.x}}                   the data the workflow started with
  {{steps.<nodeId>.output.x}}     any earlier node's output, by its id
  {{run.id}}, {{node.id}}, {{node.iteration}}

Reference the exact field you want, never the whole output object. Each node's "output value" above says what it holds: "{{steps.summarise.output.text}}" is the LLM's answer, while "{{steps.summarise.output}}" is the whole object and compares as "[object Object]".

${renderGuidance(chosen)}${mode === "edit" ? EDIT_RULES : ""}When the request asks for something no node above can do — reaching a service with no node in the catalogue, or anything outside this system — do not invent a node and do not pretend another node does it. Build the part you can, and list the part you cannot in "unsupported", in the user's own terms ("post it to Slack"). If you can build almost none of it, still return the trigger and whatever is genuinely possible, and list the rest. An empty "unsupported" means you built everything that was asked.

Keep the workflow as small as the request allows — every node must earn its place. Prefer a shape the user can read at a glance over a thorough one.`;
}

export function userPrompt(request: string): string {
  return `Build a workflow for this request:

${request}`;
}

/** The workflow the copilot is asked to change, as it is written into the prompt. */
export interface EditSubject {
  name: string;
  description: string | null;
  graph: WorkflowGraph;
}

/**
 * **The graph as the model sees it — Phase 35.** Exactly the shape it answers in (`OUTPUT_SHAPE`),
 * so "copy it unchanged" is a literal instruction: id, type, label, config, and what connects to
 * what. **Everything else stays out**, and each for a reason (D163):
 *
 *   positions        the system's (D40) — a model asked to keep them would be asked to copy noise
 *   pinned outputs   **run data**: a captured webhook body or an API response, i.e. text somebody
 *                    else wrote. It never reaches a prompt (`SECURITY.md`)
 *   retry policy,    the person's, carried over by id. Not the model's to change, so not shown
 *   on/off, notes
 */
export function modelView(subject: EditSubject) {
  return {
    name: subject.name,
    description: subject.description ?? "",
    nodes: subject.graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      ...(node.label === undefined || node.label === "" ? {} : { label: node.label }),
      config: node.config ?? {},
    })),
    edges: subject.graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
  };
}

/**
 * The copilot's first turn: the workflow now, what was asked earlier in this conversation (which
 * the workflow shown already includes), and the change to make. `earlier` is how *refine* works —
 * "no, to #alerts" means nothing without "also post the urgent ones to Slack" before it.
 */
export function editPrompt(subject: EditSubject, instruction: string, earlier: readonly string[] = []): string {
  const before =
    earlier.length === 0
      ? ""
      : `\n\nEarlier in this conversation you were asked for these changes, and the workflow above already includes them:\n\n${earlier.map((line) => `- ${line}`).join("\n")}`;
  return `This is the workflow now:

${JSON.stringify(modelView(subject), null, 2)}${before}

Make this change:

${instruction}`;
}
