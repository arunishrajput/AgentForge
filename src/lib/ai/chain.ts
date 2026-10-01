import { logError, logInfo, logWarn } from "@/lib/logging";

import { countsAgainstModel, orderChain, recordFailure, recordSuccess } from "./health";
import {
  isRetryableStatus,
  ProviderError,
  type Attempt,
  type GenerateRequest,
  type GenerateResult,
  type LanguageModel,
  type ModelInfo,
  type ToolCall,
  type Usage,
} from "./types";

/**
 * **The model call chain — the retry, fallback, budget and breaker machinery, with no
 * provider in it.** Extracted from `gemini.ts` in Phase 23D.
 *
 * ## Why this is its own file
 *
 * Everything in here was written and measured in Phase 13 to fix one incident: a wedged
 * model costing a run 91.9 s. The budget arithmetic, the rule that a timed-out attempt is
 * never retried on the same model, the breaker bookkeeping and the fallback metric are all
 * **reliability properties, not Gemini properties** — none of them mentions Google.
 *
 * Phase 23D needed a second provider. Copying this logic into a second adapter would have
 * produced two copies of the Phase 13 fix, and the copies are where a hard-won fix rots:
 * the next person tunes one budget and not the other, and a year later one provider has the
 * Chapter 1 failure mode back and nobody can say when. So the machinery is shared and each
 * provider supplies only its wire format.
 *
 * **The proof the extraction was faithful is that `gemini.test.ts` passes unchanged.** Those
 * 687 lines pin the budget behaviour, the break-on-timeout rule, the 404 handling and the
 * attempt list; they were not edited for this phase, so they are a before-and-after
 * comparison rather than a restatement.
 *
 * ## What a provider still owns
 *
 * Four things, and nothing else: how a request is built, how a 200 is read, how an error
 * message is found, and what its catalogue is. See {@link ProviderWire}.
 */

/**
 * The time budget — Phase 13's headline fix.
 *
 * Chapter 1 used a 45 s per-request timeout with two attempts per model and no overall
 * deadline, so a single wedged model cost 90 s before a fallback was tried. That is
 * exactly the 91.9 s step Phase 12 measured.
 *
 * Now: every attempt is capped, the whole `generate` call is capped, and **a timed-out
 * attempt is never retried on the same model.** A model that accepted the request and
 * went quiet has told you what it is going to do; asking it twice just buys the same
 * silence again. Retrying in place is reserved for failures that come back *fast* —
 * a 503 usually returns in under a second, and a retry there often succeeds.
 *
 * 12 s is deliberately tighter than the slowest healthy model measured (10.2 s on the
 * text path). That is a trade made with the numbers in hand: a model needing more than
 * 12 s for one agent step is losing to the fallback anyway, and the budget is what keeps
 * degradation under 15 s. A caller that knows it is doing something large can raise it
 * per request with `GenerateRequest.timeoutMs`.
 *
 * **Phase 23D left this number alone across both providers**, and the measurements say
 * that is right rather than merely convenient: Groq's slowest healthy tool-call probe was
 * 1309 ms, an order of magnitude inside the budget. A per-provider attempt budget would be
 * a knob with nothing behind it. It is still per-provider *capable* — `ChainOptions` is
 * built per adapter — so the day a provider needs a different number, it has somewhere to
 * go that is not a global edit.
 */
const ATTEMPT_TIMEOUT_MS = 12_000;

/**
 * The ceiling on one `generate`, across every model and retry. Sits well inside the
 * engine's 120 s run deadline so a node that also calls an integration still has room.
 */
const TOTAL_BUDGET_MS = 30_000;

/**
 * An attempt with less than this left of the total budget is not worth starting: it
 * would time out by construction and report a model failure that never happened.
 */
const MIN_ATTEMPT_MS = 1_500;

const MAX_ATTEMPTS_PER_MODEL = 2;
const BACKOFF_MS = [600, 1800];

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** What one HTTP attempt should send. */
export interface WireTarget {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Serialised by the chain. `undefined` sends no body. */
  body?: unknown;
}

