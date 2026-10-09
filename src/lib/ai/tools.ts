import { z } from "zod";

import { listAgentTools, type RegisteredNode } from "@/lib/nodes";

import { toToolParameters } from "./schema";
import type { ToolSpec } from "./types";

/**
 * The agent's tool surface, derived from the node registry — CONTRACT.md → "Agent
 * tool-call schema".
 *
 * There is no second list of tools anywhere. A node is callable by the agent exactly
 * when its definition says `agentCallable: true` (D19), so the security boundary and
 * the tool set are the same fact. The agent reaches these entries and nothing else:
 * no shell, no filesystem, no network beyond the explicit HTTP node when Phase 9
 * adds it.
 */

/**
 * Registry types are dotted (`core.log`); tool names are underscored (`core_log`).
 * Kept as an explicit, reversible mapping rather than passing the dotted name
 * through, so the wire name can never drift from the registry type by accident.
 */
export function toToolName(registryType: string): string {
  return registryType.replace(/\./g, "_");
}

export function projectTool(definition: RegisteredNode): ToolSpec {
  const json = z.toJSONSchema(definition.configSchema, { io: "input" });
  const parameters = toToolParameters(json);
  return {
    name: toToolName(definition.type),
    // The node's own description, verbatim. It is written for a model
    // (`src/lib/nodes/types.ts`), which is why it is contract and not decoration.
    description: definition.description,
    parameters: parameters ?? null,
  };
}

export interface AgentToolSet {
  specs: ToolSpec[];
  /** Wire name → the node that runs it. The only dispatch path a tool call has. */
  byName: Map<string, RegisteredNode>;
  /** Registry types that were asked for but are not callable. Surfaced, not ignored. */
  rejected: string[];
}

/**
 * `allow` is what one agent node may call: **exactly the types it lists, and an empty list is
 * none** (D160, Phase 34 — least privilege). It can only ever *reduce* the callable registry — a
 * type listed in `allow` that is not `agentCallable` is reported in `rejected`, never granted.
 *
 * Until Phase 34 an empty list meant every callable node. A generated decision-only agent then
 * held Slack, Discord, Sheets, GitHub and HTTP without anyone asking, Phase 31's "this will post"
 * confirmation (keyed on a non-empty `tools`) never fired for it, and every node registered later
 * widened it silently — D19's own reason for opting nodes in one by one.
 *
 * Called with no `allow` at all it describes the whole callable surface — what the provider tests
 * and the budget measurement read. An agent node always passes its own list.
 */
export function agentToolSet(options: { allow?: string[] } = {}): AgentToolSet {
  const callable = listAgentTools();
  const callableTypes = new Set(callable.map((definition) => definition.type));

  const allow = options.allow?.filter((type) => type.length > 0);
  const rejected = allow?.filter((type) => !callableTypes.has(type)) ?? [];

  const chosen = allow ? callable.filter((definition) => allow.includes(definition.type)) : callable;

  const byName = new Map<string, RegisteredNode>();
  for (const definition of chosen) {
    const name = toToolName(definition.type);
    if (byName.has(name)) {
      throw new Error(
        `Two registry types project onto the tool name "${name}". Rename one.`,
      );
    }
    byName.set(name, definition);
  }

  return {
    specs: chosen.map(projectTool),
    byName,
    rejected,
  };
}
