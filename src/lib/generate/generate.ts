import type { ChatTurn, GenerateResult, LanguageModel, Usage } from "@/lib/ai/types";
import { validateGraph, type GraphProblem } from "@/lib/engine/validate";
import { stripCodeFence } from "@/lib/nodes/ai/llm";
import { describeNodes, type NodeSummary } from "@/lib/nodes";
import { GRAPH_VERSION, workflowGraphSchema, type WorkflowGraph } from "@/lib/workflow/graph";

import { layout } from "./layout";
import { checkReferences } from "./references";
import { generatedWorkflowSchema, type GeneratedWorkflow } from "./schema";
import { renderCatalogue, systemPrompt, userPrompt } from "./prompt";
import {
  selectAll,
  selectDeterministic,
  selectWithModel,
  type CatalogueOption,
  type CatalogueSelection,
} from "./select";

/**
 * Natural language → workflow — CONTRACT.md → "Generation request/response".
 *
 * The one rule this module exists to enforce: **model output is validated before it
 * is persisted, and invalid output is reported rather than saved** (PRD.md →
 * Generation; BUILD_PLAN.md Phase 7, task 3). Nothing here writes to the database.
 * The route persists only what this function returns as `ok: true`.
 *
 * It takes its `LanguageModel` as an argument for the same reason the engine takes
 * its recorder (D18): the whole pipeline — prompt, parse, layout, validate, the
 * retry — is then testable against a fake model in milliseconds, with no network and
 * no quota. The only thing a live call adds is whether a real model can follow the
 * prompt, which is what the deployed verification is for.
 */

/**
 * Why three code namespaces and not one: `GraphProblem`'s codes are contract
 * (CONTRACT.md → "Graph validation") and must not be widened by this phase. Output
 * that never became a graph fails in ways that list cannot express, so those two
 * cases get their own codes rather than being forced into `invalid_config`.
 */
export type GenerationIssue =
  | { code: "not_json"; message: string }
  | { code: "bad_shape"; message: string; path?: string }
  /**
   * Phase 34: a valid graph whose `{{ }}` reference reaches nothing (`references.ts`). Never a
   * failure by itself — it earns the one retry, and is listed on an attempt whose graph kept it.
   */
  | { code: "unresolved_reference"; message: string; nodeId: string; reference: string }
  | GraphProblem;

export interface GenerationAttempt {
  model: string;
  /**
   * What was wrong with this attempt's answer. Empty on an attempt accepted as it stood; an
   * accepted graph can still list `unresolved_reference`s the retry did not fix.
   */
  issues: GenerationIssue[];
  ms: number;
}

export interface GenerationSuccess {
  ok: true;
  name: string;
  description: string | null;
  graph: WorkflowGraph;
  /**
   * What the model could not build with the registry it was given. Surfaced, never
   * swallowed: a workflow that silently does less than was asked is the one failure
   * a user cannot diagnose for themselves.
   */
  unsupported: string[];
  /** The model that actually answered — may differ from the request after a fallback. */
  model: string;
  usage: Usage | null;
  attempts: GenerationAttempt[];
  /**
   * Which attempt produced this graph. Usually the last; the first when the retry over its
   * references came back invalid, because a valid graph is never thrown away for a worse one.
   */
  attempt: 1 | 2;
  /** Which nodes were defined in full, and how they were chosen — Phase 34. */
  selection: CatalogueSelection;
  /** The system prompt's length in characters — what selection exists to keep down. */
  promptChars: number;
}

export interface GenerationFailure {
  ok: false;
  /** Written to be read by the user, not by a developer. */
  message: string;
  issues: GenerationIssue[];
  attempts: GenerationAttempt[];
  selection: CatalogueSelection;
  promptChars: number;
}

export type GenerationResult = GenerationSuccess | GenerationFailure;

export interface GenerateWorkflowOptions {
  model: LanguageModel;
  /** The model id to ask for. The adapter may fall back to another one. */
  modelId: string;
  prompt: string;
  /** Overrides the title the model chose. */
  name?: string;
  /** Injectable so a test can generate against a fixed catalogue. */
  nodes?: NodeSummary[];
  /**
   * How the catalogue is chosen — Phase 34. Defaults to `DEFAULT_CATALOGUE`. `fixed` replays a
   * recorded selection, for the eval set's offline mode.
   */
  catalogue?: CatalogueOption;
  signal?: AbortSignal;
}

