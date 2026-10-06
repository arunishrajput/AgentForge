"use client";

import { useState } from "react";

import type { CanvasNode } from "@/lib/canvas/bridge";
import type { Workflow } from "@/lib/canvas/client";
import { formatUtc } from "@/lib/triggers/cron";

/**
 * What a trigger node needs that its config form cannot show: the URL an external
 * system must call, and when a schedule will next fire.
 *
 * Both come from the **saved** workflow rather than from canvas state, and that is
 * the point. A webhook URL is only real once the trigger node is persisted — the
 * receiver reads the stored graph — so showing one for an unsaved node would print a
 * URL that answers 404. The same holds for the next scheduled time: it is derived on
 * save, so it must be read from what came back from the save.
 *
 * Every date is rendered with `formatUtc`, never `toLocaleString()`. This is a client
 * component and the browser's locale and zone disagree with the server's, which React
 * reports as hydration error #418 (PROGRESS.md, Phase 6).
 */
export function TriggerPanel({
  node,
  workflow,
  dirty,
  canRotate,
  onRotate,
}: {
  node: CanvasNode;
  workflow: Workflow;
  dirty: boolean;
  /** Replacing the URL is `admin` — Phase 21. A lesser role is shown why, not a dead button. */
  canRotate: boolean;
  onRotate: () => Promise<void>;
}) {
  if (node.data.nodeType === "core.webhook_trigger") {
    return (
      <WebhookPanel
        workflow={workflow}
        dirty={dirty}
        canRotate={canRotate}
        onRotate={onRotate}
      />
    );
  }
  if (node.data.nodeType === "core.schedule_trigger") {
    return <SchedulePanel workflow={workflow} dirty={dirty} />;
  }
  return null;
}

function WebhookPanel({
  workflow,
  dirty,
  canRotate,
  onRotate,
}: {
  workflow: Workflow;
  dirty: boolean;
  canRotate: boolean;
  onRotate: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  /**
   * Rotation is two presses — **Phase 21**, and the second press is not ceremony.
   *
   * The old URL is dead the instant the request returns, so whatever is calling it stops
   * working: a Zap, a GitHub webhook, a cron on somebody's laptop. A single button beside a
   * "Copy URL" button, half an inch from a mouse that came to copy, is the wrong affordance
   * for something with no undo. The confirm step states the consequence in those words.
   */
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotated, setRotated] = useState(false);

  if (!workflow.webhookUrl) {
    return (
      <Section title="Webhook URL">
        <p className="text-muted text-xs leading-relaxed">
          Save the workflow to get its URL. The receiver reads the stored graph, so the
          URL only answers once this trigger is saved.
        </p>
      </Section>
    );
  }

  const rotate = async () => {
    setRotating(true);
    try {
      await onRotate();
      setConfirming(false);
      setRotated(true);
      // The new URL is already in the field: `onRotate` replaces the saved workflow, and
      // this panel reads `workflow.webhookUrl` from it. Nothing here builds a URL.
      setCopied(false);
    } finally {
      setRotating(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(workflow.webhookUrl!);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context and can be refused by
      // permission. The field is selectable, so say so rather than failing silently.
      setCopyFailed(true);
    }
  };

  return (
    <Section title="Webhook URL">
      {/* Phase 26. Said where the URL is, because this is where somebody debugging a
          failing integration looks — and a 409 they did not expect is the symptom. */}
      {!workflow.active && (
        <p className="border-line bg-sunken rounded-lg border-2 p-2 text-2xs leading-relaxed">
          <strong className="font-bold">Switched off.</strong> This URL answers{" "}
          <code>409</code> and starts nothing until the workflow is switched back on.
        </p>
      )}

      <input
        type="text"
        readOnly
        value={workflow.webhookUrl}
        onFocus={(event) => event.currentTarget.select()}
        className="field font-mono text-2xs"
      />

      <button
        type="button"
        onClick={copy}
        className="btn btn-quiet w-full"
      >
        {copied ? "Copied" : "Copy URL"}
      </button>

      {copyFailed && (
        <p className="text-2xs text-warn">
          The browser refused clipboard access — select the field and copy it manually.
        </p>
      )}

      {/* --- rotation, Phase 21 ------------------------------------------- */}
      {canRotate &&
        (confirming ? (
          <div className="border-line bg-sunken animate-rise space-y-2 rounded-lg border-2 p-2.5">
            <p className="text-2xs leading-relaxed">
              <strong className="font-bold">The URL above stops working immediately.</strong>{" "}
              Anything already calling it will get a 404 until you give it the new one. There
              is no way back to the old URL.
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={rotate}
                aria-busy={rotating}
                className="btn btn-danger flex-1 text-2xs"
              >
                {rotating ? "Rotating…" : "Replace it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn btn-ghost text-2xs"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setRotated(false);
            }}
            className="btn btn-ghost w-full text-2xs"
          >
            Rotate this URL
          </button>
        ))}

      {rotated && (
        <p className="text-2xs text-ok-ink" role="status">
          Rotated. The URL above is the new one — the previous URL is already refused.
        </p>
      )}

      {workflow.webhookTokenRotatedAt && !rotated && (
        <p className="text-faint text-2xs">
          Last rotated {formatUtc(workflow.webhookTokenRotatedAt)}.
        </p>
      )}

      {dirty && (
        <p className="text-2xs text-warn">
          There are unsaved changes. The URL fires the workflow as it is <em>stored</em>.
        </p>
      )}

      <p className="text-muted text-2xs leading-relaxed">
        POST JSON here to start a run. Anyone holding this URL can trigger it, so treat
        it as a secret. The body becomes this node&apos;s output — reach it with{" "}
        <code>{"{{trigger.field}}"}</code>.
      </p>
    </Section>
  );
}

