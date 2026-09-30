import { formatDuration } from "@/lib/format/duration";
import type { Totals } from "@/lib/analytics";

/**
 * The four figures at the top. A tile, not a gauge: the number is the thing, and the
 * label under it says what was counted rather than leaving a reader to infer it.
 *
 * **An unknown is an em dash, never a zero.** A workspace with nothing settled has no
 * success rate, and `summarise` returns null for it rather than 100% — printing a
 * perfect record on the first screen a new user sees is a fabricated number, and the one
 * they would remember.
 */
export function StatTiles({ totals }: { totals: Totals }) {
  const rate = totals.successRate;

  return (
    <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Runs" value={String(totals.runs)} note={`${totals.settled} settled`} />
      <Tile
        label="Success rate"
        value={rate === null ? "—" : `${Math.round(rate * 100)}%`}
        note={rate === null ? "nothing settled yet" : `${totals.succeeded} of ${totals.settled}`}
        /**
         * The threshold is 90%, and the tone is a *third* signal rather than the only
         * one: the number and its note both say the same thing without it. `DESIGN.md`
         * → *Never colour alone*.
         */
        tone={rate === null ? undefined : rate >= 0.9 ? "ok" : "bad"}
      />
      <Tile
        label="Failures"
        value={String(totals.failed)}
        note={totals.cancelled > 0 ? `${totals.cancelled} cancelled` : "in this window"}
        tone={totals.failed > 0 ? "bad" : undefined}
      />
      <Tile
        label="Median run"
        value={totals.medianMs === null ? "—" : formatDuration(totals.medianMs)}
        note={totals.p95Ms === null ? "no finished runs" : `p95 ${formatDuration(totals.p95Ms)}`}
      />
    </dl>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "ok" | "bad";
}) {
  return (
    <div className="card animate-rise p-3 sm:p-4">
      <dt className="eyebrow">{label}</dt>
      <dd className="m-0">
        <span
          className={`block text-2xl font-bold tracking-tight tabular-nums ${
            tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-ink"
          }`}
        >
          {value}
        </span>
        <span className="text-faint text-xs">{note}</span>
      </dd>
    </div>
  );
}
