# Income chart polish and a year-to-date tile (design)

> Public file. Generic wording only; no real amounts.
> Agreed with Steve 2026-11-19. A small change.

## Why

After using the month totals and goal split, Steve wants the chart easier to read at a glance,
a clear label on the net tile, and his income so far this year in one place.

## Changes

1. **Chart amounts smaller.** The coloured per-source amounts under each month's bar get a
   slightly smaller font (10 px → 9 px).
2. **Month total.** Under months with **two or more** sources, one more line after the coloured
   amounts: the month's total in white, in brackets, whole dollars, e.g. `($7,214)`. Months with
   one source don't repeat it (the single amount already is the total).
3. **Legend "Total" entry.** The legend gains a white entry "Total" (a white swatch), after the
   sources and before "Goal", matching the bracketed totals.
4. **Goal mark centred.** The legend's dashed goal mark sits at the middle of the text line, like
   a hyphen, not at the bottom like an underscore.
5. **Net tile label.** "Net (after the tax set-aside)" → "Net this month (after the tax set-aside)".
6. **Year-to-date tile.** A new tile "<year> so far" in the top row, between "Net this month" and
   "Tax set-aside" (both this-year figures then sit together):
   - **Gross** so far this calendar year (January 1 to today), large: the same rule as the month
     total (main-job gross, its net where gross isn't typed; plus all side income).
   - **Net** below: main-job net plus side income less its tax set-aside, as for the month.
   - **Main job · Side income** gross amounts on one line, as the month card splits them.
   - Employer contributions are not included (as everywhere).
   - Calendar year because Canada's tax year is the calendar year.

## Approaches

One sensible way for each: they extend the existing chart text, legend and tile row. The
year-to-date figures are worked out in `income_view` beside the month figures (one pass over
the same rows), not in the browser, so the rules for gross and net stay in one place.

## Constraints

Integer cents; GET never writes; employer contributions never in a total; Sample unchanged
apart from showing the same tile with its invented data.

## Calls made by Claude (Steve can change)

9 px for the smaller amounts; the tile's title format "2026 so far"; "Total" placed before "Goal".

## Left to the builder

API field names; exact spacing.
