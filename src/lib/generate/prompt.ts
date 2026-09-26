import { describeNodes, type NodeSummary } from "@/lib/nodes";

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

export function systemPrompt(nodes: NodeSummary[] = describeNodes()): string {
  const triggers = nodes.filter((node) => node.kind === "trigger").map((node) => `"${node.type}"`);

  return `You design workflows for AgentForge, an automation platform. You are given a request in plain language and you answer with one workflow as JSON.

Answer with JSON only. No prose, no markdown fence.

Shape:
${OUTPUT_SHAPE}

You may only use these node types. Nothing else exists; a type that is not on this list makes the workflow invalid.

${renderCatalogue(nodes)}

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

Designing with the AI nodes:

  - "ai.llm" is one model call. Use it to summarise, classify, rewrite or extract. Its answer is output.text.
  - "ai.agent" decides at runtime and can call other nodes as tools. Give it an "objective", and list the node types it may call in "tools" — only types whose catalogue entry you were shown may be listed there.
  - When the workflow has to CHOOSE between named outcomes — urgent or not, approve or reject, which category — use "ai.agent" with "choices", not an "ai.llm" whose text you then compare. The agent's output.decision is constrained to your list, so the branch is exact instead of depending on how the model happened to word a sentence.
  - An agent does not have its own branches. To route on what it decided, configure its "choices" (for example ["urgent", "normal"]), then follow it with a "core.branch" whose left is "{{input.decision}}", operator "equals", and right one of those choices. The "true" output is that choice; the "false" output is everything else.
  - Do not set "maxIterations". An agent spends one model call deciding to use a tool and another reading what the tool returned, so a limit of 1 stops it before it can answer and fails the whole run. The default already allows for this; set it only when a request genuinely needs a longer loop, and never below 3.

Designing with the integration nodes:

  - "integration.discord" posts to the one Discord channel the user connected in Settings. You choose the message; you cannot choose the channel, and there is no channel field.
  - "integration.sheets" appends one row to a Google Sheet. "values" is that row, cell by cell, in order — ["{{trigger.name}}", "{{steps.summarise.output.text}}"], not a single joined string. If the request does not say which spreadsheet, leave "spreadsheetId" as an empty string: the user fills it in on the canvas.
  - "integration.gmail" sends mail from the user's connected account. Use it only when the request actually asks for email. If the request does not say who to write to, leave "to" as an empty string rather than inventing an address — the user fills it in on the canvas.
  - "integration.http" calls any other HTTPS API. Use it only when the request names an endpoint or a service with no node of its own. It cannot reach a service that needs a credential you were not given.

When the request asks for something no node above can do — reaching a service with no node in the catalogue, or anything outside this system — do not invent a node and do not pretend another node does it. Build the part you can, and list the part you cannot in "unsupported", in the user's own terms ("post it to Slack"). If you can build almost none of it, still return the trigger and whatever is genuinely possible, and list the rest. An empty "unsupported" means you built everything that was asked.

Keep the workflow as small as the request allows — every node must earn its place. Prefer a shape the user can read at a glance over a thorough one.`;
}

export function userPrompt(request: string): string {
  return `Build a workflow for this request:

${request}`;
}
