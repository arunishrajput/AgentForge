import type {
  ChatTurn,
  LanguageModel,
  ToolCall,
  ToolResult,
  ToolSpec,
  Usage,
} from "./types";

/**
 * The agent's tool-calling loop — CONTRACT.md → "Agent tool-call schema".
 *
 * Deliberately pure: it is handed a model and a function that runs a tool, and it
 * touches neither the registry, the database, nor the network. That is what lets the
 * one property that actually matters be asserted in a millisecond — **a model that
 * never stops calling tools is stopped by the cap** — instead of by burning a real
 * quota against a real API and hoping.
 *
 * Measured, not assumed: a live model asked to "log a counter forever, never answer
 * with text" called a tool on all six turns it was given (2026-09-26). The cap is
 * therefore load-bearing, not a theoretical guard.
 */

/**
 * A ceiling the workflow cannot raise, in the spirit of D16: the configured
 * `maxIterations` is a tuning knob, this is a safety property. Eight model calls at
 * the ~1.2 s the free tier answers in stays comfortably inside the engine's 120 s
 * deadline even when every turn calls a tool.
 */
export const HARD_MAX_AGENT_ITERATIONS = 8;
export const DEFAULT_AGENT_ITERATIONS = 5;

/** What the model asked for and what happened, in order. Each one becomes a log line. */
export interface ToolCallRecord {
  iteration: number;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
  error: string | null;
  ms: number;
}

export type ToolRunner = (call: ToolCall) => Promise<unknown>;

export interface AgentLoopOptions {
  model: LanguageModel;
  /** Model id to request. The adapter may answer on a fallback; the result says which. */
  modelId: string;
  system: string;
  objective: string;
  tools: ToolSpec[];
  runTool: ToolRunner;
  maxIterations?: number;
  temperature?: number;
  log?: (message: string, level?: "info" | "warn" | "error") => void;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  text: string;
  /** Model calls made. One more than the number of tool-calling turns. */
  iterations: number;
  toolCalls: ToolCallRecord[];
  /** The model that answered the final turn, after any fallback. */
  model: string;
  usage: Usage;
  /**
   * `answered` — the model returned text and stopped asking for tools.
   * `cap` — it was still calling tools when the cap was reached. The caller fails the
   *   step: an agent that will not converge must not quietly return half an answer.
   */
  stopped: "answered" | "cap";
}

function clampIterations(requested: number | undefined): number {
  const value = requested ?? DEFAULT_AGENT_ITERATIONS;
  if (!Number.isFinite(value)) return DEFAULT_AGENT_ITERATIONS;
  return Math.max(1, Math.min(Math.trunc(value), HARD_MAX_AGENT_ITERATIONS));
}

function describeArgs(args: Record<string, unknown>): string {
  const text = JSON.stringify(args);
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

function addUsage(total: Usage, next: Usage | null): Usage {
  if (!next) return total;
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  };
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxIterations = clampIterations(options.maxIterations);
  const log = options.log ?? (() => {});

  const turns: ChatTurn[] = [{ role: "user", text: options.objective }];
  const toolCalls: ToolCallRecord[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let answeredBy = options.modelId;
  let text = "";
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations += 1;

    const result = await options.model.generate({
      model: options.modelId,
      system: options.system,
      turns,
      tools: options.tools,
      temperature: options.temperature,
      signal: options.signal,
    });

    usage = addUsage(usage, result.usage);
    answeredBy = result.model;
    if (result.model !== options.modelId) {
      // A fallback is a fact the user should see, not something to hide.
      log(`Model ${options.modelId} was unavailable; answered by ${result.model}.`, "warn");
    }
    if (result.text) text = result.text;

    if (result.toolCalls.length === 0) {
      if (result.text) log(`Model answered: ${result.text}`);
      return { text, iterations, toolCalls, model: answeredBy, usage, stopped: "answered" };
    }

    // Gemini emits several calls in one turn, so a whole batch is executed and all of
    // the responses go back together — one `tool` turn per model turn.
    turns.push({
      role: "model",
      text: result.text,
      toolCalls: result.toolCalls,
      raw: result.raw,
    });

    const results: ToolResult[] = [];
    for (const call of result.toolCalls) {
      log(`Calling tool ${call.name} with ${describeArgs(call.args)}`);
      const started = Date.now();
      try {
        const output = await options.runTool(call);
        const ms = Date.now() - started;
        toolCalls.push({
          iteration: iterations,
          name: call.name,
          args: call.args,
          ok: true,
          result: output ?? null,
          error: null,
          ms,
        });
        results.push({ id: call.id, name: call.name, result: output ?? null });
        log(`Tool ${call.name} returned in ${ms} ms.`);
      } catch (error) {
        const ms = Date.now() - started;
        const message = error instanceof Error ? error.message : String(error);
        toolCalls.push({
          iteration: iterations,
          name: call.name,
          args: call.args,
          ok: false,
          result: null,
          error: message,
          ms,
        });
        // The error goes back to the model rather than failing the step, so it can
        // correct a bad argument. Runaway retrying is bounded by the cap above.
        results.push({ id: call.id, name: call.name, result: { error: message } });
        log(`Tool ${call.name} failed: ${message}`, "warn");
      }
    }

    turns.push({ role: "tool", results });
  }

  log(
    `Stopped after ${maxIterations} model calls without a final answer.`,
    "error",
  );
  return { text, iterations, toolCalls, model: answeredBy, usage, stopped: "cap" };
}
