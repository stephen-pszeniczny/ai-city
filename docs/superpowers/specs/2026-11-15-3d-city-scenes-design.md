# 3D city scenes: design

Status: **approved in conversation 2026-11-15** (city → building → screen zoom, control stations
for the two station modules, asteroid desks for the other seven, desktop-computer screen with the
monitor 10% bigger than the first prototype). Builder's calls are marked *(call)*.

## Why

The home screen is meant to be opened every day (spec section 1). The cinematic 3D station preview
is what makes it a place rather than a list. Each building should feel like somewhere you go: you
click it, fly in, find its robot at work, and lean into the robot's screen to do the actual work.

## Goals

- **Level 1, the city:** the station preview, rebuilt inside the app. Central station with City
  Hall and Finance District as two modules; seven asteroids on a flat ring with the debris belt
  between them; Earth, sun, stars, nebulae. Drag to rotate, scroll to zoom. Every building and
  its label is clickable and shows a live badge.
- **Under construction:** an asteroid whose building isn't built yet shows its tint, mining rigs,
  scaffolding and an "under construction" sign (amber and black hazard stripes), readable from
  the city view. The same sign stands beside its robot's desk at level 2, and its screen shows the
  "under construction" desktop. When a building is finished, its sign comes down and its landmark
  appears. Today only City Hall is built, so all seven asteroids show the sign.
- **Level 2, the building:** clicking a building or its label quickly pans and zooms into it.
  - *Asteroids (7):* the robot sits at a desk on the asteroid's surface, working at one
    computer, with open space behind. Robot and desk take the asteroid's tint.
  - *City Hall and Finance District:* each robot works in its own control station in its half of
    the central station: a desk, a large screen, a rocket-style control panel below it (keypad,
    buttons, levers), and behind them a large window onto space where the asteroids and the belt
    drift past as they orbit.
  - The robot's screen shows the building's live content (City Hall: the to-do list).
- **Level 3, the screen:** clicking the robot, desk or computer zooms into the screen. It becomes
  a desktop computer, as in the approved prototype (`spike/desktop-screen` branch): bezel and chin,
  menu bar (robot logo, building name, Sample tag, clock), the building's apps in a dock, each app
  in a window that scrolls on its own. A sliver of the station (wall panels, window, control-panel
  edge) or of the asteroid shows around the monitor. Monitor is 10% bigger than the first cut.
- Space behind levels 2 and 3 turns slowly, as if the station or asteroid is spinning.
- Back goes out one level at a time (button and Escape key).

## Non-goals (this project)

- New building features. Only City Hall's to-do list is real; other apps and buildings show an
  "under construction" desktop.
- The Personal/Sample switch itself (session 4). The scenes show the current mode; the switch
  control is added there.
- Phone layouts for the 3D scenes (phone access is phase 2 and to-do/gym only).

## Anti-goals (a failure even if it works)

- Text on the screen that's blurry or can't be typed into.
- A scene so heavy the Mac's fans spin up while it sits open all day.
- Losing unsaved edits by zooming out.
- Anything copied from an existing film, game or brand; the robot is original and not Anthropic's
  logo or branding.
- Real data in any screenshot (Sample mode only, spec section 7).

## Approaches considered

1. **Real 3D in the app with the live screen placed on the 3D monitor (chosen).** React Three
   Fiber (already installed) for all three levels and the camera flights. At level 2 the real
   to-do page is placed on the monitor surface (drei `Html` with `transform`); at level 3 a flat
   desktop screen takes over, framed by the bezel, so text is sharp and typing works normally.
2. Draw the list as an image on the monitor. Simpler, but blurry up close and no typing. Dropped.
3. Pre-made 2D illustrations with zoom effects. Loses the interactive 3D. Dropped.

## Design

**Structure** *(call)*
- `frontend/src/city/`: the canvas and city (level 1), `space/` (stars, Milky Way, nebulae,
  Earth, sun, belt, debris; shared by every level), station, asteroids, landmarks,
  under-construction rigs and sign, and the glass labels with badges.
- `frontend/src/interior/`: `ControlStation` (City Hall, Finance), `AsteroidDesk` (the seven),
  `Robot` (one original model, recoloured by tint), `Monitor` (bezel + live screen).
- `frontend/src/desktop/`: `Desktop` (menu bar, dock, windows) and the app registry (City Hall:
  To-do real; Daily plan, Weekly review, Projects "later"; other buildings: under construction).
- One `<Canvas>` for the whole app; the camera flies between levels instead of switching pages,
  so zooms are continuous. The current level and building live in the URL (`/`, `/b/planner`,
  `/b/planner/screen`), so Back in the browser and reloads work. *(call)*

**Camera flights** *(call)*: about 1.2 s with ease-in-out. City → building: fly to a fixed
viewpoint in front of the robot's desk. Building → screen: fly until the monitor fills the view,
then swap in the flat desktop (same size and position, so the swap is invisible). Reduced motion:
short cross-fades instead of flights.

**Rotating space:** levels 2 and 3 reuse the city's space scene from a camera inside the station
(control stations) or on the asteroid (desks). The sky turns slowly and the asteroids and belt
orbit, about 40 s for an asteroid to cross the control-station window (as in the prototype).

**Robot** *(call)*: one original, friendly low-poly robot built from simple shapes (rounded body,
screen-face with two eyes, antenna), seated, typing with a small idle loop (head tilt, blink,
typing hands). Tint from the building.

**Building names and badges:** a new read-only route `GET /api/buildings` returns the nine IDs
with display names from the settings file. Badges come from real data where it exists (City Hall:
overdue and stale counts from the tasks API) and are hidden otherwise. No made-up badge numbers
in Personal mode. *(call)*

**Performance** *(call)*: render on demand when nothing moves is not possible (space always
turns), so cap at 60 fps, pause rendering when the window is hidden, half resolution for the
bloom pass, build the procedural Earth once and cache its textures for the session. Target: idle
CPU low enough that the fans stay quiet on the M5.

**Unsaved edits:** zooming out of the screen asks first if the open task has unsaved changes,
using the same check as the to-do panel's Back button.

**Accessibility:** every clickable building and the robot are also real buttons in a visually
hidden list, so keyboard and screen-reader users can move between levels. Focus moves to the
screen's window when level 3 opens.

**Testing:** logic gets unit tests (Node's built-in runner): the level/URL state machine, the app
registry, badge counts from tasks. The backend route gets pytest tests and joins the GET read-only
test. No visual layout tests (spec section 10); scenes are checked live with Playwright
screenshots in Sample mode, with frame-time measured while idle.

## Build order (each a separate step with its own scorecard)

1. `GET /api/buildings` route + tests.
2. Space scene shared module (port from the prototype) + performance limits.
3. Level 1: station, asteroids (landmark if built, otherwise rigs, scaffolding and the
   under-construction sign), labels with names and badges, drag/zoom.
4. Level state machine + URL + camera flights + Back/Escape.
5. Robot model.
6. Control station (City Hall, Finance) with window view.
7. Asteroid desk scene (shared by the seven, tinted).
8. Monitor with the live screen at level 2; flat desktop at level 3 (prototype look, 10% bigger).
9. Session check: live click-through, idle performance, all checks.

Day/night, the notification shuttle and ticker stay in Phase 1a's list and follow after this.

## Left to the builder

Exact shapes and proportions of the robot, desk and control panel; colours beyond each building's
tint; flight paths and timings; how much station shows around the monitor at level 3.