/**
 * **The strategy generation ships with — D156.** Measured against the whole catalogue and against
 * a model-call selector on the eval set (`BUILD_PLAN.md` → *Phase 34*).
 */
export const DEFAULT_CATALOGUE: CatalogueOption = { strategy: "deterministic" };

async function chooseCatalogue(options: GenerateWorkflowOptions, nodes: NodeSummary[]): Promise<CatalogueSelection> {
  const catalogue = options.catalogue ?? DEFAULT_CATALOGUE;
  switch (catalogue.strategy) {
    case "full":
      return selectAll(nodes);
    case "fixed": {
      const known = new Set(nodes.map((node) => node.type));
      return { strategy: "fixed", types: catalogue.types.filter((type) => known.has(type)) };
    }
    case "model":
      return selectWithModel({
        model: options.model,
        modelId: options.modelId,
        request: options.prompt,
        nodes,
        signal: options.signal,
      });
    case "deterministic":
      return selectDeterministic(options.prompt, nodes);
  }
}

/**
 * The node types a failed answer used that the prompt only indexed. Read from the raw JSON, not the
 * parsed shape, because an answer can fail its shape and still say plainly which nodes it meant.
 */
export function undefinedTypesUsed(text: string, selection: CatalogueSelection, nodes: NodeSummary[]): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(text));
  } catch {
    return [];
  }
  const used = new Set<string>();
  const list = raw && typeof raw === "object" ? (raw as { nodes?: unknown }).nodes : undefined;
  if (Array.isArray(list)) {
    for (const node of list) {
      const type = node && typeof node === "object" ? (node as { type?: unknown }).type : undefined;
      if (typeof type === "string") used.add(type);
    }
  }
  const defined = new Set(selection.types);
  return nodes.filter((node) => used.has(node.type) && !defined.has(node.type)).map((node) => node.type);
}

/**
 * The fewest model calls an agent that uses a tool can possibly finish in: one to
 * decide to call the tool, one to read what came back and answer. Anything below this
 * is a budget that cannot succeed.
 */
const MIN_VIABLE_AGENT_ITERATIONS = 3;

/**
 * An agent budget the model set low enough to guarantee its own failure is dropped,
 * so the node falls back to the registry default.
 *
 * Measured over 12 generations of the pinned demo prompt, **five wrote
 * `maxIterations: 1`**. It passes config validation — the schema allows 1..8 — and the
 * graph is valid, so nothing reports it. Then at runtime the agent spends its single
 * call reaching for a tool, gets stopped, and fails the run at the exact beat the
 * demo exists for. `Keep the workflow as small as the request allows` is elsewhere in
 * the prompt, and the model appears to read it as applying to this number too.
 *
 * The prompt now says not to set it, which is the real fix; this is the guarantee,
 * because a rule a model follows most of the time is not a property. It is the same
 * division D40 draws — the model emits nodes, the system supplies what a model cannot
 * be relied on to get right.
 *
 * Deliberately narrow: it only ever *raises* a floor on a **generated** agent node,
 * and only by removing the key. A user who types 1 into the config form on the canvas
 * still gets 1 — that is their choice to make, and D16's bounds are untouched.
 */
function viableAgentConfig(node: GeneratedWorkflow["nodes"][number]): Record<string, unknown> {
  if (node.type !== "ai.agent") return node.config;

  const requested = node.config.maxIterations;
  if (typeof requested !== "number" || requested >= MIN_VIABLE_AGENT_ITERATIONS) return node.config;

  const { maxIterations: _dropped, ...rest } = node.config;
  return rest;
}

/**
 * Model output → a real graph. The system supplies everything the model was not asked
 * for: `version`, layout positions, and edge ids.
 */
