"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { ApiRequestError, api, type GenerationErrorDetails, type NodeSummary } from "@/lib/canvas/client";
import {
  EMPTY_COPILOT,
  accept as acceptProposal,
  answered,
  ask as askCopilot,
  askAbout,
  diagnosed,
  explained,
  failed,
  followed,
  opened,
  reject as rejectProposal,
  setAside as setAsideCopilot,
  type CopilotState,
  type Fixes,
} from "@/lib/canvas/copilot";
import { shortRunId } from "@/lib/runs/words";
import type { WorkflowGraph } from "@/lib/workflow/graph";

/**
 * The copilot, wired to the canvas — Phase 35. The conversation's rules are `lib/canvas/copilot.ts`,
 * with tests; this is the part that talks to the API and keeps the result on screen.
 *
 * **The state is a ref first and React state second.** An answer arrives after an `await`, and it
 * must be judged against the conversation and the canvas *as they are then* — a version restored
 * in the meantime has set the question aside, and a canvas edited in the meantime makes the answer
 * a change to a graph that is gone. Reading both from refs at that moment is what makes those two
 * cases correct; the render state only draws them.
 */
export interface Copilot {
  state: CopilotState;
  busy: boolean;
  /** The composer's text, kept here so switching the column to the inspector and back keeps it. */
  draft: string;
  setDraft: (text: string) => void;
  /** Ask, or refine the open proposal. Resolves when the answer has been shown. */
  ask: (text: string) => Promise<void>;
  /**
   * Close the open proposal as accepted and hand back its graph, for the editor to put on the
   * canvas as one step of undo. Null when there is nothing to accept.
   */
  accept: () => WorkflowGraph | null;
  reject: () => void;
  /** The canvas was replaced under the conversation — a restore. */
  setAside: (reason: string) => void;
  /** Phase 36: explain the workflow on the canvas. */
  explain: () => Promise<void>;
  /**
   * Phase 36: why did this run fail? When the diagnosis finds a fix in the workflow, the copilot
   * asks for it straight away and the proposal opens on the canvas (D167).
   */
  diagnose: (runId: string) => Promise<void>;
  /** An accepted fix's run was started again from its turn — stop offering it. */
  markFollowed: (turnId: number) => void;
  /**
   * The sentence pressed, and the steps it cites — highlighted on the canvas, never selected
   * (D169). Null when none is.
   */
  highlight: Highlight | null;
  setHighlight: (highlight: Highlight | null) => void;
}

/** A pressed sentence: which turn, which sentence in it, and the steps it is about. */
export interface Highlight {
  turn: number;
  index: number;
  nodes: string[];
}

/** A failed request, in the words the conversation shows. */
function failure(error: unknown) {
  return error instanceof ApiRequestError
    ? {
        message: error.message,
        issues: ((error.details as GenerationErrorDetails | undefined)?.issues ?? []).slice(0, 6).map((issue) => issue.message),
        recovery: error.recovery,
      }
    : { message: "The copilot could not be reached.", issues: [], recovery: null };
}

export function useCopilot({
  workflowId,
  graph,
  registry,
  onOpened,
}: {
  workflowId: string;
  /** The canvas's graph as of this render. */
  graph: WorkflowGraph;
  registry: ReadonlyMap<string, NodeSummary>;
  /** A proposal opened, or a refinement replaced it (`opened`) — the editor fits the canvas to it. */
  onOpened: () => void;
}): Copilot {
  const [state, setState] = useState<CopilotState>(EMPTY_COPILOT);
  const [draft, setDraft] = useState("");
  const current = useRef(state);
  const canvas = useRef(graph);
  useLayoutEffect(() => {
    canvas.current = graph;
  }, [graph]);

  const commit = useCallback((next: CopilotState) => {
    current.current = next;
    setState(next);
  }, []);

  /** Ask for an edit — the person's own, or (Phase 36) a diagnosis's fix, which carries `fixes`. */
  const send = useCallback(
    async (text: string, fixes?: Fixes) => {
      const started = askCopilot(current.current, text, canvas.current, Date.now(), fixes);
      if (!started) return;
      commit(started.state);
      if (!fixes) setDraft("");
      try {
        const response = await api.proposeEdit(workflowId, started.request);
        const before = current.current;
        const next = answered(before, response, canvas.current, registry);
        commit(next);
        if (opened(before, next)) onOpened();
      } catch (error) {
        commit(failed(current.current, failure(error)));
      }
    },
    [commit, onOpened, registry, workflowId],
  );

  const ask = useCallback((text: string) => send(text), [send]);

  const explain = useCallback(async () => {
    const graph = canvas.current;
    const started = askAbout(current.current, { kind: "explain" }, "Explain this workflow", graph, Date.now());
    if (!started) return;
    commit(started.state);
    try {
      commit(explained(current.current, await api.explainWorkflow(workflowId, graph)));
    } catch (error) {
      commit(failed(current.current, failure(error)));
    }
  }, [commit, workflowId]);

  const diagnose = useCallback(
    async (runId: string) => {
      const graph = canvas.current;
      const label = `Why did run ${shortRunId(runId)} fail?`;
      const started = askAbout(current.current, { kind: "diagnose", runId }, label, graph, Date.now());
      if (!started) return;
      commit(started.state);
      let fix: { text: string; fixes: Fixes } | null = null;
      try {
        const answer = diagnosed(current.current, await api.diagnoseRun(workflowId, runId, graph));
        commit(answer.state);
        fix = answer.fix;
      } catch (error) {
        commit(failed(current.current, failure(error)));
      }
      // The fix is an edit like any other, asked against the canvas as it is now (D167).
      if (fix) await send(fix.text, fix.fixes);
    },
    [commit, send, workflowId],
  );

  const accept = useCallback(() => {
    const result = acceptProposal(current.current);
    if (!result) return null;
    commit(result.state);
    return result.graph;
  }, [commit]);

  const reject = useCallback(() => commit(rejectProposal(current.current)), [commit]);

  const setAside = useCallback((reason: string) => commit(setAsideCopilot(current.current, reason)), [commit]);

  const markFollowed = useCallback((turnId: number) => commit(followed(current.current, turnId)), [commit]);

  const [highlight, setHighlight] = useState<Highlight | null>(null);

  return {
    state,
    busy: state.pending !== null,
    draft,
    setDraft,
    ask,
    accept,
    reject,
    setAside,
    explain,
    diagnose,
    markFollowed,
    highlight,
    setHighlight,
  };
}
