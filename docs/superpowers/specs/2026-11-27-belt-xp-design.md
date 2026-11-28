# Belt XP: progression design

Date: 2026-11-27. Status: approved by the owner (2026-11-27).

## Intent

Give the owner a reason to open the belt every day and **see** it grow. Each building earns XP from real results recorded in the app and levels from 1 to 100. Every 10 levels the building visibly upgrades in the 3D scene. All buildings' XP adds up to one **Belt XP** level.

Success: the belt changes visibly over months, a level-up is a small treat worth opening the app for, and reaching level 100 takes about a year of steady use.

## Goals

- XP per building from real results already stored in the app.
- Levels 1–100 per building. Each level shows a small "+1" pop on the bar. Every 10th level (10, 20 … 100) is an **upgrade**.
- An upgrade changes the building in the scene in a way that is noticeable from the belt view, not just up close.
- Upgrades are shown with a **level-up moment**: the next time the owner opens that building, a cargo shuttle docks, the robot cheers and the new piece builds itself in place.
- **Belt XP**: one overall level, 1–100, worked out from all buildings' combined XP.
- About a year from level 1 to level 100 at a normal pace. Early levels come faster and later ones slower.

## Non-goals

- **No currency.** There is nothing to spend, save or buy. (Stars, the earlier idea, are dropped.)
- No real-money rewards and no screen-time items.
- No choosing between upgrades. Every upgrade is fixed in advance.
- No streaks, missions, quests or daily goals.

## Anti-goals (failures even if it works)

- **Punishing rest.** XP never decays, levels never drop for inactivity, nothing rusts, wilts or turns red. A quiet week just means no growth. This follows the spec's recovery-first rule and Flight School's "reports only; nothing nags".
- **Rewarding busywork.** Daily caps stop the owner farming XP with trivial to-dos.
- **Too easy.** The owner explicitly does not want everything maxed quickly.
- **Leaking sensitive data.** XP and levels are counts. No money amounts, task titles or career details appear in XP displays or on the belt. The Vault and Opportunity Office levels can show without Touch ID because they reveal only a level and a bar, the same rule as their counts-only badges.
- **Blocking the work view.** Growth pieces must not cover the robot, its desk or the screen in the building view, or the click targets on the belt.

## What earns XP

Only buildings that are built earn XP. Unbuilt asteroids show "Under construction" where their bar would be and start earning when their building ships. Flight School starts earning when its screens ship, the same moment its landmark appears.

Starting values (all tunable in a settings file):

| Building | Event | XP | Cap |
|---|---|---|---|
| Mission Control | to-do completed | 10 | 5 per day |
| | gym block marked Done | 15 | — |
| | routine fully ticked for a day | 5 | per routine per day |
| | Sunday check-in finished | 40 | once per week |
| The Vault | side-work entry added | 10 | — |
| | pay confirmed (statement match or hand-checked) | 15 | — |
| | statement imported | 40 | once per month |
| Opportunity Office | platform check ("Nothing new" or "Found something") | 10 | 3 per day |
| | project logged | 15 | — |
| | project moves a stage | 20 | — |
| | platform profile refreshed | 20 | once per platform per month |
| Flight School | month logged | 60 | once per month |
| | competency example approved | 25 | — |
| | study time | 1 per 5 min | 60 min per day |

Tables that already hold these events include `tasks`/`task_history`, `plan_weeks.checked_in_at`, `plan_blocks` (gym `done`), `routine_ticks`, `side_work_entries`, `main_job_pay`/`main_job_payments`, `statement_imports`, `platform_checks`, `platform_profiles`, `platform_status_events`, `job_projects`, `fs_months`, `fs_examples` and `fs_study`. Tasks and their history are never deleted.

**Past work counts.** History already in the database earns XP the first time Belt XP runs. The app holds only a few weeks of history, so the belt opens at a low level, not near the top.

**Undo is not punishment.** If the owner reopens a to-do, un-marks a gym block, or deletes or edits a record (side-work entry, typed pay, logged project and so on), XP follows the record as it now stands, because that's a correction rather than inactivity. Levels shown never go below an upgrade already celebrated (see "Level-up moment"). This keeps the on-the-fly design possible, with no ledger. *(Builder's-check call.)*

**Build order:** Belt XP is built before Flight School's screens (spec section 9: it is the next project after the computer overhaul). Flight School's XP rules, growth stages and Sample history are written and tested now, but switched off until those screens ship.

## Level curve

