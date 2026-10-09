import type { Recovery } from "@/lib/api-error";
import type { RunFacts } from "@/lib/generate/evidence";
import type { Sentence } from "@/lib/generate/explain";
import { COPILOT_EARLIER_MAX } from "@/lib/generate/schema";
import type { NodeSummary } from "@/lib/nodes";
import { diffGraphs, type DiffSummary, type GraphDiff } from "@/lib/workflow/diff";
import { graphsEqual, type WorkflowGraph } from "@/lib/workflow/graph";

import { afterFix, type AfterFix } from "./after-fix";
import type { CopilotResponse, DiagnoseResponse, ExplainResponse } from "./client";
import { describeProposal, type ChangeLine } from "./proposal";

/**
 * **The copilot's conversation — Phase 35.** Pure, so every path a person can take through it is a
 * test: ask, refine, accept, reject, and the two ways a proposal is set aside rather than shown.
 * `use-copilot.ts` is the React half — it calls the API and hands this module the answers.
 *
 * **Client state, by design** (task 6, D164). No table, no row, nothing to wake Neon for: the
 * conversation lives as long as this canvas does, and a reload starts a new one. A proposal is
 * never stored either — it is a graph held here until Accept puts it on the canvas.
 *
 * **What a proposal is measured against.** `base` is the canvas when the conversation's current
 * proposal was first asked for, and every *refine* edits the proposal but is still shown as a diff
 * from that same base — so "also post to Slack", then "no, only the urgent ones", reads as one
 * change to the workflow, which is what Accept will make. The canvas cannot drift from `base`
 * underneath an open proposal: diff mode makes it inert, exactly as a version comparison does.
 *
 * **Phase 36 adds two answers that change nothing** — an *explanation* of the workflow and a
 * *diagnosis* of a failed run, each a list of sentences citing the steps they are about — and one
 * that does: **a diagnosis's fix**. When a diagnosis finds a change to the workflow that would fix
 * the run, the conversation asks for that change itself, as an edit, straight away (D167): the
 * proposal that comes back is an ordinary one — Accept, Reject, refine — that also remembers the
 * run it fixes, so once accepted it can offer the right way to run it again (`after-fix.ts`, D171).
 */

export type ProposalOutcome = "open" | "accepted" | "rejected" | "refined" | "set-aside";

/** What a request in flight is doing — what the thinking turn says while it waits. */
export type CopilotTask = "edit" | "explain" | "diagnose" | "fix";

/** A proposal that fixes a failed run — Phase 36: which run, and what is known about it. */
export interface Fixes {
  run: RunFacts;
}

export type Turn =
  | { id: number; from: "you"; text: string }
  | { id: number; from: "copilot"; state: "thinking"; startedAt: number; task: CopilotTask }
  | {
      id: number;
      from: "copilot";
      state: "proposal";
      summary: DiffSummary;
      lines: ChangeLine[];
      unsupported: string[];
      /** Problems the proposal still has — ones the canvas already had (D162). */
      problems: number;
      model: string;
      outcome: ProposalOutcome;
      /**
       * Phase 36: this proposal fixes a failed run, and how to run it again once accepted — retry
       * from the failed step, or re-run (D171). `followed` once that has been started from here.
       */
      fix?: { runId: string; next: AfterFix; followed: boolean };
    }
  | { id: number; from: "copilot"; state: "nothing"; unsupported: string[]; model: string }
  | { id: number; from: "copilot"; state: "failed"; message: string; issues: string[]; recovery: Recovery | null }
  | { id: number; from: "copilot"; state: "set-aside"; reason: string }
  /** Phase 36: a walkthrough. Each sentence highlights its steps when pressed (D169). */
  | { id: number; from: "copilot"; state: "explanation"; summary: string; sentences: Sentence[]; model: string }
  /** Phase 36: why a run failed — and the fix, in words, that the next turn drafts. */
  | {
      id: number;
      from: "copilot";
      state: "diagnosis";
      runId: string;
      sentences: Sentence[];
      fix: string | null;
      model: string;
    };

export interface Proposal {
  /** The canvas this proposal is a change to. */
  base: WorkflowGraph;
  graph: WorkflowGraph;
  diff: GraphDiff;
  /** Every instruction this proposal reflects, oldest first — what a refine sends as `earlier`. */
  instructions: string[];
  /** The turn that shows it. */
  turn: number;
  /** Phase 36: the run this proposal fixes. A refine of it still fixes that run. */
  fixes?: Fixes;
}

/** A request in flight: what was sent, and what its answer will be measured against. */
interface Pending {
  turn: number;
  task: CopilotTask;
  instruction: string;
  base: WorkflowGraph;
  instructions: string[];
  fixes?: Fixes;
}

export interface CopilotState {
  turns: Turn[];
  proposal: Proposal | null;
  pending: Pending | null;
  next: number;
}

export const EMPTY_COPILOT: CopilotState = { turns: [], proposal: null, pending: null, next: 1 };

