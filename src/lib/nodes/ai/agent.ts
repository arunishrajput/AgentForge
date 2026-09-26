import { z } from "zod";

import {
  DEFAULT_AGENT_ITERATIONS,
  HARD_MAX_AGENT_ITERATIONS,
  runAgentLoop,
} from "@/lib/ai/loop";
import { agentToolSet } from "@/lib/ai/tools";
import type { ToolCall } from "@/lib/ai/types";

import { defineNode, NodeError, type NodeContext } from "../types";
import { asNodeError, resolveKey } from "./llm";

/**
 * The agent node — the thing this product exists to demonstrate (`DEMO.md`, Beat 7).
 *
 * It is handed an objective, a tool set derived from the node registry, and a list of
 * decisions it is allowed to reach. It then reasons at runtime: calling tools, reading
 * what they returned, and choosing. Nobody wrote a keyword rule.
 *
 * Two properties make it watchable rather than a black box:
 *
 *   • every step of its reasoning is a log line, and a log line is persisted the moment
 *     it is written (D30), so the canvas fills in while the node is still running;
 *   • the tool set is the registry (D19), so what it may do is a fact you can read off
 *     the palette rather than a claim in a prompt.
 *
 * **Routing.** Its decision comes out in `output.decision` and a `core.branch` node
 * reads it. The agent does not own named outputs of its own: a node's output handles
 * come from its registry entry (D21, D23), so per-instance handles would mean the canvas
 * could not draw a node's edges without first running it.
 */

const DECISION_PATTERN = /^\s*DECISION:\s*(.+?)\s*$/im;

export const agentNode = defineNode({
  type: "ai.agent",
  label: "AI Agent",
  description:
    "Gives an objective to a language model that can call other nodes as tools and decide what to do at runtime. Outputs its answer, the decision it reached, and every tool call it made.",
  kind: "action",
  category: "agent",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ decision: one of the configured choices, or null, reason: one sentence explaining it, text: the full answer, toolCalls, iterations, model, usage, input }. Route on output.decision.",
  // An agent that could call an agent would recurse past every cap, since each nested
  // run carries its own fresh iteration budget.
  agentCallable: false,
  configSchema: z.object({
    objective: z.string().min(1).max(20_000),
    system: z.string().max(4000).optional(),
    model: z.string().max(120).optional(),
    /**
     * Registry types this agent may call. Empty means every `agentCallable` node. It can
     * only ever narrow the set — a type listed here that is not callable is reported,
     * never granted (`agentToolSet`).
     */
    tools: z.array(z.string().max(120)).max(50).default([]),
    /**
     * Decisions the agent is allowed to reach, e.g. ["urgent", "normal"]. A following
     * branch node routes on `{{input.decision}}`.
     */
    choices: z.array(z.string().min(1).max(120)).max(12).default([]),
    maxIterations: z
      .number()
      .int()
      .min(1)
      .max(HARD_MAX_AGENT_ITERATIONS)
      .default(DEFAULT_AGENT_ITERATIONS),
    temperature: z.number().min(0).max(2).optional(),
  }),
  async execute({ config, input, context }) {
    const { model, source, selectedModel } = await resolveKey(context.ownerId);
    const modelId = config.model && config.model.length > 0 ? config.model : selectedModel;

    const tools = agentToolSet({ allow: config.tools });
    for (const rejected of tools.rejected) {
      context.log(`Tool "${rejected}" is not available to agents; ignoring it.`, "warn");
    }

    context.log(
      `Agent starting on ${modelId} (key from ${source}) with ${tools.specs.length} tool(s): ` +
        `${tools.specs.map((tool) => tool.name).join(", ") || "none"}.`,
    );
    if (config.choices.length > 0) {
      context.log(`Must choose one of: ${config.choices.join(", ")}.`);
    }

    let result;
    try {
      result = await runAgentLoop({
        model,
        modelId,
        system: buildSystemPrompt(config.system, config.choices),
        objective: buildObjective(config.objective, input),
        tools: tools.specs,
        maxIterations: config.maxIterations,
        temperature: config.temperature,
        signal: context.signal,
        log: (message, level) => context.log(message, level),
        runTool: (call) => invokeTool(call, tools, context),
      });
    } catch (error) {
      throw asNodeError(error);
    }

    // An agent that will not converge fails its step rather than returning half an
    // answer that a downstream node would treat as a real one.
    if (result.stopped === "cap") {
      throw new NodeError(
        `The agent was still calling tools after ${result.iterations} model calls and was stopped. ` +
          `Give it a narrower objective, or raise the iteration limit (max ${HARD_MAX_AGENT_ITERATIONS}).`,
      );
    }

    const decision = config.choices.length > 0
      ? matchDecision(result.text, config.choices)
      : null;

    if (config.choices.length > 0) {
      if (decision) {
        context.log(`Decision: ${decision}.`);
      } else {
        // Deliberately not a failure. A run that completes down the default path is a
        // better outcome on a demo than a run that dies because a model was chatty.
        context.log(
          `The agent did not state one of the allowed decisions; output.decision is null.`,
          "warn",
        );
      }
    }

    return {
      output: {
        text: result.text,
        decision,
        reason: stripDecisionLine(result.text),
        toolCalls: result.toolCalls.map((call) => ({
          name: call.name,
          args: call.args,
          ok: call.ok,
          error: call.error,
          ms: call.ms,
        })),
        iterations: result.iterations,
        model: result.model,
        usage: result.usage,
        input: input ?? null,
      },
    };
  },
});