/** A 200, read into the shared result shape. */
export interface WireAnswer {
  text: string;
  toolCalls: ToolCall[];
  /** The provider's own content object, replayed verbatim in the next turn — see `types.ts`. */
  raw: unknown;
  finishReason: string | null;
  usage: Usage | null;
}

/**
 * Everything provider-specific about a model call. One object per provider, and the only
 * thing a new provider has to write.
 */
export interface ProviderWire {
  /** The registry id: `"google"`, `"groq"`. Health keys and log lines carry it. */
  readonly provider: string;
  /** The provider's name as a person would write it, for an error a user reads. */
  readonly label: string;

  /**
   * The model-independent half of the request body, built **once per `generate`** rather
   * than once per attempt. It walks the whole turn history, which on a long agent
   * conversation is the most expensive thing in the call, and the chain may make up to six
   * attempts.
   */
  prepare: (request: GenerateRequest) => unknown;

  /** Where one attempt goes, and what it carries. `prepared` is {@link prepare}'s result. */
  target: (model: string, prepared: unknown) => WireTarget;

  /** Read a 200 body. */
  parse: (payload: unknown) => WireAnswer;

  /**
   * The provider's own words for a non-200, which are the words that tell a user what to
   * fix — "API key not valid", "prepayment credits are depleted".
   */
  errorMessage: (payload: unknown, status: number) => string;

  /** The catalogue, live. Never a hardcoded list — model names get retired. */
  listModels: (call: FetchLike) => Promise<ModelInfo[]>;
}

export interface ChainOptions {
  /** The model a request uses when it does not name one. */
  defaultModel: string;
  /** Tried in order after the requested model fails retryably. */
  fallbacks: string[];
  /** Injected in tests. Nothing else should pass this. */
  fetchImpl?: FetchLike;
  /** Backoff between attempts. Overridden in tests so they do not actually wait. */
  backoffMs?: number[];
  /** Per-attempt cap. Defaults to 12 s — see the budget note above. */
  attemptTimeoutMs?: number;
  /** Cap on the whole chain. Defaults to 30 s. */
  totalBudgetMs?: number;
  /**
   * Skip the circuit breaker's reordering and its bookkeeping. Used by `verifyModel` in
   * `settings.ts`, which must prove one specific model and would otherwise both be
   * reordered away from it and pollute health with a result the user asked for
   * deliberately.
   */
  ignoreHealth?: boolean;
}

/**
 * Build a `LanguageModel` from a wire adapter and a chain configuration.
 *
 * Every provider in `providers.ts` is one call to this.
 */
