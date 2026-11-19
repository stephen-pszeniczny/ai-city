# Income app layout tidy (design)

> Public file. Generic wording only; the main job's real name lives in the private settings.
> Requested by Steve 2026-11-19. A small change.

## Why

After a day of use, Steve wants the Vault computer to open on Income, the split goals gone
(no longer useful), the month card to show what each source actually made, and the four top
tiles tidier, with their big numbers lined up.

## Changes

1. **App order.** The Vault computer's dock reads Income, Side work, Statements, and Income is
   the app open when the computer is first opened.
2. **Split goals removed.** The main-job and side-income goals (and their two bars) go: the
   `[goals]` keys `main_job_monthly` / `side_income_monthly`, the `goal_split` field and the
   Sample split are removed. The total goal (`monthly_income`) and its bar stay. Steve's private
   file goes back to `monthly_income = "7500.00"` (the same total).
3. **Tile 1 ("This month, gross").** Under the goal bar, two plain rows, always shown:
   the main job's name with this month's main-job gross right-justified, and "Side income" with
   this month's side income right-justified. The name is the private settings' main-job name in
   Personal mode and "Main job" in Sample mode. Everything else in the tile stays.
4. **Short one-line titles** (Steve, revised): "Monthly Gross", "Monthly Net", "Annual Gross",
   "Tax Set Aside". The extra heading lines ("(after the tax set-aside)", "(N% of this year's
   side income)", the year) are dropped, so the large amounts sit right under the titles and line
   up across the four tiles without padding.
5. **Under the amounts, unchanged:** tile 1 the goal bar and the two rows; tile 2 the employer
   contributions line; tile 3 net, then "Main job $X" and on the next line "Side income $Y"
   (same naming rule as tile 1); tile 4 the **"placeholder" chip, moved under the amount** (the
   spec requires the placeholder percentage to stay clearly labelled until the accountant visit).

## Approaches

One sensible way: list order and CSS for 1, 4 and 5; for 2, removing the split entirely (rather
than leaving an unused setting) keeps the settings honest; for 3 the label is passed from the
server (`main_job_label`) so Sample never needs the private name.

## Constraints

No real names in tracked files; Sample never reads private settings; integer cents.

## Calls made by Claude (Steve can change)

The rows in tile 1 have no bars; the placeholder chip kept (spec requirement) under the amount.
Removing the split-goal settings entirely: approved by Steve.