export interface EditRequest {
  instruction: string;
  graph: WorkflowGraph;
  earlier: string[];
}

/**
 * Ask — or refine, when a proposal is open. Returns the request to send, or null when one is
 * already in flight (one at a time: an answer to a question nobody is looking at any more is how
 * a conversation stops making sense).
 *
 * `fixes` is Phase 36's: the copilot asking for a diagnosis's fix itself. Nobody typed it, so there
 * is no "you" turn — the diagnosis above already shows the fix in words — and the proposal that
 * comes back remembers the run.
 */
export function ask(
  state: CopilotState,
  text: string,
  canvas: WorkflowGraph,
  now: number,
  fixes?: Fixes,
): { state: CopilotState; request: EditRequest } | null {
  const instruction = text.trim();
  if (instruction === "" || state.pending) return null;

  const refining = state.proposal;
  const base = refining ? refining.base : canvas;
  const instructions = refining ? refining.instructions : [];
  const you: Turn[] = fixes ? [] : [{ id: state.next, from: "you", text: instruction }];
  const thinking = state.next + you.length;
  const task: CopilotTask = fixes ? "fix" : "edit";

  return {
    state: {
      ...state,
      turns: [...state.turns, ...you, { id: thinking, from: "copilot", state: "thinking", startedAt: now, task }],
      pending: { turn: thinking, task, instruction, base, instructions, fixes: fixes ?? refining?.fixes },
      next: thinking + 1,
    },
    request: {
      instruction,
      // A refine edits the proposal, not the canvas: "no, to #alerts" is about what was proposed.
      graph: refining ? refining.graph : canvas,
      earlier: instructions.slice(-COPILOT_EARLIER_MAX),
    },
  };
}

function replaceTurn(turns: Turn[], id: number, next: Turn): Turn[] {
  return turns.map((turn) => (turn.id === id ? next : turn));
}

function closeProposal(turns: Turn[], proposal: Proposal | null, outcome: ProposalOutcome): Turn[] {
  if (!proposal) return turns;
  return turns.map((turn) =>
    turn.id === proposal.turn && turn.from === "copilot" && turn.state === "proposal" ? { ...turn, outcome } : turn,
  );
}

/**
 * The copilot answered. `canvas` is the canvas *now* — and if the person edited it while the
 * copilot was working, the answer is a change to a graph that is no longer there, so it is set
 * aside rather than shown: accepting it would quietly undo what they just did.
 */
export function answered(
  state: CopilotState,
  response: CopilotResponse,
  canvas: WorkflowGraph,
  registry: ReadonlyMap<string, NodeSummary>,
): CopilotState {
  const pending = state.pending;
  // An edit's answer, or a fix's — an explanation or a diagnosis is answered by its own function.
  if (!pending || (pending.task !== "edit" && pending.task !== "fix")) return state;
  const settle = (turn: Turn, proposal: Proposal | null, outcome: ProposalOutcome): CopilotState => ({
    ...state,
    turns: replaceTurn(closeProposal(state.turns, state.proposal, outcome), pending.turn, turn),
    proposal,
    pending: null,
  });

  if (!state.proposal && !graphsEqual(canvas, pending.base)) {
    return settle(
      {
        id: pending.turn,
        from: "copilot",
        state: "set-aside",
        reason: "The canvas changed while the copilot was working, so its proposal was set aside and nothing was applied. Ask again to have it work from what is there now.",
      },
      null,
      "set-aside",
    );
  }

  const { proposal } = response;
  const diff = diffGraphs(pending.base, proposal.graph);
  if (!diff.summary.any) {
    // Nothing to accept: either nothing could be done, or a refine walked the proposal back to the
    // canvas exactly. Either way the canvas is the answer, and diff mode closes.
    return settle(
      { id: pending.turn, from: "copilot", state: "nothing", unsupported: proposal.unsupported, model: response.generation.model },
      null,
      "refined",
    );
  }

  return settle(
    {
      id: pending.turn,
      from: "copilot",
      state: "proposal",
      summary: diff.summary,
      lines: describeProposal(diff, registry),
      unsupported: proposal.unsupported,
      problems: proposal.problems.length,
      model: response.generation.model,
      outcome: "open",
      ...(pending.fixes
        ? { fix: { runId: pending.fixes.run.id, next: afterFix(pending.fixes.run, diff), followed: false } }
        : {}),
    },
    {
      base: pending.base,
      graph: proposal.graph,
      diff,
      instructions: [...pending.instructions, pending.instruction],
      turn: pending.turn,
      ...(pending.fixes ? { fixes: pending.fixes } : {}),
    },
    "refined",
  );
}

/** What Phase 36's two reading asks send. */
export type ReadRequest = { kind: "explain" } | { kind: "diagnose"; runId: string };

