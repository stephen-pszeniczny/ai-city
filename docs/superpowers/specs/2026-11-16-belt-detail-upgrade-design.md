# Belt detail upgrade: design

Date: 2026-11-16. Status: approved by Steve 2026-11-16.
Builds on `2026-11-15-3d-belt-scenes-design.md` (the 3D belt, levels and flights).

## Why

The 3D belt works, but it looks simple next to the references (Apple Weather/Health, Linear).
Steve wants it to feel alive and detailed: robots that visibly work like agents, desks with
personality, realistic rock, a station you walk into, and the same world in every view.
He'll look at the result and may ask to tone parts down, so every "how much" lives in one
settings file for the look.

## Goals

1. **Realistic asteroids**, the same in all three views (belt, building, screen): finer rock with
   craters, ridges, boulders and surface bumps. Small belt rocks get more varied, detailed shapes.
2. **New robot design**, one original character:
   - rounded capsule body, the whole robot tinted the asteroid's colour (green asteroid → green robot);
   - wide visor "eye" with an emissive glow in the building's colour;
   - short antenna with a blinking tip light;
   - sits on a swivel chair.
3. **Robots work like agents**: a loop of actions tied to what the screen shows: typing (keys move,
   values on screen change), switching tabs (reaches for the mouse, the screen changes), reading
   and nodding, sipping water, stretching, a gentle idle bob, occasionally spinning on the chair or
   waving. Clicking the robot makes it react (wave, or a spin); clicking the desk or screen opens
   the computer.
4. **Robots visible from the belt**, at their desks, partly hidden by the hologram and landmark.
5. **Bigger decks, smaller robots**: each asteroid's deck has more area; the robot is smaller relative
   to it. The building view pulls back so the whole desk and a good part of the deck show.
6. **Better view of the screen**: the camera sits higher and further to the side, and the screen tilts
   toward it, so most of the screen is visible past the robot's head.
7. **Detailed desks**: better keyboard (separate keys), mouse and mat, water glass, small plant, desk
   lamp, cable, and a **projector** that beams the under-construction hologram up into the air.
   The hologram and "UNDER CONSTRUCTION" float above the asteroid, not on the surface.
8. **One signature gadget per desk** so each asteroid stands apart (my proposals, easy to swap):
   - Opportunity Office: a mini radar scope with a sweeping line and pinging dots.
   - Flight School: a toy rocket that launches from a desk pad, loops around the asteroid and lands.
   - Post Office: a small mail drone that drops envelopes into an inbox tray.
   - Crew Quarters: a glowing photo frame that cycles soft colours, and a flower that opens and closes.
   - Shipyard: a tiny robot arm assembling a model ship.
   - Training Bay: a mini dumbbell rack; the robot does a few curls now and then.
   - Data Core: an orbiting cluster of glowing data crystals over a stack of books.
   - Mission Control: a small desk globe and a mission clock. The Vault: a stack of gold coins and a mini safe.
   Gadgets are visible from the belt and from other asteroids (Flight School's rocket can be seen
   looping from anywhere).
9. **Fix**: the under-construction sign's posts no longer face the camera; the sign is turned so its
   face reads from the building view.
10. **Station rebuilt as connected modules**: a central hub joins Mission Control (left) and the Vault
    (right) through two hallways.
    - **Vault hallway**: controls and windows, ending at a round vault door. On the first visit of
      each app session the robot walks over and opens it for you; after that it stays open until the
      app is reloaded. The robot's desk sits inside the vault, looking out of a large window.
    - **Mission Control hallway**: controls, windows, and a few screens along the way showing each
      asteroid's status (open-task count, new-lead count, "under construction"). No sensitive data on
      these screens: counts and status only, never amounts.
    - Consoles get more detail (keypads, switches, levers, dials, small gauge screens, blinking LEDs).
      Side-wall panels move: bar meters, level gauges, scrolling waveforms, status lights.
    - The window in front of each robot is larger (most of the front wall).
11. **Slower, deliberate flights** (about 3 s to an asteroid, about 6 s into the station):
    - Asteroid: a curved approach that circles in and settles behind the robot.
    - Mission Control / Vault: fly to the hub, through its hatch, then turn left or right and glide
      down the hallway to the robot (stopping at the vault door for its opening on the first visit).
    - Back retraces the path. Clicking or pressing Escape during a flight skips to the end. With
      reduced motion it still jumps, as today.
