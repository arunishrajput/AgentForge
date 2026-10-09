"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { ApiRequestError, api, type GenerationErrorDetails, type NodeSummary } from "@/lib/canvas/client";
import {
  EMPTY_COPILOT,
  accept as acceptProposal,
  answered,
  ask as askCopilot,
  failed,
  reject as rejectProposal,
  setAside as setAsideCopilot,
  type CopilotState,
} from "@/lib/canvas/copilot";
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
}

export function useCopilot({
  workflowId,
  graph,
  registry,
}: {
  workflowId: string;
  /** The canvas's graph as of this render. */
  graph: WorkflowGraph;
  registry: ReadonlyMap<string, NodeSummary>;
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

  const ask = useCallback(
    async (text: string) => {
      const started = askCopilot(current.current, text, canvas.current, Date.now());
      if (!started) return;
      commit(started.state);
      setDraft("");
      try {
        const response = await api.proposeEdit(workflowId, started.request);
        commit(answered(current.current, response, canvas.current, registry));
      } catch (error) {
        commit(
          failed(
            current.current,
            error instanceof ApiRequestError
              ? {
                  message: error.message,
                  issues: ((error.details as GenerationErrorDetails | undefined)?.issues ?? [])
                    .slice(0, 6)
                    .map((issue) => issue.message),
                  recovery: error.recovery,
                }
              : { message: "The copilot could not be reached.", issues: [], recovery: null },
          ),
        );
      }
    },
    [commit, registry, workflowId],
  );

  const accept = useCallback(() => {
    const result = acceptProposal(current.current);
    if (!result) return null;
    commit(result.state);
    return result.graph;
  }, [commit]);

  const reject = useCallback(() => commit(rejectProposal(current.current)), [commit]);

  const setAside = useCallback((reason: string) => commit(setAsideCopilot(current.current, reason)), [commit]);

  return { state, busy: state.pending !== null, draft, setDraft, ask, accept, reject, setAside };
}
