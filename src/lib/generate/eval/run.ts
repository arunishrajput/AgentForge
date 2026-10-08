import type { GenerateRequest, GenerateResult, LanguageModel } from "@/lib/ai/types";

import { generateWorkflow, type GenerationResult } from "../generate";
import type { EvalCase } from "./cases";
import { scoreCase, type CaseScore } from "./score";

/**
 * **Running the eval set, live or from a recording — Phase 34.**
 *
 * The same function scores both, and the only difference is the model: a real provider behind a
 * recording proxy, or a scripted model that hands back what a real one said. So CI holds the
 * pipeline — parse, assemble, validate, and the scorer — to real model output, offline, on every
 * push, and a live run (`scripts/eval-generate.mjs --live`) is the one that spends quota.
 *
 * What the offline replay does **not** prove is that a model would answer the same way again.
 * A recording is a measurement taken on one day against one prompt; `promptChars` and
 * `recordedAt` say which. Re-record it when the prompt changes materially.
 */

/** One case as a live run recorded it. */
export interface RecordedCase {
  /**
   * Every model call's text, in order — the selector's, if it made one, then each attempt's. `null`
   * is a call that failed, so a model selector that fell back replays as one that fell back.
   */
  calls: (string | null)[];
  /** The model that actually answered each call, after any fallback. */
  models: string[];
  ms: number[];
  /** Tokens in and out per call, when the provider reported them — the cost of a strategy. */
  tokens?: ({ input: number; output: number } | null)[];
  /** The catalogue the generation was given full definitions for. Null before Phase 34. */
  selected: string[] | null;
  /** The generation system prompt's length, in characters. */
  promptChars: number;
  verdict: "pass" | "fail";
  failures: string[];
  /** A provider failure — no answer to judge. The case is left out of the pass rate. */
  error?: string;
}

export interface Recording {
  label: string;
  description: string;
  provider: string;
  model: string;
  /** `full` (every definition), `deterministic` or `model` — `select.ts`. */
  selector: string;
  recordedAt: string;
  cases: Record<string, RecordedCase>;
}

/** Answers with each recorded text in turn. The replay half of a recording. */
export function replayModel(calls: (string | null)[]): LanguageModel {
  let index = 0;
  return {
    provider: "replay",
    defaultModel: "replay",
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const text = calls[index];
      index += 1;
      if (text === undefined) {
        throw new Error(
          `The recording has ${calls.length} calls and the pipeline asked for call ${index}. ` +
            "The pipeline now makes calls the recording never saw — re-record it.",
        );
      }
      if (text === null) throw new Error("This call failed when it was recorded.");
      return {
        model: request.model,
        text,
        toolCalls: [],
        raw: { role: "model", parts: [{ text }] },
        usage: null,
        finishReason: "STOP",
        attempts: [],
      };
    },
    async listModels() {
      return [];
    },
  };
}

/** Delegates to a real model and keeps what it said. The record half. */
export function recordingModel(model: LanguageModel): LanguageModel & {
  calls: (string | null)[];
  models: string[];
  ms: number[];
  systems: string[];
  tokens: ({ input: number; output: number } | null)[];
} {
  const calls: (string | null)[] = [];
  const models: string[] = [];
  const ms: number[] = [];
  const systems: string[] = [];
  const tokens: ({ input: number; output: number } | null)[] = [];
  return {
    provider: model.provider,
    defaultModel: model.defaultModel,
    calls,
    models,
    ms,
    systems,
    tokens,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const started = Date.now();
      let result: GenerateResult;
      try {
        result = await model.generate(request);
      } catch (error) {
        calls.push(null);
        models.push(request.model);
        ms.push(Date.now() - started);
        systems.push(request.system ?? "");
        tokens.push(null);
        throw error;
      }
      calls.push(result.text);
      models.push(result.model);
      ms.push(Date.now() - started);
      systems.push(request.system ?? "");
      tokens.push(result.usage ? { input: result.usage.inputTokens, output: result.usage.outputTokens } : null);
      return result;
    },
    listModels: () => model.listModels(),
  };
}

export interface EvalRunOptions {
  model: LanguageModel;
  modelId: string;
  /** Extra options for `generateWorkflow` — the catalogue strategy, from Phase 34's selector. */
  generateOptions?: Record<string, unknown>;
}

export interface EvalRunResult {
  score: CaseScore;
  result: GenerationResult;
}

export async function runCase(evalCase: EvalCase, options: EvalRunOptions): Promise<EvalRunResult> {
  const result = await generateWorkflow({
    ...options.generateOptions,
    model: options.model,
    modelId: options.modelId,
    prompt: evalCase.prompt,
  });
  return { score: scoreCase(evalCase, result), result };
}

/** Replays one recorded case. `undefined` when the recording holds a provider failure. */
export async function replayCase(
  evalCase: EvalCase,
  recorded: RecordedCase,
  generateOptions: Record<string, unknown> = {},
): Promise<EvalRunResult | undefined> {
  if (recorded.error) return undefined;
  return runCase(evalCase, {
    model: replayModel(recorded.calls),
    modelId: "replay",
    generateOptions,
  });
}