- Each building has its own XP scale, so every building reaches level 100 in about a year at its normal pace. Mission Control earns almost daily while the Vault earns mostly monthly. With one shared curve, Mission Control would max out while the Vault sat near the bottom.
- The curve gets steeper with level. Targets at a normal pace: first upgrade (level 10) in about 2–3 weeks, level 100 in about 12 months, roughly one upgrade every 5 weeks on average.
- "Normal pace" per building is an estimate in the settings file (for example, about 3 to-dos a day, 4 gym blocks a week, every Sunday check-in, one statement a month). The builder sets the formula and checks it against those targets with a test.
- **Belt level** (1–100) = the sum of all nine buildings' levels ÷ 9, with unbuilt buildings counting as 0 (the owner's choice, 2026-11-27). It can never go down (a correction can't pull it below the level already shown; its bar just waits), it reaches 100 only when all nine buildings are at 100, and shipping a new building adds to it. Example: three buildings at level 100 make Belt level 33. The bubble shows Belt level, a bar toward the next Belt level (from the sum of building levels), and **total XP** (the sum of all buildings' XP) as the always-climbing number. A Belt level of 0 (possible on the first day) shows as 1.

## How it looks

### Belt view: Belt XP bubble

A Liquid Glass bubble in the top-right corner holds Belt XP **and** the day / night / auto switch. It replaces today's separate "Sky: Auto" pill (`frontend/src/belt/SkyToggle.tsx`). The Sample | Personal switch stays beside it.

```
╭──────────────────────────────╮
│ BELT XP   Lv 7               │  ╭─────────────────╮
│ ███████░░░  1,840 / 2,400    │  │ Sample│Personal │
│ ☀ Day   ☾ Night   ◐ Auto     │  ╰─────────────────╯
╰──────────────────────────────╯
```

The day / night switch becomes three segments instead of a button that cycles. Behaviour is unchanged.

### Building view (level 2): building XP bar

When the owner is at a building (the robot-at-desk view, `/b/<id>`), a small glass panel shows that building's name, level and bar. It is **not** shown on the computer screen (`/b/<id>/screen`). This applies to the asteroids and to both station control rooms.

```
╭────────────────────────────────╮
│ OPPORTUNITY OFFICE   Lv 24     │
│ ████░░░░░░  310 / 780 XP       │
╰────────────────────────────────╯
```

### Growth in the scene (approach A)

- **Shared growth kit.** One set of add-on pieces used on every asteroid, tinted in that asteroid's colour: solar wings, domes, antennas, lights, drones, shuttle traffic.
- **Each upgrade (every 10 levels) adds kit pieces** in a fixed order per building, so 10 upgrade stages in all.
- **The landmark grows** through 4 stages. Stage 1 is today's landmark and shows from level 1, as soon as the building is built (spec section 7). It grows at levels 30, 60 and 100 (stages 2–4), and those are the biggest visible jumps. The other upgrades add kit pieces only. *(Builder's-check call: an earlier draft hid the landmark until level 10, which would have broken the spec.)*
- **Scope now:** growth stages are built only for buildings that are built (Mission Control, the Vault, Opportunity Office) plus Flight School, whose stages switch on when its screens ship. Each later building brings its own landmark stages in the phase that builds it.
- **Asteroids change shape, not just props** (the owner asked for bigger asteroid upgrades and left the design to Claude). The kit includes changes to the asteroid itself: the deck grows outward in rings, domes are built into craters, glowing mineral seams get mined into the rock, outrigger arms and walkway bridges reach out, and a small captured moonlet orbits near the top.
- **Station modules** (Mission Control and the Vault) have no landmark. Their upgrades add kit pieces to the outside of their module (panels, lights, antennas, a window ring) and can add small touches inside their control room.

