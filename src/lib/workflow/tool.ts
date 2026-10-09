import { z } from "zod";

import type { ToolSpec } from "@/lib/ai/types";

/**
 * A workflow in an agent's `tools` list: `workflow:` and the workflow's id.
 *
 * **Defined twice on purpose**: the agent node reads it from `nodes/types.ts`, and this module may not
 * import `nodes/types.ts` — a value edge from here into the node layer made the production bundle
 * evaluate the node registry in an order that read `agentNode` before it existed (found in Phase 39's
 * first build; the registry's `agent → ai/tools → registry` cycle is old and fine, and is the thing that
 * is sensitive to what else imports around it). `tool.test.ts` asserts the two are the same.
 */
export const WORKFLOW_TOOL_PREFIX = "workflow:";
export function workflowIdOf(entry: string): string | null {
  return entry.startsWith(WORKFLOW_TOOL_PREFIX) && entry.length > WORKFLOW_TOOL_PREFIX.length ? entry.slice(WORKFLOW_TOOL_PREFIX.length) : null;
}

/**
 * **A workflow an agent may call — Phase 39, task 2** (D186).
 *
 * A workflow becomes a tool by two deliberate acts, which is D19's rule applied twice. Somebody with
 * the `editor` role marks the workflow *callable by agents* and describes it — a name, what it does
 * and the inputs it takes — and an `ai.agent` node then lists it **by id** among its `tools`. Neither
 * alone is enough, so adding a workflow to a workspace cannot widen what an existing agent may do, and
 * marking one does not hand it to every agent.
 *
 * What the model sees is only what is in this file's output: a wire name, a description and a
 * parameter schema. The workflow's graph, its credentials and its other workflows are not in it.
 *
 * Pure — no database, no registry — so the part a model reads and the part that validates what it
 * sent are asserted in a millisecond.
 */

/**
 * Prefixed onto every workflow tool's wire name. The registry's tool names are `namespace_name` with
 * a namespace from a closed set (`core`, `transform`, `integration`, `ai`), so a name that starts
 * with `workflow_` can never be one of them — a workflow cannot shadow a node, whatever it is called.
 */
export const TOOL_NAME_PREFIX = "workflow_";

export const TOOL_FIELD_TYPES = ["string", "number", "boolean"] as const;
export type ToolFieldType = (typeof TOOL_FIELD_TYPES)[number];

/** Tool names are `snake_case`: providers accept little else in a function name, and a model copes best with it. */
const NAME = /^[a-z][a-z0-9_]{1,39}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,29}$/;

export const toolFieldSchema = z.object({
  name: z.string().regex(FIELD_NAME, "Use lower-case letters, digits and underscores, starting with a letter."),
  type: z.enum(TOOL_FIELD_TYPES),
  description: z.string().trim().max(200).default(""),
  required: z.boolean().default(true),
});

export const workflowAgentToolSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(NAME, "Use 2–40 lower-case letters, digits and underscores, starting with a letter."),
    description: z.string().trim().min(10, "Say what this does, in a sentence the model can act on.").max(500),
    fields: z.array(toolFieldSchema).max(12),
  })
  .superRefine((tool, ctx) => {
    const seen = new Set<string>();
    tool.fields.forEach((field, index) => {
      if (seen.has(field.name)) {
        ctx.addIssue({ code: "custom", path: ["fields", index, "name"], message: `Two inputs are called "${field.name}".` });
      }
      seen.add(field.name);
    });
  });

export type WorkflowAgentTool = z.infer<typeof workflowAgentToolSchema>;

/** The name a model calls it by. */
export function toolWireName(tool: Pick<WorkflowAgentTool, "name">): string {
  return `${TOOL_NAME_PREFIX}${tool.name}`;
}

export function toolRef(workflowId: string): string {
  return `${WORKFLOW_TOOL_PREFIX}${workflowId}`;
}

/**
 * The tool as a provider is told about it. The description is the author's own words, verbatim — it
 * is read by a model to decide *when* to call, which is why `description` demands a sentence.
 */
export function toolSpec(tool: WorkflowAgentTool): ToolSpec {
  const properties: Record<string, { type: ToolFieldType; description?: string }> = {};
  for (const field of tool.fields) {
    properties[field.name] = field.description ? { type: field.type, description: field.description } : { type: field.type };
  }
  return {
    name: toolWireName(tool),
    description: tool.description,
    parameters: {
      type: "object",
      properties,
      required: tool.fields.filter((field) => field.required).map((field) => field.name),
    },
  };
}

/**
 * Checks what a model sent against what the tool declared, and answers the arguments the child run
 * starts with — or the sentence to hand back to the model so it can correct itself. Strict about
 * names: an input the workflow never declared is dropped silently by nothing here, because a model
 * that invents a field is a model that misunderstood the tool, and it should be told.
 */
export function readToolArgs(
  tool: WorkflowAgentTool,
  args: Record<string, unknown>,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const shape: Record<string, z.ZodType> = {};
  for (const field of tool.fields) {
    const base = field.type === "number" ? z.number() : field.type === "boolean" ? z.boolean() : z.string();
    shape[field.name] = field.required ? base : base.optional();
  }
  const parsed = z.object(shape).strict().safeParse(args);
  if (parsed.success) return { ok: true, input: parsed.data };
  return {
    ok: false,
    error: `Invalid arguments for ${toolWireName(tool)}: ${parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        const unknownKey = issue.code === "unrecognized_keys" ? issue.keys.join(", ") : "";
        return unknownKey ? `unknown input ${unknownKey}` : `${path || "(root)"} ${issue.message}`;
      })
      .join("; ")}`,
  };
}