export function chainedModel(wire: ProviderWire, options: ChainOptions): LanguageModel {
  const { defaultModel, fallbacks } = options;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const attemptTimeout = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const totalBudget = options.totalBudgetMs ?? TOTAL_BUDGET_MS;
  const useHealth = options.ignoreHealth !== true;
  const call: FetchLike =
    options.fetchImpl ??
    (async (url, init) => {
      const response = await fetch(url, init);
      return { status: response.status, json: () => response.json() };
    });

  /**
   * The order models are tried in: the requested one first, then the chain with the
   * requested one removed so it is never attempted twice in a row — and then the whole
   * thing reordered by the circuit breaker, which moves a model that is currently
   * failing to the back.
   *
   * The requested model keeps its place at the front *whenever its breaker is closed*.
   * Only a model already known to be failing loses that position, and the caller still
   * learns which model answered from `GenerateResult.model` and the attempt list.
   *
   * **The reordering is scoped to this provider** (Phase 23D). `orderChain` is given
   * `wire.provider`, so a chain is only ever reordered by its own provider's failures.
   */
  function chain(requested: string): string[] {
    const ordered = [requested, ...fallbacks.filter((model) => model !== requested)];
    return useHealth ? orderChain(wire.provider, ordered) : ordered;
  }

  async function post(
    model: string,
    prepared: unknown,
    signal: AbortSignal | undefined,
    budgetMs: number,
  ): Promise<{ status: number; payload: unknown; ms: number }> {
    const started = Date.now();
    const timeout = AbortSignal.timeout(budgetMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const target = wire.target(model, prepared);

    const response = await call(target.url, {
      method: target.method,
      headers: target.headers,
      ...(target.body === undefined ? {} : { body: JSON.stringify(target.body) }),
      signal: combined,
    });

    return { status: response.status, payload: await response.json(), ms: Date.now() - started };
  }

  async function attemptChain(request: GenerateRequest): Promise<GenerateResult> {
    const prepared = wire.prepare(request);

    const attempts: Attempt[] = [];
    let lastError: ProviderError | null = null;

    // One clock for the whole chain. Without it, "two attempts per model, three models"
    // multiplies into a number nobody budgeted for — which is how Phase 12 got 91.9 s.
    //
    // `request.timeoutMs` sets the **per-attempt** budget, not the total. The total then
    // stretches to hold at least two full-length attempts, because a caller raising the
    // per-attempt budget for a large prompt still needs room for a fallback afterwards —
    // capping both at the same number would spend the entire budget on one model and
    // reintroduce the single point of failure this whole mechanism exists to remove.
    const perAttempt = request.timeoutMs ?? attemptTimeout;
    const ceiling = Math.max(totalBudget, perAttempt * 2);
    const deadline = Date.now() + ceiling;
    const remaining = () => deadline - Date.now();

    for (const model of chain(request.model || defaultModel)) {
      for (let tries = 0; tries < MAX_ATTEMPTS_PER_MODEL; tries += 1) {
        if (request.signal?.aborted) {
          throw new ProviderError("The run stopped before the model answered.", {
            status: 0,
            retryable: false,
            attempts,
          });
        }

        // Out of budget. Stop rather than start an attempt that cannot finish — a
        // 300 ms sliver of a 12 s call is a guaranteed timeout dressed as an attempt.
        // The floor is capped by `perAttempt` so a deliberately short budget (tests,
        // and a caller passing `timeoutMs`) still gets its one honest attempt.
        const floor = Math.min(MIN_ATTEMPT_MS, perAttempt);
        const budget = Math.min(perAttempt, remaining());
        if (budget < floor) {
          lastError ??= new ProviderError(
            `No model answered within ${Math.round(ceiling / 1000)} s.`,
            { status: 0, retryable: true, attempts },
          );
          throw lastError;
        }

        let status = 0;
        let payload: unknown = null;
        let ms = 0;
        try {
          const result = await post(model, prepared, request.signal, budget);
          status = result.status;
          payload = result.payload;
          ms = result.ms;
        } catch (error) {
          // A transport failure or a timeout. Retryable: it says nothing about the
          // request being wrong.
          const message = error instanceof Error ? error.message : String(error);
          const timedOut = /timeout|aborted|timed out/i.test(message);
          const detail = timedOut ? `no answer within ${budget} ms` : message;
          attempts.push({ model, status: 0, ms: budget, error: detail });
          if (useHealth) {
            recordFailure(wire.provider, model, { status: 0, error: detail, latencyMs: budget });
          }
          lastError = new ProviderError(`Could not reach ${wire.label}: ${detail}`, {
            status: 0,
            retryable: true,
            attempts,
          });

          // **The Phase 13 fix.** A model that swallowed the whole budget and said
          // nothing gets no second chance here — the chain moves on. Retrying in place
          // is what turned one wedged model into 90 s.
          if (timedOut) break;

          if (tries + 1 < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(Math.min(backoff[tries] ?? 1800, Math.max(0, remaining())));
          }
          continue;
        }

        if (status === 200) {
          attempts.push({ model, status, ms });
          if (useHealth) recordSuccess(wire.provider, model, ms);
          const parsed = wire.parse(payload);
          return {
            model,
            text: parsed.text,
            toolCalls: parsed.toolCalls,
            raw: parsed.raw,
            usage: parsed.usage,
            finishReason: parsed.finishReason,
            attempts,
          };
        }

        const message = wire.errorMessage(payload, status);
        attempts.push({ model, status, ms, error: message });
        const retryable = isRetryableStatus(status);
        // 404 is not retryable, but it *is* a fact about the model — three names in the
        // Chapter 1 chain went "no longer available to new users" mid-project. The
        // breaker wants to know; the chain still moves on, because another model can
        // absolutely fix a 404.
        if (useHealth && countsAgainstModel(status)) {
          recordFailure(wire.provider, model, { status, error: message, latencyMs: ms });
        }
        lastError = new ProviderError(message, { status, retryable, attempts });

        // 400/401/403 are facts about the request or the key. Another model will not
        // fix a bad key, so those end the call outright.
        if (!retryable && status !== 404) throw lastError;
        if (status === 404) break;

        if (tries + 1 < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(Math.min(backoff[tries] ?? 1800, Math.max(0, remaining())));
        }
      }
    }

    throw (
      lastError ??
      new ProviderError(`${wire.label} could not be reached.`, {
        status: 0,
        retryable: true,
        attempts,
      })
    );
  }

  /**
   * **The model-fallback metric — Phase 22, and the one that phase exists for.**
   *
   * Chapter 1's 92-second regression was a healthy-looking system: runs succeeded, the
   * canvas streamed, nothing errored. What had happened was that the requested model had
   * started timing out and every call was quietly being answered by the second or third
   * model in the chain, at the cost of a wedged 45-second attempt first. Nothing reported
   * it, because from the outside a fallback *is* a success — that is the entire point of
   * having one.
   *
   * So a fallback is recorded as an event in its own right. `fallback: true` is the
   * filter behind `agentforge_model_fallbacks` in `OPERATIONS.md`; a rate above zero for
   * any sustained period means the head of the chain is degrading and
   * `npm run probe:models` should be run before the numbers in `providers.ts` are
   * trusted again.
   *
   * It wraps the chain rather than living inside it so that the loop, which is delicate
   * and well tested, did not have to be edited to be observed. **No prompt and no
   * completion is logged** — only which model was asked, which answered, how long, and
   * how many attempts it took.
   *
   * **Phase 23D added `provider` to every line.** Without it the metric cannot answer the
   * question two providers make possible and interesting: *is the fallback rate a property
   * of this provider, or of us?* `OPERATIONS.md` records that the metric's filter is
   * unchanged, so the existing log-based metric keeps collecting across the change.
   */
  async function generate(request: GenerateRequest): Promise<GenerateResult> {
    const requested = request.model || defaultModel;
    const startedAt = Date.now();

    try {
      const result = await attemptChain(request);
      const fallback = result.model !== requested;
      const fields = {
        provider: wire.provider,
        requested,
        answered: result.model,
        fallback,
        attempts: result.attempts.length,
        durationMs: Date.now() - startedAt,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls.length,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
      };
      if (fallback) {
        logWarn("model.call", `${requested} did not answer; ${result.model} did.`, fields);
      } else {
        logInfo("model.call", `${result.model} answered.`, fields);
      }
      return result;
    } catch (error) {
      const attempts = error instanceof ProviderError ? error.attempts : [];
      logError("model.call", `No model answered a request for ${requested}.`, error, {
        provider: wire.provider,
        requested,
        answered: null,
        // A call that reached no model at all is the limiting case of a fallback, and it
        // belongs in the same metric: the chain was exercised and did not deliver.
        fallback: true,
        failed: true,
        attempts: attempts.length,
        triedModels: attempts.map((attempt) => attempt.model).join(",") || null,
        status: error instanceof ProviderError ? error.status : null,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  return {
    provider: wire.provider,
    defaultModel,
    generate,
    listModels: () => wire.listModels(call),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
