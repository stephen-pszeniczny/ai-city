# Start at the belt, month totals under the bars, and a split income goal (design)

> Public file. Generic names only; real amounts and names live in the private settings.
> Requested by Steve 2026-11-19 after using the hand-entered pay build. Three small changes.

## 1. Every fresh open starts at the belt

**Why:** quitting and reopening the Dock app brings back the last place (a building or its
computer) instead of the belt.

**Today:** the place lives in the page address (`/b/<building>` or `/b/<building>/screen`),
and the Dock app reopens the last address.

**Change:** when the page first loads at a building or screen address, it replaces the
address with the belt (`/`) before anything flies. Back and forward inside a session work as
now. `/todo` (its own page) is unchanged.

**Approaches:** (a) redirect to the belt on first load (chosen: one line of routing, keeps
Back/forward and the ticker's "open task" journeys); (b) stop putting the place in the
address (rejected: loses Back/forward); (c) a Safari setting (rejected: not ours to control).

## 2. Amounts under each month's bar

**Why:** to read each source's total for a month without hovering.

**Change:** under each month label in the "Last 6 months" chart, one line per source that
month, in the source's bar colour, whole dollars (`$5,000`), in the same order as the stack
(bottom first). Sources with nothing that month aren't listed. The legend stays.

**Approaches:** one sensible way (text in the existing SVG). A table under the chart was
rejected: it repeats the legend and breaks the colour link.

## 3. Split income goal: main job and side income

**Why:** Steve wants to see which part of the month is short: main job toward $6,500,
side income toward $1,000, together the $7,500 goal (later raised toward $10,000).

**Decided (Steve, option A):** the chart keeps one goal line at the total. The "This month"
card shows two progress bars under the total: main job (gross) toward its goal, and side
income (all side work, platforms and other side income, gross) toward its goal.

**Settings:** two new optional keys under `[goals]`: `main_job_monthly` and
`side_income_monthly` (money text like `monthly_income`). When both are set, the total goal
is their sum and `monthly_income` may be left out; when they're absent, everything works as
today (one bar, no split). Setting `monthly_income` as well as both new keys with a different
total is refused with a clear message. Steve's private file gets `6500.00` and `1000.00`.
Sample mode gets its own invented split.

**Approaches:** (A, chosen) one total line + two bars; (B) two dashed lines on the chart
(rejected by Steve: hard to read against stacked bars).

## Constraints

Integer cents; GET routes never write; Sample never reads private settings; no real names
or amounts in tracked files; the employer contributions still never count toward any goal.

## Left to the builder

Exact bar styling and spacing; the API field names for the split.
