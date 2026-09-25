"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StreamRunPatch } from "@/lib/engine/stream";

import type { Run, RunStep } from "./client";

/**
 * Subscribes to a workflow's run stream and keeps one `Run` object up to date from
 * the events — CONTRACT.md → "SSE event messages".
 *
 * `EventSource` rather than a `fetch` reader: it sends the session cookie by itself,
 * reconnects by itself, and needs no protocol code here beyond applying events. The
 * cost of its reconnecting is that the stream has to be *closed* explicitly when the
 * run is over, or the browser reopens it for ever — so every `done` closes it.
 *
 * A `snapshot` replaces the run wholesale. That is what makes connecting mid-run,
 * reconnecting, and reloading the page all correct without any replay logic (D29).
 */

function mergeStep(run: Run, step: RunStep): Run {
  const steps = run.steps ?? [];
  const at = steps.findIndex((existing) => existing.seq === step.seq);
  const next = at === -1 ? [...steps, step] : steps.with(at, step);
  // Kept in `seq` order, which is execution order, so the log panel does not
  // reorder itself as events land.
  next.sort((a, b) => a.seq - b.seq);
  return { ...run, steps: next };
}

function applyPatch(run: Run, patch: StreamRunPatch): Run {
  const { runId, ...fields } = patch;
  return runId === run.id ? { ...run, ...fields } : run;
}

export interface RunStream {
  run: Run | null;
  /** True while a stream is open, for the "live" affordance in the UI. */
  live: boolean;
  watch: (options?: { runId?: string }) => void;
  stop: () => void;
  /** Set the run directly — the POST response is authoritative when it arrives. */
  setRun: (run: Run | null) => void;
}

export function useRunStream(workflowId: string, initial: Run | null = null): RunStream {
  const [run, setRun] = useState<Run | null>(initial);
  const [live, setLive] = useState(false);
  const source = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    source.current?.close();
    source.current = null;
    setLive(false);
  }, []);

  const watch = useCallback(
    (options?: { runId?: string }) => {
      stop();

      const query = options?.runId ? `?runId=${encodeURIComponent(options.runId)}` : "";
      const opened = new EventSource(`/api/workflows/${workflowId}/stream${query}`);
      source.current = opened;
      setLive(true);

      const close = () => {
        // Only close the connection this listener belongs to: a later `watch` may
        // already have replaced it.
        if (source.current === opened) stop();
        else opened.close();
      };

      opened.addEventListener("snapshot", (event) => {
        setRun(JSON.parse((event as MessageEvent<string>).data) as Run);
      });

      opened.addEventListener("step", (event) => {
        const { runId, step } = JSON.parse((event as MessageEvent<string>).data) as {
          runId: string;
          step: RunStep;
        };
        setRun((current) =>
          current && current.id === runId ? mergeStep(current, step) : current,
        );
      });

      opened.addEventListener("run", (event) => {
        const patch = JSON.parse((event as MessageEvent<string>).data) as StreamRunPatch;
        setRun((current) => (current ? applyPatch(current, patch) : current));
      });

      // Every reason ends the stream — finished, nothing to watch, or the ceiling.
      opened.addEventListener("done", close);

      opened.addEventListener("stream_error", close);

      opened.onerror = () => {
        // A transport blip: `EventSource` is already reconnecting and the next
        // snapshot will resync. Only a genuinely closed connection is terminal —
        // which is what a 401 or 404 on the endpoint produces.
        if (opened.readyState === EventSource.CLOSED) close();
      };
    },
    [stop, workflowId],
  );

  // A stream must not outlive the canvas: Cloud Run bills CPU while one is open.
  useEffect(() => () => source.current?.close(), []);

  return { run, live, watch, stop, setRun };
}
