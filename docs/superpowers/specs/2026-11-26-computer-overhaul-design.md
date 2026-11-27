# Computer overhaul: one modern computer and design kit for every desk (design)

> Public file. Example values only (made-up numbers in any screenshot or test).

## Why

Every building's desk computer should feel like a real, modern computer and look like one
product. Today one shared frame (`frontend/src/desktop/Desktop.tsx`: bezel, menu bar, bottom
dock, windows) hosts apps that each style themselves (`todo.css`, `plan.css`, `vault.css`,
`jobs.css`), so spacing and look drift, and the Daily plan and Sunday check-in still use
blocks of text. The owner also wants the desks to feel tied to each building's work.

## Goals

1. **A realistic, modern Mac-style all-in-one** for every desk: thin dark screen border,
   aluminium chin and stand, no Apple logo or name. The level-3 screen fills more of the view
   (spec: 10–15 % larger).
2. **Screen layout:** a menu bar (building name, Sample chip, clock); one frosted-glass window.
   Its left side lists the building's apps, each as its own **glass rectangle** with icon and
   name; the open app glows blue and has a **thin blue line** at its left edge. Clicking switches
   apps with a quick slide-and-fade (about 150 ms; instant with Reduce Motion). No bottom dock.
3. **One design kit for all apps:** shared glass button, tile, chip, section, list row, progress
   bar and form field; one set of colour (blue, grey, black), radius and spacing values. Every
   app uses only the kit. **No large blocks of text anywhere**: the Daily plan and Sunday check-in
   are reworked into tiles, chips and short labels.
4. **Desktop background:** a generic Mac-style abstract gradient, original (not Apple's
   wallpapers), **tinted with the building's colour** (Vault gold, Opportunity Office cyan,
   Flight School violet, Mission Control blue-white); the window glow uses the same tint.
5. **The robot's own monitor shows its building's real work** (the view before the screen is
   opened), instead of today's generic log lines: counts, rings and bars only, never names or
   amounts, so nothing sensitive shows without Touch ID. Examples: Mission Control "3 due today"
   with a progress ring; Vault a goal bar; Opportunity Office "2 platforms to check" with a radar
   sweep; Flight School competencies ready. Unbuilt buildings keep the construction screen.
6. **Lighter background while at a computer:** robots and Earth hold still, asteroids keep
   orbiting, and anything out of view stops animating. Away from the computer, everything
   animates as now; the robots keep "working" until the screen is opened.

## Non-goals (now)

- Desk props that react to data (coin stack, sticky notes, trophy shelf): **later**.
- Screensavers.
- New app features; this is look, layout and speed only.
- Phone layout (Phase 2).

## Anti-goals

- Apple's logo, name or wallpapers; a copy of any real product's screens.
- Any paragraph-style text block; cramped or uneven spacing between modules.
- Sensitive values (amounts, names, titles) on the robot's monitor or in tints/badges.
- A slower frame rate at the computer than today.

## Constraints

- Stack stays React + TypeScript + React Three Fiber; no new UI library.
- Liquid Glass only where it reads well (spec section 7); contrast and Reduce Motion respected.
- Robot-monitor data comes from existing counts-only endpoints (badges, check-in status, etc.)
  that need no Touch ID; locked buildings show counts only.
- No visual layout tests (spec section 10); pure helpers (layout, tint, animation choice) tested.

## Approaches considered

- **A. Shared design kit, then move each app onto it (chosen).** Build the frame, kit, pausing,
  robot monitors and tints first; then rework each building's apps onto the kit, one building per
  PR. Truly consistent; future buildings (Flight School's screens) start on the kit.
- B. Restyle on top of each app's own CSS: faster at first, but the drift stays and returns.
- C. A third-party component library: a new dependency, generic look, fights the custom glass.

## Design

### PRs

1. **Frame and kit:** the new computer body and screen, left glass tab list with blue line and
   transition, desktop background with building tint, the design kit (tokens + components),
   background pausing at the computer, robot-monitor live views.
2. **Mission Control apps on the kit:** To-do, Daily plan, Sunday check-in, Grocery list,
   with the Daily plan and check-in redesigned without text blocks.
3. **The Vault apps on the kit:** Income, Side work, Statements.
4. **Opportunity Office apps on the kit:** Platforms, Log.
   Flight School's screens are then built directly on the kit.

### Background pausing (Claude's call on the mechanism)

A single "at the computer" flag (already known from the route `/b/<id>/screen`) is read by the
animated pieces (`Robot.tsx`, `Gadget.tsx`, `DeskProps.tsx`, `WallPanels.tsx`, `Console.tsx`,
Earth/sky): they skip their per-frame work while it's set, except the asteroid orbit. Objects
outside the camera's view skip animation too. Measure frame time before and after.

### Robot monitor

`workScreen.ts` today builds tabs and log lines per building. It gains a per-building live view
fed by counts the page already fetches; the 3D monitor texture redraws only when a count
changes (not every frame).

## Left to the builder

- Exact colours, blur, radii, spacing scale, transition easing, and the gradient art.
- Icons per app (original glyphs).
- Frame-time measurement method and the target (no worse than today at the computer).
- The tint colours for buildings without one yet.