/**
 * *Explain this workflow*, or *why did this run fail?* — asked from a button, so `label` is what
 * the "you" turn says. Never while a proposal is open: an explanation of the canvas under a diff is
 * an explanation of a graph that may be about to change, and a diagnosis's fix needs a canvas to
 * propose against. Null when it cannot be asked now.
 */
export function askAbout(
  state: CopilotState,
  request: ReadRequest,
  label: string,
  canvas: WorkflowGraph,
  now: number,
): { state: CopilotState; request: ReadRequest } | null {
  if (state.pending || state.proposal) return null;
  const you = state.next;
  const thinking = state.next + 1;
  return {
    state: {
      ...state,
      turns: [
        ...state.turns,
        { id: you, from: "you", text: label },
        { id: thinking, from: "copilot", state: "thinking", startedAt: now, task: request.kind },
      ],
      pending: { turn: thinking, task: request.kind, instruction: label, base: canvas, instructions: [] },
      next: state.next + 2,
    },
    request,
  };
}

/** The explanation arrived. It changes nothing, so a canvas edited meanwhile does not set it aside. */
export function explained(state: CopilotState, response: ExplainResponse): CopilotState {
  const pending = state.pending;
  if (!pending || pending.task !== "explain") return state;
  return {
    ...state,
    turns: replaceTurn(state.turns, pending.turn, {
      id: pending.turn,
      from: "copilot",
      state: "explanation",
      summary: response.explanation.summary,
      sentences: response.explanation.sentences,
      model: response.generation.model,
    }),
    pending: null,
  };
}

/**
 * The diagnosis arrived. Returns the conversation with it shown, and — when it found a fix in the
 * workflow — what to ask next: the fix, as an edit, against the canvas as it is now (D167).
 */
export function diagnosed(state: CopilotState, response: DiagnoseResponse): { state: CopilotState; fix: { text: string; fixes: Fixes } | null } {
  const pending = state.pending;
  if (!pending || pending.task !== "diagnose") return { state, fix: null };
  const { diagnosis } = response;
  return {
    state: {
      ...state,
      turns: replaceTurn(state.turns, pending.turn, {
        id: pending.turn,
        from: "copilot",
        state: "diagnosis",
        runId: response.run.id,
        sentences: diagnosis.sentences,
        fix: diagnosis.fix,
        model: response.generation.model,
      }),
      pending: null,
    },
    fix: diagnosis.fix === null ? null : { text: diagnosis.fix, fixes: { run: response.run } },
  };
}

/** The way to run it again was started from an accepted fix — the turn stops offering it. */
export function followed(state: CopilotState, turnId: number): CopilotState {
  return {
    ...state,
    turns: state.turns.map((turn) =>
      turn.id === turnId && turn.from === "copilot" && turn.state === "proposal" && turn.fix
        ? { ...turn, fix: { ...turn.fix, followed: true } }
        : turn,
    ),
  };
}

/**
 * Whether an answer put a new proposal on the canvas — a first one, or a refinement replacing the
 * last. The editor fits the canvas to it then, as it does when two versions are compared: a
 * proposal's added node lands beside the graph, and found in a browser, half under the minimap.
 */
export function opened(before: CopilotState, after: CopilotState): boolean {
  return after.proposal !== null && after.proposal.turn !== before.proposal?.turn;
}

/** The request failed. An open proposal stays open — a failed refine has not changed it. */
export function failed(
  state: CopilotState,
  error: { message: string; issues: string[]; recovery: Recovery | null },
): CopilotState {
  const pending = state.pending;
  if (!pending) return state;
  return {
    ...state,
    turns: replaceTurn(state.turns, pending.turn, { id: pending.turn, from: "copilot", state: "failed", ...error }),
    pending: null,
  };
}

/** Accept: the graph to put on the canvas, and the conversation marked. */
export function accept(state: CopilotState): { state: CopilotState; graph: WorkflowGraph } | null {
  if (!state.proposal || state.pending) return null;
  return {
    state: { ...state, turns: closeProposal(state.turns, state.proposal, "accepted"), proposal: null },
    graph: state.proposal.graph,
  };
}

export function reject(state: CopilotState): CopilotState {
  if (!state.proposal || state.pending) return state;
  return { ...state, turns: closeProposal(state.turns, state.proposal, "rejected"), proposal: null };
}

/**
 * The ground moved — a version was restored over the canvas. Whatever is open or in flight was a
 * change to a graph that is gone, so it is set aside, and the conversation says why.
 */
export function setAside(state: CopilotState, reason: string): CopilotState {
  if (!state.proposal && !state.pending) return state;
  const turns = closeProposal(state.turns, state.proposal, "set-aside");
  const id = state.pending?.turn ?? state.next;
  const note: Turn = { id, from: "copilot", state: "set-aside", reason };
  return {
    turns: state.pending ? replaceTurn(turns, id, note) : [...turns, note],
    proposal: null,
    pending: null,
    next: state.pending ? state.next : state.next + 1,
  };
}