**Upgrade ladders** (approved 2026-11-27; ★ = big jump; every piece tinted in the building's colour; for the modules most pieces go outside so they show from the belt):

| Lv | Mission Control (module) | The Vault (module) | Opportunity Office (radar dish) | Flight School (hologram ship) |
|---|---|---|---|---|
| 10 | hull running lights | gold trim lights | deck edge lights; a crater lit in the tint | runway lights along the deck |
| 20 | extra antenna | armoured hull plates | deck grows a second ring | deck grows a runway strip out past the asteroid's edge |
| ★30 | comms dish on the roof | gold-rimmed dome | dish grows, signal rings pulse | hologram turns into a solid small ship |
| 40 | solar wings | solar wings | habitat dome built into a crater, windows glowing | hangar dome built into the rock |
| 50 | more wall screens inside | more lit deposit boxes inside | mining rig cuts glowing seams into the rock | launch tower; second toy rocket on the desk |
| ★60 | ring of windows around the module | secure dock + armoured cargo shuttle | three linked dishes on raised towers | bigger ship, engines glowing |
| 70 | docking port + parked shuttle | gold display shelf inside | outrigger arm with landing pad + parked shuttle | fuel tank farm and gantry arm |
| 80 | small satellite orbits the module | security drones on patrol | two-level deck with lit walkway bridges | two-level deck with a control tower |
| 90 | hologram belt map table inside | gold finish on the vault door | captured moonlet orbits, with a relay on it | captured moonlet; training drones fly laps around it |
| ★100 | beacon tower that lights up the station hub | gold beacon ring around the module | deep-space array beaming to the station | the ship launches now and then and loops the belt |

**Asteroids may grow slightly in size** as additions need more room (the owner, 2026-11-27): a gentle scale-up at upgrades, to about 1.3× by level 100. Use it only where the pieces would otherwise look crowded; if an asteroid looks in proportion without growing, it stays its size. Growth must keep the orbital ring readable (no overlaps with neighbours or the station, all on the same plane) and keep the building-view camera framing and flight paths working.

The builder may adjust pieces for fit (camera clearance, performance) but keeps each row's size of change: ★ rows are the biggest jumps, and asteroid rows change the asteroid's shape.

- Everything about how much glow and motion the growth pieces use lives in the look-settings file (`frontend/src/belt/look.ts`).
- Growth state has to stay the same across reloads (no random placement that changes between visits).

### Level-up moment

- Ordinary level: a "+1" pop on the bar the next time that bar is shown.
- Upgrade: the next time the owner opens that building, a cargo shuttle docks, the robot cheers (a new robot action) and the new piece builds itself in place. Then the bar resets toward the next level. A click or Escape skips it, and reduced motion skips straight to the end state.
- At the Vault, the moment plays after Touch ID and after the first-visit door greeting, once the robot is at its desk. *(Builder's-check call.)*
- Each upgrade plays once. The app remembers the last upgrade celebrated per building, per mode. Several upgrades waiting at once play as one moment that ends at the newest stage.
- Until it is celebrated, a waiting upgrade does not appear in the scene, so the owner sees it arrive. The Belt XP bubble may show a small marker on the building's label or badge saying an upgrade is waiting. This is the builder's call on style, but counts and markers only.

## Approaches considered

- **A. Shared growth kit plus a landmark that grows. Chosen.** It is much less 3D work, and the landmark keeps each asteroid recognisable. A new building needs only its landmark's 4 stages.
- **B. Every stage hand-made for every building.** The richest look, but 10 stages × 9 buildings is far too much work, and each new building would wait on its stages.
- **C. Generated growth.** Almost no art work, but it is hard to make look intentional and risks layouts shifting between reloads.

Earlier directions also dropped: an upgrade tree with a Stars currency (the owner chose no currency), and missions with a star map (too much like homework, and it blurs habits and goals).

## Constraints

- Local only, SQLite, Personal and Sample modes kept separate. Sample mode gets its own generated history, so it shows a believable mid-level belt for screenshots.
- Building IDs stay generic in code. Display names come from settings.
- No new money spend, no network calls, no AI.
- Tests where a wrong answer hurts: XP totals, caps, level maths, undo, backfill and "upgrade plays once".
- Performance: growth pieces follow the existing far-detail rules (`frontend/src/belt/lod.ts`) and the scene hold behind the computer screen.

## Left to the builder

- Whether XP is worked out on the fly from existing tables (preferred: nothing to keep in sync, backfill and undo come free) or kept in a ledger. Either way, only a small "last upgrade celebrated" record per building and mode is new state.
- The exact curve formula and per-building scale, tested against the pace targets above.
- The settings file's location and format, following existing settings patterns.
- How each ladder piece is modelled, keeping each asteroid recognisable and the work view clear.
- How the cheer action, the shuttle and the build-in animation look, using the existing shuttle and robot code where possible.
- How the work is split into PRs.

## As built

Where the build differs from, or settles, the design above (2026-11-27):

- XP is worked out on the fly. Besides the "seen and celebrated" record, three small record tables were added for events the existing ones didn't keep for good: fully ticked routine days, profile refreshes and project status changes.
- The values are in `src/aicity/xp_rules.py`.
- Reading XP never writes. The one-time backfill of routine days finished before Belt XP runs when the app starts.
- A profile refresh counts once per platform per local calendar month, going by when it was recorded, so correcting or switching the date earns nothing more.
- Archiving a finished to-do and rejecting a project keep the XP already earned.
- The Opportunity Office dish stands on its own platform out past the deck, clear of the desk.
- A level-up shows a card naming the new upgrade.
- "After Touch ID" at the Vault, in Personal mode: Touch ID is only asked on the Vault's computer screen, so the Vault's level-up moment plays only after the owner has unlocked the computer and gone back to the room view. Leaving during the moment counts it as seen. This is the approved design.
- Sample mode adds a fixed, made-up head start to each earning building (never stored) so it opens as a grown belt, with one upgrade waiting. Flight School's made-up Sample history is not written yet; it comes when Flight School is switched on.
