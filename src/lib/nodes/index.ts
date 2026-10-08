import { z } from "zod";

import { agentNode } from "./ai/agent";
import { llmNode } from "./ai/llm";
import { assertNode } from "./core/assert";
import { branchNode } from "./core/branch";
import { delayNode } from "./core/delay";
import { logNode } from "./core/log";
import { loopNode } from "./core/loop";
import { manualTrigger } from "./core/manual-trigger";
import { scheduleTrigger } from "./core/schedule-trigger";
import { setNode } from "./core/set";
import { switchNode } from "./core/switch";
import { webhookTrigger } from "./core/webhook-trigger";
import { airtableNode } from "./integration/airtable";
import { discordNode } from "./integration/discord";
import { githubNode } from "./integration/github";
import { gmailNode } from "./integration/gmail";
import { httpNode } from "./integration/http";
import { notionNode } from "./integration/notion";
import { postgresNode } from "./integration/postgres";
import { sheetsNode } from "./integration/sheets";
import { slackNode } from "./integration/slack";
import { aggregateNode } from "./transform/aggregate";
import { dateNode } from "./transform/date";
import { filterNode } from "./transform/filter";
import { jsonNode } from "./transform/json";
import { mapNode } from "./transform/map";
import { numberNode } from "./transform/number";
import { sortNode } from "./transform/sort";
import { textNode } from "./transform/text";
import { uniqueNode } from "./transform/unique";
import type { RegisteredNode } from "./types";

/**
 * The node registry — ARCHITECTURE.md → "The node registry is the spine".
 *
 * One table, three consumers: the engine dispatches through `get`, the canvas
 * builds its palette from `listNodes`, and the agent's tool set comes from
 * `listAgentTools`. Phases 8 and 9 added entries here and nothing else: neither
 * phase touched the palette, the config forms, the validator, or the generation
 * prompt's catalogue, because all four are rendered from this table.
 *
 * One caveat worth stating precisely, because the looser claim was almost written
 * here: Phase 9 *did* edit `generate/prompt.ts`. Not the catalogue — the prose
 * beneath it, which hardcoded "sending email, posting to a chat service, writing to
 * a spreadsheet" as its examples of things to report as `unsupported`. Registering
 * the nodes was not enough to stop the model believing that sentence. **A prompt
 * that names specifics dates like code, and nothing type-checks prose.**
 *
 * Security boundary: the agent can reach these entries and nothing else. There is
 * no shell node and no filesystem node. `integration.http` is the one entry that
 * reaches an arbitrary host, and it is bounded by `src/lib/integrations/guard.ts`
 * rather than by trust: https only, public addresses only, redirects reported and
 * never followed. `integration.gmail` is deliberately **not** agent-callable — see
 * the note on its definition.
 */
const definitions: RegisteredNode[] = [
  manualTrigger,
  webhookTrigger,
  scheduleTrigger,
  setNode,
  logNode,
  branchNode,
  switchNode,
  loopNode,
  delayNode,
  assertNode,
  filterNode,
  mapNode,
  sortNode,
  uniqueNode,
  aggregateNode,
  jsonNode,
  textNode,
  numberNode,
  dateNode,
  llmNode,
  agentNode,
  httpNode,
  discordNode,
  slackNode,
  sheetsNode,
  gmailNode,
  notionNode,
  githubNode,
  airtableNode,
  postgresNode,
];

const byType = new Map<string, RegisteredNode>();
for (const definition of definitions) {
  if (byType.has(definition.type)) {
    throw new Error(`Duplicate node type registered: ${definition.type}`);
  }
  byType.set(definition.type, definition);
}

export function getNode(type: string): RegisteredNode | undefined {
  return byType.get(type);
}

export function listNodes(): RegisteredNode[] {
  return [...definitions];
}

export function hasNode(type: string): boolean {
  return byType.has(type);
}

/**
 * What the canvas palette needs. Excludes `execute` deliberately — this shape
 * crosses to the client, and a function would not survive serialisation anyway.
 */
export interface NodeSummary {
  type: string;
  label: string;
  description: string;
  kind: RegisteredNode["kind"];
  category: RegisteredNode["category"];
  outputs: RegisteredNode["outputs"];
  /** One line on the shape of `output`, when a node has one worth stating. */
  outputShape?: string;
  /** Long-form help for the inspector — Phase 23A. Plain data, like everything here. */
  docs?: RegisteredNode["docs"];
  agentCallable: boolean;
  /** What running it does outside the product — Phase 31. Absent for a node that only reads. */
  effect?: RegisteredNode["effect"];
  configSchema: unknown;
}

export function describeNode(definition: RegisteredNode): NodeSummary {
  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    kind: definition.kind,
    category: definition.category,
    outputs: definition.outputs.map((output) => ({ key: output.key, label: output.label })),
    ...(definition.outputShape === undefined ? {} : { outputShape: definition.outputShape }),
    ...(definition.docs === undefined ? {} : { docs: definition.docs }),
    agentCallable: definition.agentCallable ?? false,
    ...(definition.effect === undefined ? {} : { effect: definition.effect }),
    // Forced through JSON so the result is plain data by construction, not by
    // luck of what `toJSONSchema` happens to build. This shape crosses to the
    // client, and Phase 4 renders the canvas in a server component: React refuses
    // to serialise anything that is not a plain object across that boundary, and
    // the failure is a console error at render time rather than a type error.
    configSchema: JSON.parse(
      JSON.stringify(z.toJSONSchema(definition.configSchema, { io: "input" })),
    ) as unknown,
  };
}

export function describeNodes(): NodeSummary[] {
  return listNodes().map(describeNode);
}

/**
 * The agent's tool surface, derived rather than declared. Phase 6 turns these into
 * provider tool definitions; the filtering rule lives here so there is exactly one
 * answer to "what may the agent call".
 */
export function listAgentTools(): RegisteredNode[] {
  return listNodes().filter((definition) => definition.agentCallable === true);
}

export * from "./types";