12. **Detailed screens**: each robot's screen shows plausible "agent at work" panels that change while
    it works: progress bars filling, logs scrolling, small charts, values updating, tab strip changing.
    Mission Control keeps its real open-task list as one of its tabs. Unbuilt buildings show a
    building-themed "setting up" screen (still clearly under construction).
13. **Earth**: more detail (generated, not an exact map): sharper continents, coastlines, clouds that
    drift, an atmosphere rim, and city lights clustered along coasts and rivers on the night side.
    A shooting star crosses the sky every 20 to 60 seconds.

## Non-goals

- Data sent between robots by rocket or shooting star: waits until the backend agents exist.
- Day/night mode, notification shuttle and ticker (separate Phase 1a work).
- Changes to the desktop screen (level 3) beyond the frame around it.

## Anti-goals (a failure even if it works)

- Dropping below smooth motion: idle stays at about 60 fps at 1440×900 on the belt and inside, with
  no frames over 33 ms (the session 4 baseline).
- Clutter that makes buildings harder to tell apart or click on the belt.
- Anything that looks like an existing brand, film or game character.
- Sensitive data on any screen in the station hallways or on the belt.

## Constraints

- Stack unchanged: React Three Fiber, Three.js, drei. No new libraries, no downloaded models or textures.
- Building names still come from settings; code uses IDs.
- Spec section 7 needs updating (robot design, clicking the robot, connected station modules,
  hallways and vault door, robots visible from the belt, holograms from a desk projector). Steve
  approves the wording.
- Tests only where logic can be wrong (spec section 10: no visual layout tests).

## Approaches considered

- **A. Upgrade the code-made look (chosen by Steve).** Everything stays generated in code with much
  finer detail: craters, bump maps made at load, more geometry, animated parts. One consistent style,
  no assets to licence, easy to tune or tone down.
- **B. Ready-made 3D models and scanned textures.** Most photo-real rock, but large downloads,
  licence checks per asset, hard to adjust, and a style mismatch with the rest of the scene.

## How it's built (decided)

- **Look settings in one place** (`frontend/src/belt/look.ts`): detail level, animation intensity,
  robot action frequency, flight durations, shooting-star interval, glow strength. Toning down means
  changing numbers there.
- **One desk per asteroid, always present.** The desk, robot, projector and gadget live on each
  asteroid's spinning deck permanently, so every view shows the same thing. When far from the camera
  each switches to a lighter version (fewer pieces, no small parts, simpler animation) to keep the
  frame rate. Same for the station interior: built once, shown when the camera is inside or near.
- **Robot behaviour** is a small scheduler, not a fixed loop (Steve): when an action ends, the next
  one is picked at random (weighted, so typing is still the most common), never the same action
  twice in a row, with randomised durations; clicking queues a reaction. The screen listens to the current action
  (typing → values change, tab switch → new tab). Each robot starts at a different point so they
  aren't in sync.
- **Flights become paths**: a list of waypoints (position, look-at point, time) eased along a curve,
  instead of one straight line. Station flights include the hub hatch and hallway waypoints.
- **Vault door state** lives in memory for the app session (not saved): first visit opens it with
  the robot; later visits find it open; a reload resets it.
- **Hallway status screens** reuse the badge data the belt labels already use.
- **Earth and rock textures** are generated at higher resolution and cached for the session, as today.

## Left to the builder

Exact shapes, colours within each tint, action timings, waypoint positions, which details drop out
at distance, and the wording of fake "agent work" lines on screens (generic, never personal).

## Order of work and checks

1. Look settings + new robot (design, actions, click reaction, screen tie-in).
2. Asteroid desks: bigger deck, desk detail, gadgets, projector and floating hologram, sign fix,
   always present with a far version, new camera angle.
3. Asteroid and small-rock realism.
4. Station: hub, hallways, vault door, consoles, moving wall panels, bigger windows, hallway screens.
5. Flight paths (slower, through the hub and hallways, skippable).
6. Earth detail and shooting stars.
7. Session check: every goal above verified live with screenshots, frame-rate run per level,
   reduced motion on and off, full test suite, lint, types, build, gitleaks, blocked words.

Each step ends with the app running locally so Steve can look (http://127.0.0.1:5173) and ask to
tone things down before the next step builds on it.
