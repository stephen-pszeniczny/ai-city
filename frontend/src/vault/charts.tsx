// Plain SVG charts for the Vault (no chart library).
import type { IncomeView } from "../api";
import { formatMonth, monthLines, stackSegments } from "./income";
import { formatCad } from "./sideWork";

const COLOURS: Record<string, string> = {
  main_job: "#e8c46a",
  extra: "#7fd8a4",
};
const PLATFORM_COLOURS = ["#8aa4ff", "#c58aff", "#ff9f7a"];

function colourFor(key: string, keys: string[]): string {
  if (COLOURS[key]) return COLOURS[key];
  const platforms = keys.filter((k) => !COLOURS[k]);
  return PLATFORM_COLOURS[platforms.indexOf(key) % PLATFORM_COLOURS.length] ?? "#8aa4ff";
}

/** Income by source, one stacked bar per month with its amounts listed under it (in the
 * bar colours), and a dashed goal line. */
export function StackedMonths({
  months,
  goalCents,
}: {
  months: IncomeView["months"];
  goalCents: number;
}) {
  const W = 600;
  const barArea = 156;
  const LINE = 12; // each month's amounts are listed under its label, one per line
  const maxLines = Math.max(0, ...months.map((m) => monthLines(m.by_source).length));
  const H = barArea + 24 + maxLines * LINE;
  const scale = Math.max(goalCents, ...months.map((m) => m.total_cents), 1) * 1.08;
  const slot = W / months.length;
  const keys = [...new Set(months.flatMap((m) => m.by_source.map((s) => s.key)))];
  const names = new Map(months.flatMap((m) => m.by_source.map((s) => [s.key, s.name] as const)));
  const goalY = barArea - (goalCents / scale) * barArea;

  return (
    <figure className="in-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Income for the last ${months.length} months against the goal`}
      >
        {months.map((m, i) => (
          <g key={m.month} transform={`translate(${i * slot + slot * 0.2}, 0)`}>
            {stackSegments(m.by_source, scale, barArea).map((seg) => (
              <rect
                key={seg.key}
                x={0}
                y={seg.y}
                width={slot * 0.6}
                height={Math.max(0, seg.h)}
                rx={3}
                fill={colourFor(seg.key, keys)}
              >
                <title>
                  {names.get(seg.key)}:{" "}
                  {formatCad(m.by_source.find((s) => s.key === seg.key)?.cents ?? 0)}
                </title>
              </rect>
            ))}
            <text x={slot * 0.3} y={barArea + 18} textAnchor="middle" className="in-chart__label">
              {formatMonth(m.month)}
            </text>
            {monthLines(m.by_source).map((line, j) => (
              <text
                key={line.key}
                x={slot * 0.3}
                y={barArea + 18 + (j + 1) * LINE}
                textAnchor="middle"
                className={line.total ? "in-chart__total" : "in-chart__amount"}
                fill={line.total ? undefined : colourFor(line.key, keys)}
              >
                {line.text}
              </text>
            ))}
          </g>
        ))}
        {goalCents > 0 && (
          <line x1={0} x2={W} y1={goalY} y2={goalY} className="in-chart__goal">
            <title>Goal {formatCad(goalCents)}</title>
          </line>
        )}
      </svg>
      <figcaption className="in-legend">
        {keys.map((k) => (
          <span key={k}>
            <i style={{ background: colourFor(k, keys) }} aria-hidden="true" />
            {names.get(k)}
          </span>
        ))}
        {months.some((m) => monthLines(m.by_source).some((l) => l.total)) && (
          <span>
            <i className="in-legend__total" aria-hidden="true" />
            Total
          </span>
        )}
        {goalCents > 0 && (
          <span>
            <i className="in-legend__goal" aria-hidden="true" />
            Goal
          </span>
        )}
      </figcaption>
    </figure>
  );
}