export function assembleGraph(generated: GeneratedWorkflow): WorkflowGraph {
  const positions = layout(generated.nodes, generated.edges);

  return {
    version: GRAPH_VERSION,
    nodes: generated.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      // An absent label stays absent — CONTRACT.md is explicit that it is never
      // written as `undefined`, because that is not valid JSON and a round-trip
      // through jsonb would not reproduce it.
      ...(node.label === undefined ? {} : { label: node.label }),
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      config: viableAgentConfig(node),
    })),
    edges: generated.edges.map((edge, index) => ({
      id: `e${index + 1}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
  };
}

/**
 * One attempt's output → either a validated graph or the issues that stopped it.
 * Exported because every failure mode in here is worth asserting directly.
 */
export function interpret(
  text: string,
): { ok: true; generated: GeneratedWorkflow; graph: WorkflowGraph } | { ok: false; issues: GenerationIssue[] } {
  let raw: unknown;
  try {
    // A model asked for JSON still fences it sometimes. Stripping a fence is
    // leniency about punctuation, not about the contract (see llm.ts).
    raw = JSON.parse(stripCodeFence(text));
  } catch {
    return {
      ok: false,
      issues: [{ code: "not_json", message: "The model's answer was not valid JSON." }],
    };
  }

  const parsed = generatedWorkflowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "bad_shape" as const,
        message: issue.message,
        path: issue.path.join("."),
      })),
    };
  }

  const graph = assembleGraph(parsed.data);

  // The real graph schema, applied to our own assembly. `generatedWorkflowSchema`
  // bounds what the model sends, but this is the shape that gets stored, and a bug
  // in `assembleGraph` must not reach the database.
  const shaped = workflowGraphSchema.safeParse(graph);
  if (!shaped.success) {
    return {
      ok: false,
      issues: shaped.error.issues.map((issue) => ({
        code: "bad_shape" as const,
        message: issue.message,
        path: issue.path.join("."),
      })),
    };
  }

  const validation = validateGraph(shaped.data);
  if (!validation.valid) return { ok: false, issues: validation.problems };

  return { ok: true, generated: parsed.data, graph: shaped.data };
}

/**
 * **Which attempt produced the graph — Phase 34, task 4.** The fields of the `generation.finished`
 * log line, which the `agentforge_generations` metric counts by `outcome` (`OPERATIONS.md`). Facts
 * only: counts, names from the registry, the strategy — never the prompt or the model's answer.
 */
export function generationLogFields(result: GenerationResult, durationMs: number) {
  const outcome = !result.ok ? "failed" : result.attempt === 1 ? "first" : "second";
  return {
    outcome,
    attempts: result.attempts.length,
    /** The retry was spent on references that reached nothing, not on an invalid graph. */
    referenceRetry: result.attempts[0]?.issues.some((issue) => issue.code === "unresolved_reference") ?? false,
    model: result.ok ? result.model : (result.attempts.at(-1)?.model ?? null),
    selector: result.selection.strategy,
    selected: result.selection.types.length,
    selectorFellBack: result.selection.fellBack === true,
    promptChars: result.promptChars,
    unsupported: result.ok ? result.unsupported.length : null,
    issues: result.ok ? 0 : result.issues.length,
    durationMs,
  };
}

/** One line per issue, for feeding a failure back to the model on the retry. */
function issueLines(issues: GenerationIssue[]): string {
  return issues
    .map((issue) => {
      const where =
        "path" in issue && issue.path
          ? ` (at ${issue.path})`
          : "nodeId" in issue && issue.nodeId
            ? ` (node "${issue.nodeId}")`
            : "edgeId" in issue && issue.edgeId
              ? ` (edge "${issue.edgeId}")`
              : "";
      return `- ${issue.message}${where}`;
    })
    .join("\n");
}

/**
 * A failure a user should be able to act on. The issues themselves are returned
 * alongside, so the UI can list them; this is the sentence above the list.
 */
function failureMessage(issues: GenerationIssue[]): string {
  if (issues.some((issue) => issue.code === "not_json")) {
    return "The model did not return a workflow. Try again, or rephrase the request.";
  }
  return "The model produced a workflow that could not run, so it was not saved. Try rephrasing the request.";
}

export async function generateWorkflow(
  options: GenerateWorkflowOptions,
): Promise<GenerationResult> {
  const nodes = options.nodes ?? describeNodes();
  const selection = await chooseCatalogue(options, nodes);
  const system = systemPrompt(nodes, selection.types);
  const promptChars = system.length;
  const turns: ChatTurn[] = [{ role: "user", text: userPrompt(options.prompt) }];
  const attempts: GenerationAttempt[] = [];
  /** A valid first answer held while its references are retried. */
  let kept: { interpreted: Extract<ReturnType<typeof interpret>, { ok: true }>; result: GenerateResult } | null = null;

  // Two attempts, never more. The phase definition is explicit: "Retry once on
  // invalid output, then fail with a readable message. Do not attempt repair loops."
  // A repair loop on a headline demo path spends the user's quota and the audience's
  // patience on an outcome that is already unlikely by the third try.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();

    // A provider failure is deliberately not caught: nothing was produced to judge,
    // so it is not a generation failure. It propagates to the route, which reports
    // the provider's own words ("API key not valid", "high demand").
    const result: GenerateResult = await options.model.generate({
      model: options.modelId,
      system,
      turns,
      // JSON mode is available here because generation uses no tools — Gemini
      // forbids the combination (CONTRACT.md → "The provider interface").
      json: true,
      signal: options.signal,
    });

    const interpreted = interpret(result.text);
    const ms = Date.now() - started;

    const accept = (
      chosen: Extract<ReturnType<typeof interpret>, { ok: true }>,
      answered: GenerateResult,
      which: 1 | 2,
    ): GenerationSuccess => ({
      ok: true,
      name: options.name ?? chosen.generated.name,
      description: chosen.generated.description ?? null,
      graph: chosen.graph,
      unsupported: chosen.generated.unsupported,
      model: answered.model,
      usage: answered.usage,
      attempts,
      attempt: which,
      selection,
      promptChars,
    });

    if (interpreted.ok) {
      // **Phase 34: valid is not the same as right.** A reference that reaches nothing resolves
      // to an empty string at run time and nothing reports it — the eval set caught
      // `{{input.name}}` inside a Loop, whose input is `{ index, item, total }`. So the first
      // attempt's references earn the one retry, with the exact problem; the second attempt's
      // are listed and accepted, because a valid graph is never failed over them.
      const unresolved = checkReferences(interpreted.graph, nodes).map((problem) => ({
        code: "unresolved_reference" as const,
        message: `{{${problem.reference}}}: ${problem.message}`,
        nodeId: problem.nodeId,
        reference: problem.reference,
      }));
      attempts.push({ model: result.model, issues: unresolved, ms });
      if (unresolved.length === 0 || attempt === 1) return accept(interpreted, result, attempt === 0 ? 1 : 2);

      kept = { interpreted, result };
      turns.push({ role: "model", text: result.text, toolCalls: [], raw: result.raw });
      turns.push({
        role: "user",
        text: `That workflow is valid, but these {{ }} references reach nothing — at run time each would be empty:\n\n${issueLines(unresolved)}\n\nFix exactly those references and answer with the corrected workflow as JSON. Keep everything else as it is.`,
      });
      continue;
    }

    attempts.push({ model: result.model, issues: interpreted.issues, ms });

    if (attempt === 1) {
      // The retry over references broke the graph: the first answer was valid, so it stands.
      if (kept) return accept(kept.interpreted, kept.result, 1);
      return {
        ok: false,
        message: failureMessage(interpreted.issues),
        issues: interpreted.issues,
        attempts,
        selection,
        promptChars,
      };
    }

    // The model's own turn is carried back verbatim (D33), then the problems. A
    // model told what was wrong with its own output fixes it far more often than one
    // simply asked again.
    turns.push({ role: "model", text: result.text, toolCalls: [], raw: result.raw });
    // A node the model reached from the index alone gets its full definition now (Phase 34): the
    // safety net under the selector. A miss costs this retry, never the node.
    const reached = undefinedTypesUsed(result.text, selection, nodes);
    const definitions =
      reached.length === 0
        ? ""
        : `\n\nFull definitions of the nodes you used that were only listed:\n\n${renderCatalogue(nodes.filter((node) => reached.includes(node.type)))}`;
    turns.push({
      role: "user",
      text: `That workflow was rejected:\n\n${issueLines(interpreted.issues)}${definitions}\n\nFix exactly those problems and answer with the corrected workflow as JSON. Keep everything that was already correct.`,
    });
  }

  // Unreachable: the loop returns on both attempts. Kept so the function is total
  // rather than relying on the compiler's flow analysis of a fixed bound.
  return {
    ok: false,
    message: failureMessage([]),
    issues: [],
    attempts,
    selection,
    promptChars,
  };
}
