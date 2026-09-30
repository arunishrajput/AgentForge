import { formatDayUtc } from "@/lib/format/date";
import type { DayBucket } from "@/lib/analytics";

/**
 * Runs over time — one stacked bar a day, drawn by hand in SVG.
 *
 * **No chart library, and that is a design decision rather than a saving.** Every one of
 * them draws a hairline axis, a blurred tooltip and a thin rounded bar, which is precisely
 * the material-elevation look `DESIGN.md` refuses; theming one back into Toybox is more
 * code than this, and it would be code fighting a default rather than expressing an
 * intention. Forty lines of `<rect>` carry the thick ink outline, the hard offset shadow
 * and the flat pop fills natively, and add nothing to the bundle.
 *
 * **Not a canvas, and not a client component.** It renders on the server, into the HTML,
 * so the chart is in the first paint with no hydration and no measurement pass — and it
 * is readable by a screen reader, because the table underneath it is the same data and
 * is what `role="img"`'s description points at.
 */
export function RunChart({ days }: { days: DayBucket[] }) {
  const peak = Math.max(1, ...days.map((day) => day.total));
  const total = days.reduce((sum, day) => sum + day.total, 0);

  // A viewBox with no fixed width: the SVG scales to its column and the bars keep their
  // proportions at 375 px and at 1920 px without a resize listener.
  const width = Math.max(days.length * 10, 100);
  const height = 72;
  const gap = days.length > 45 ? 1 : 2;
  const barWidth = Math.max(width / days.length - gap, 1);

  if (total === 0) {
    return (
      <p className="text-muted border-line bg-sunken rounded-xl border-2 border-dashed p-6 text-center text-sm">
        No runs in this window. Run a workflow and it appears here.
      </p>
    );
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="border-line bg-sunken h-24 w-full rounded-xl border-2"
        role="img"
        aria-label={`Runs per day over the last ${days.length} days. ${total} runs in total. The same figures are in the table below.`}
      >
        {days.map((day, index) => {
          const x = index * (barWidth + gap);
          // Stacked bottom-up in the order a person reads an outcome: what worked, what
          // was stopped, what broke. Failures sit at the top of the bar so a bad day is
          // recognisable by its silhouette and not only by its colour — DESIGN.md →
          // *Never colour alone*.
          const bands = [
            { name: "succeeded", count: day.succeeded, fill: "var(--color-ok-pop)" },
            { name: "other", count: day.other, fill: "var(--color-live-pop)" },
            { name: "cancelled", count: day.cancelled, fill: "var(--color-warn-pop)" },
            { name: "failed", count: day.failed, fill: "var(--color-bad-pop)" },
          ];

          let y = height;
          return (
            <g key={day.day}>
              {bands.map((band) => {
                if (band.count === 0) return null;
                const bandHeight = (band.count / peak) * (height - 2);
                y -= bandHeight;
                return (
                  <rect
                    key={band.name}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={bandHeight}
                    fill={band.fill}
                    stroke="var(--color-line)"
                    strokeWidth={0.5}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      <figcaption className="text-faint mt-1.5 flex justify-between text-[11px] font-semibold">
        <span>{formatDayUtc(days[0].day)}</span>
        <span>{formatDayUtc(days[days.length - 1].day)}</span>
      </figcaption>
    </figure>
  );
}
