import type { Recovery } from "@/lib/api-error";
import { COPILOT_EARLIER_MAX } from "@/lib/generate/schema";
import type { NodeSummary } from "@/lib/nodes";
import { diffGraphs, type DiffSummary, type GraphDiff } from "@/lib/workflow/diff";
import { graphsEqual, type WorkflowGraph } from "@/lib/workflow/graph";

import type { CopilotResponse } from "./client";
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
 */

export type ProposalOutcome = "open" | "accepted" | "rejected" | "refined" | "set-aside";

export type Turn =
  | { id: number; from: "you"; text: string }
  | { id: number; from: "copilot"; state: "thinking"; startedAt: number }
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
    }
  | { id: number; from: "copilot"; state: "nothing"; unsupported: string[]; model: string }
  | { id: number; from: "copilot"; state: "failed"; message: string; issues: string[]; recovery: Recovery | null }
  | { id: number; from: "copilot"; state: "set-aside"; reason: string };

export interface Proposal {
  /** The canvas this proposal is a change to. */
  base: WorkflowGraph;
  graph: WorkflowGraph;
  diff: GraphDiff;
  /** Every instruction this proposal reflects, oldest first — what a refine sends as `earlier`. */
  instructions: string[];
  /** The turn that shows it. */
  turn: number;
}

/** A request in flight: what was sent, and what its answer will be measured against. */
interface Pending {
  turn: number;
  instruction: string;
  base: WorkflowGraph;
  instructions: string[];
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
 */
export function ask(
  state: CopilotState,
  text: string,
  canvas: WorkflowGraph,
  now: number,
): { state: CopilotState; request: EditRequest } | null {
  const instruction = text.trim();
  if (instruction === "" || state.pending) return null;

  const refining = state.proposal;
  const you = state.next;
  const thinking = state.next + 1;
  const base = refining ? refining.base : canvas;
  const instructions = refining ? refining.instructions : [];

  return {
    state: {
      ...state,
      turns: [
        ...state.turns,
        { id: you, from: "you", text: instruction },
        { id: thinking, from: "copilot", state: "thinking", startedAt: now },
      ],
      pending: { turn: thinking, instruction, base, instructions },
      next: state.next + 2,
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
  if (!pending) return state;
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
    },
    {
      base: pending.base,
      graph: proposal.graph,
      diff,
      instructions: [...pending.instructions, pending.instruction],
      turn: pending.turn,
    },
    "refined",
  );
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
