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
 *
 * **Re-arming (Phase 12).** The server ends a stream for three different reasons and
 * says which (`finished | idle | timeout`). Only `finished` means there is nothing
 * left to see. The other two are the server protecting itself — it will not hold an
 * idle connection open — and treating them as "stop watching" is what made a
 * webhook-triggered run invisible on the canvas: the page sat there, the run happened
 * on the server, and no node ever lit up. That is `DEMO.md` Beat 6, whose whole claim
 * is "nothing is being refreshed", and it was broken in exactly the case Beat 5 sets
 * up. The smoke script never caught it because it opens the stream over HTTP itself
 * and fires 400 ms later; it proves the *server* streams, not that the *canvas* is
 * still listening 25 seconds after it loaded.
 *
 * So a stream that ends on its own re-opens instead, whatever the reason — `finished`
 * only means the run that was showing has ended, and the next one may arrive from a
 * webhook at any moment. Only an explicit `stop` ends it. Re-arming happens only while
 * the tab is visible; hidden tabs stop and re-attach when they come back. The
 * cost is bounded by human attention rather than by uptime: two statements per 300 ms
 * while someone is looking at a canvas, which is 0.25 CU on Neon — about 400 hours of
 * continuously-watched canvas inside the free month. The Known Issue that warns about
 * pinning Neon awake is about a *background* poller running 720 h/month; a visible tab
 * is not that.
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

  /**
   * Whether the canvas still wants to be watching. It is what separates "this
   * connection ended" from "we are done here": a stream that closes on its own
   * re-arms, and one that `stop` closed does not. It also lets a tab that was hidden
   * when its stream ended re-attach when it comes back into view.
   */
  const wanted = useRef(false);
  const rearmAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchRef = useRef<((options?: { runId?: string }) => void) | null>(null);

  /**
   * The explicit end. `stop` means "stop watching", not "this connection closed", so
   * it clears the intent and nothing re-arms afterwards — which is what keeps the Run
   * button's cost behaviour exactly as it was: the POST resolves once the run is over
   * and its `finally` ends the stream for good.
   */
  const stop = useCallback(() => {
    wanted.current = false;
    if (rearmAt.current) clearTimeout(rearmAt.current);
    source.current?.close();
    source.current = null;
    setLive(false);
  }, []);

  const rearm = useCallback(() => {
    if (!wanted.current) return setLive(false);
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      // Nothing is being looked at, so nothing is worth polling for. The
      // visibilitychange listener below re-attaches when the tab comes back.
      setLive(false);
      return;
    }
    if (rearmAt.current) clearTimeout(rearmAt.current);
    // A beat, so a server that is closing streams immediately cannot be hammered.
    rearmAt.current = setTimeout(() => watchRef.current?.(), 250);
  }, []);

  const watch = useCallback(
    (options?: { runId?: string }) => {
      stop();

      wanted.current = true;
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

      /**
       * Every reason re-arms, because none of them means the *canvas* is finished —
       * only that this connection is. `idle` and `timeout` are the server declining
       * to hold a quiet socket open, and `finished` just means the run that was
       * showing has ended, while the next one may arrive from a webhook at any time.
       *
       * Treating them all as "stop watching" is what made a webhook-triggered run
       * invisible: the page sat on the canvas, the run happened on the server, and no
       * node ever lit up. That is `DEMO.md` Beat 6 — whose claim is literally
       * "nothing is being refreshed" — broken in exactly the case Beat 5 sets up.
       *
       * Not a busy loop: the server holds a quiet connection for STREAM_IDLE_MS
       * (20 s) before saying `idle`, so this is at most one reconnect every 20
       * seconds, and none while the tab is hidden. An explicit `stop` still wins,
       * because `rearm` re-checks the intent when its timer fires.
       */
      opened.addEventListener("done", () => {
        if (source.current !== opened) return opened.close();
        opened.close();
        source.current = null;
        rearm();
      });

      opened.addEventListener("stream_error", close);

      opened.onerror = () => {
        // A transport blip: `EventSource` is already reconnecting and the next
        // snapshot will resync. Only a genuinely closed connection is terminal —
        // which is what a 401 or 404 on the endpoint produces.
        if (opened.readyState === EventSource.CLOSED) close();
      };
    },
    [rearm, stop, workflowId],
  );

  watchRef.current = watch;

  // A tab that was hidden when its stream ended re-attaches when it comes back, so
  // returning to the canvas shows what is happening rather than a frozen graph.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && wanted.current && !source.current) {
        rearm();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [rearm]);

  // A stream must not outlive the canvas: Cloud Run bills CPU while one is open.
  useEffect(
    () => () => {
      wanted.current = false;
      if (rearmAt.current) clearTimeout(rearmAt.current);
      source.current?.close();
    },
    [],
  );

  return { run, live, watch, stop, setRun };
}
