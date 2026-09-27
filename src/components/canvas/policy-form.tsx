"use client";

import { Labelled, Input, Select } from "@/components/ui/field";
import {
  attemptDelayMs,
  MAX_BACKOFF_MS,
  MAX_RETRIES,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  type NodePolicy,
} from "@/lib/engine/policy";

/**
 * Retry and timeout for one node — `PRD.md` C4, the requirement Chapter 1 wrote down as
 * S6 and never built.
 *
 * **Deliberately the quiet register** (`DESIGN.md`): plain fields on paper, no fills, no
 * shadows, no mascot. This is a settings form inside a settings panel, and the design
 * language's own rule is that the loud register belongs on the landing page and gets in
 * the way here.
 *
 * Two behaviours are worth stating because they are not obvious from the markup:
 *
 *  - **Absent stays absent.** A node nobody has configured must round-trip through the
 *    canvas without gaining a `policy` key, or every workflow saved before Phase 17
 *    would show as unsaved the instant it loaded (`bridge.ts`). So the form normalises
 *    "no retries and no timeout" back to `undefined` rather than writing out a default,
 *    which also means "Reset" genuinely returns the node to clean.
 *  - **The bounds come from the schema**, imported rather than retyped. They are safety
 *    properties — the reason they exist is that a *model* writes these graphs too — and a
 *    form that let you type a number the schema rejects would fail at run time instead of
 *    at the keyboard.
 */

/** "No retries and no timeout of its own" is the absence of a policy, not a policy. */
function normalise(policy: NodePolicy): NodePolicy | undefined {
  if (policy.retries === 0 && policy.timeoutMs === undefined) return undefined;
  return policy;
}

const CURRENT = (policy: NodePolicy | undefined): NodePolicy => ({
  retries: policy?.retries ?? 0,
  backoffMs: policy?.backoffMs ?? 500,
  ...(policy?.timeoutMs === undefined ? {} : { timeoutMs: policy.timeoutMs }),
});

export function PolicyForm({
  policy,
  onChange,
}: {
  policy: NodePolicy | undefined;
  onChange: (policy: NodePolicy | undefined) => void;
}) {
  const current = CURRENT(policy);
  const set = (patch: Partial<NodePolicy>) =>
    onChange(normalise({ ...current, ...patch }));

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="eyebrow">Retry and timeout</h3>
        {policy !== undefined && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-muted hover:text-ink ml-auto text-2xs font-semibold underline decoration-dotted"
          >
            Reset
          </button>
        )}
      </div>

      <Labelled
        label="Retries"
        hint="Extra attempts if this node fails. A bad configuration is never retried — only a failure that might not happen again."
      >
        <Select
          value={String(current.retries)}
          onChange={(event) => set({ retries: Number(event.target.value) })}
        >
          <option value="0">None — run once</option>
          {Array.from({ length: MAX_RETRIES }, (_, index) => index + 1).map((n) => (
            <option key={n} value={String(n)}>
              {n} {n === 1 ? "retry" : "retries"}
            </option>
          ))}
        </Select>
      </Labelled>

      {/* Only meaningful once there is a retry to wait before. */}
      {current.retries > 0 && (
        <Labelled
          label="Backoff"
          hint={`Milliseconds before the first retry. Doubles each time, up to ${MAX_BACKOFF_MS.toLocaleString("en-GB")} ms.`}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_BACKOFF_MS}
            step={100}
            value={current.backoffMs}
            onChange={(event) =>
              set({
                backoffMs: clamp(Number(event.target.value), 0, MAX_BACKOFF_MS, 500),
              })
            }
          />
        </Labelled>
      )}

      <Labelled
        label="Timeout"
        hint={
          <>
            Milliseconds one attempt may take. Leave empty for no limit of its own — the
            run&rsquo;s own deadline still applies.
          </>
        }
      >
        <Input
          type="number"
          inputMode="numeric"
          min={MIN_TIMEOUT_MS}
          max={MAX_TIMEOUT_MS}
          step={1000}
          placeholder="No limit"
          value={current.timeoutMs ?? ""}
          onChange={(event) => {
            const raw = event.target.value.trim();
            if (raw === "") {
              // Rebuilt rather than patched: `{ timeoutMs: undefined }` spread over the
              // current policy leaves the key present with an undefined value, which
              // `bridge.ts` would then write into the graph as a difference.
              onChange(normalise({ retries: current.retries, backoffMs: current.backoffMs }));
              return;
            }
            set({ timeoutMs: clamp(Number(raw), MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS) });
          }}
        />
      </Labelled>

      {current.retries > 0 && (
        <p className="text-muted text-2xs leading-relaxed">
          Worst case: {current.retries + 1} attempts
          {current.timeoutMs === undefined
            ? ""
            : ` of up to ${current.timeoutMs.toLocaleString("en-GB")} ms`}
          , plus {totalBackoff(current).toLocaleString("en-GB")} ms waiting. The run&rsquo;s
          own 120-second deadline still cuts it off.
        </p>
      )}
    </section>
  );
}

/** Keeps a typed number inside the schema's range instead of failing at run time. */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * What the retries will actually cost in waiting, summed from the engine's own
 * `attemptDelayMs` rather than from a second copy of the doubling rule. A number shown to
 * the user that drifted from the number the engine uses would be worse than showing none.
 */
function totalBackoff(policy: NodePolicy): number {
  let total = 0;
  for (let retry = 1; retry <= policy.retries; retry += 1) {
    total += attemptDelayMs(policy, retry);
  }
  return total;
}
