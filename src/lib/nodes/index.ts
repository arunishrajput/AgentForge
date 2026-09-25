import { z } from "zod";

import { assertNode } from "./core/assert";
import { branchNode } from "./core/branch";
import { delayNode } from "./core/delay";
import { logNode } from "./core/log";
import { loopNode } from "./core/loop";
import { manualTrigger } from "./core/manual-trigger";
import { setNode } from "./core/set";
import type { RegisteredNode } from "./types";

/**
 * The node registry — ARCHITECTURE.md → "The node registry is the spine".
 *
 * One table, three consumers: the engine dispatches through `get`, the canvas
 * builds its palette from `listNodes`, and the agent's tool set comes from
 * `listAgentTools`. Phases 8 and 9 add entries here; they do not build a second
 * registry, and adding an integration therefore widens what the agent can do
 * without any separate tool definition to drift out of sync.
 *
 * Security boundary: the agent can reach these entries and nothing else. There is
 * no shell, filesystem, or arbitrary-network node.
 */
const definitions: RegisteredNode[] = [
  manualTrigger,
  setNode,
  logNode,
  branchNode,
  loopNode,
  delayNode,
  assertNode,
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
  agentCallable: boolean;
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
    agentCallable: definition.agentCallable ?? false,
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
