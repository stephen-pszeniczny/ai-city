// Places a day's blocks on the check-in's mini timeline (06:00 at the top, midnight at
// the bottom), as CSS percentages. Pure, so it's tested on its own.

const DAY_START = 6 * 60;
const DAY_END = 24 * 60;

export type Segment = { kind: string; top: string; height: string; label: string };

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function pct(share: number): string {
  return `${Number((share * 100).toFixed(2))}%`;
}

export function timelineSegments(
  blocks: readonly { start: string; end: string; kind: string; title: string }[],
): Segment[] {
  const span = DAY_END - DAY_START;
  return blocks.flatMap((b) => {
    const from = Math.max(minutes(b.start), DAY_START);
    const to = Math.min(minutes(b.end), DAY_END);
    if (to <= from) return [];
    return [
      {
        kind: b.kind,
        top: pct((from - DAY_START) / span),
        height: pct((to - from) / span),
        label: `${b.title} ${b.start}–${b.end}`,
      },
    ];
  });
}