export function buildSystemPrompt(system: string | undefined, choices: string[]): string {
  const parts = [
    system && system.length > 0
      ? system
      : "You are an automation agent running inside a workflow. Work out what to do from the objective and the data you are given.",
    "Use the tools you have been given when they help. Do not describe calling a tool instead of calling it.",
    "Be brief. When you are finished, answer in plain text.",
  ];

  if (choices.length > 0) {
    parts.push(
      `You must reach one of these decisions: ${choices.join(", ")}.`,
      // The one sentence is asked for explicitly because a model given only the
      // sentinel answers with only the sentinel — watched happen on the deployed
      // canvas, which left `output.reason` empty and the decision unexplained.
      `Your final answer is one sentence saying why, then a line of exactly this form, with nothing after it:\nDECISION: <one of ${choices.join(" | ")}>`,
    );
  }

  return parts.join("\n\n");
}

export function buildObjective(objective: string, input: unknown): string {
  if (input === null || input === undefined) return objective;
  return `${objective}\n\nData from the previous step:\n${JSON.stringify(input, null, 2)}`;
}

/**
 * Finds the decision in the model's answer.
 *
 * The explicit `DECISION:` line first, because that is what the system prompt asked for.
 * Failing that, a whole-word mention of exactly one of the choices — a model that says
 * "this is urgent" without the sentinel has still decided, and refusing to read that
 * would fail a run over formatting.
 */
export function matchDecision(text: string, choices: string[]): string | null {
  const sentinel = text.match(DECISION_PATTERN);
  if (sentinel) {
    const stated = sentinel[1].trim().replace(/[.*_`"']/g, "");
    const exact = choices.find(
      (choice) => choice.toLowerCase() === stated.toLowerCase(),
    );
    if (exact) return exact;
  }

  const mentioned = choices.filter((choice) =>
    new RegExp(`\\b${escapeRegExp(choice)}\\b`, "i").test(text),
  );
  return mentioned.length === 1 ? mentioned[0] : null;
}

export function stripDecisionLine(text: string): string {
  return text.replace(DECISION_PATTERN, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Runs one tool call: the registry node the model named, with the model's arguments
 * validated against that node's own config schema.
 *
 * The validation is the security boundary doing its job twice over — the model can only
 * name a node in `byName` (which is only ever `agentCallable` nodes), and it can only
 * pass arguments that node's schema accepts. A rejection is returned to the model as a
 * tool error so it can correct itself, bounded by the iteration cap.
 */
export async function invokeTool(
  call: ToolCall,
  tools: ReturnType<typeof agentToolSet>,
  context: NodeContext,
): Promise<unknown> {
  const definition = tools.byName.get(call.name);
  if (!definition) {
    throw new Error(
      `No tool named "${call.name}". Available: ${[...tools.byName.keys()].join(", ") || "none"}.`,
    );
  }

  const parsed = definition.configSchema.safeParse(call.args);
  if (!parsed.success) {
    throw new Error(
      `Invalid arguments for ${call.name}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const outcome = await definition.execute({
    config: parsed.data,
    input: null,
    context: {
      ...context,
      // A synthetic node id: the tool ran inside this node, not as a node of its own,
      // and a `{{steps.<id>}}` reference must not be able to resolve to it.
      nodeId: `${context.nodeId}:${call.name}`,
      iteration: 0,
      log: (message, level) => context.log(`[${call.name}] ${message}`, level),
    },
  });

  return outcome.output ?? null;
}