/**
 * **Honest about the timer — Phase 26.** A schedule fires from a Cloud Tasks timer armed
 * for its exact due time, so "Next run" alone would imply a punctuality the panel cannot
 * see. It says whether a timer was created for that time; if not, the daily sweep fires
 * it instead, which can be up to a day late, and the panel says so rather than letting a
 * missed 09:00 be a surprise.
 */
function SchedulePanel({ workflow, dirty }: { workflow: Workflow; dirty: boolean }) {
  if (!workflow.active) {
    return (
      <Section title="Schedule">
        <p className="border-line bg-sunken rounded-lg border-2 p-2 text-2xs leading-relaxed">
          <strong className="font-bold">Switched off.</strong> This schedule will not fire.
          Switch the workflow back on and it schedules from then — the slots it missed are
          not caught up.
        </p>
        {workflow.scheduleLastFiredAt && (
          <Row label="Last fired" value={formatUtc(workflow.scheduleLastFiredAt)} />
        )}
        {workflow.scheduleCron && <Row label="Expression" value={workflow.scheduleCron} mono />}
      </Section>
    );
  }

  return (
    <Section title="Schedule">
      {workflow.scheduleNextAt ? (
        <>
          <Row label="Next run" value={formatUtc(workflow.scheduleNextAt)} />
          <Row label="Timer" value={workflow.scheduleArmed ? "Armed" : "Not armed"} />
          {!workflow.scheduleArmed && (
            <p className="text-2xs text-warn leading-relaxed">
              No timer is set for this time yet, so the daily safety sweep will fire it —
              possibly hours late. Saving again retries; so does the sweep.
            </p>
          )}
        </>
      ) : (
        <p className="text-muted text-xs leading-relaxed">
          {dirty
            ? "Save the workflow to schedule it."
            : "Not scheduled. Check the cron expression above — an expression that cannot be read is reported as a problem."}
        </p>
      )}

      {workflow.scheduleLastFiredAt && (
        <Row label="Last fired" value={formatUtc(workflow.scheduleLastFiredAt)} />
      )}

      {workflow.scheduleCron && (
        <Row label="Expression" value={workflow.scheduleCron} mono />
      )}

      <p className="text-muted text-2xs leading-relaxed">
        Cron is evaluated in <strong>UTC</strong>. A timer is set for each run&apos;s exact
        time, so it starts within seconds of its slot — a little longer if the service was
        asleep.
      </p>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted text-xs">{label}</span>
      <span className={`text-xs ${mono ? "font-mono text-2xs" : ""}`}>{value}</span>
    </div>
  );
}
