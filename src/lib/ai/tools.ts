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
 * `allow` is an optional per-node narrowing: a workflow may give one agent node a
 * subset of the callable registry. It can only ever *reduce* the set — a type listed
 * in `allow` that is not `agentCallable` is reported in `rejected`, never granted.
 */
export function agentToolSet(options: { allow?: string[] } = {}): AgentToolSet {
  const callable = listAgentTools();
  const callableTypes = new Set(callable.map((definition) => definition.type));

  const allow = options.allow?.filter((type) => type.length > 0);
  const rejected = allow?.filter((type) => !callableTypes.has(type)) ?? [];

  const chosen =
    allow && allow.length > 0
      ? callable.filter((definition) => allow.includes(definition.type))
      : callable;

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
