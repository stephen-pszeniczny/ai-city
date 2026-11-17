# Station flights, room-to-room travel and the vault door greeting (design)

Date: 2026-11-17. Status: approved by Steve (spec section 7 updated to match). Asteroid flights stay exactly as they are (Steve likes them).

## Why
Steve is happy with the belt detail upgrade but found five rough edges in real use:
robots on asteroids lose their arms in some views; flights into Mission Control and the
Vault feel like cuts between scenes; flying out spins the camera around several times;
moving between the two station rooms means leaving the station; and the vault door swings
into the robot's desk, with a greeting that doesn't read well.

## Goals
1. Every robot always has both arms, in every view (belt, other asteroids, its own building).
2. Into the station: one smooth swoop: hatch → hub centre → turn → down the hallway → behind
   the robot. No visible stop-and-go between steps.
3. Out of the station: the same smoothness, no spinning.
4. Mission Control ↔ Vault directly: room → hallway → hub → hallway → room, without leaving.
5. The vault door hinges on the other edge, swings into the room away from the desk, folds flat
   against the side wall and never blocks the camera.
6. First Vault visit of an app session: the robot sits on a seat in the hallway beside the closed
   door. The camera stops short of the door. The robot gets up, slowly cracks the wheel, and the
   bolts slide back. The door swings open. The robot glides in, hops into its chair and starts
   working, while the camera swoops in to its usual spot behind it.
7. Later visits (until reload): the door is open, the hallway seat is empty and the robot is at its desk.

## Non-goals
- No change to asteroid flights, the screen zoom, or anything outside the station besides arms.
- No new buildings or features. The Touch ID lock on finance views comes later (separate step).

## Anti-goals (a failure even if it technically works)
- Any visible jerk, snap or spin of the camera during a station flight.
- The door or the robot passing through the desk, walls or camera.
- A greeting so long it's annoying: a click or Escape must still skip to the end.

## Approaches considered
- **A. One continuous curve per route (picked by Steve).** Each route is a single smooth
  curve through the station, flown at steady speed with one ease-in and one ease-out. The camera
  looks a little ahead along the curve, blending to the robot's screen near the end. The same
  machinery builds the in, out and room-to-room routes. Only the vault greeting pauses it.
- B. Tune the existing hops: less work, but kinks remain, and each new route needs its own patching.
- C. A hand-keyed animation per route: most control, but every layout change breaks it.

## Design
**Arms (goal 1).** The far-detail robot currently skips its arm meshes. Arms are drawn at
both detail levels (6 small meshes per robot; negligible cost).

**Flights (goals 2 to 4).**
- A route is a list of points along the station's centre lines (outside the hatch, hatch, hub
  centre, hallway entrance, hallway end, room spot behind the robot). They're joined into one
  smooth curve (rounded corners at the hub turn) and sampled by distance, so speed is steady.
- Timing: one ease-in at the start and one ease-out at the end, nothing in between.
- Facing: the camera looks at a point a short distance ahead on the curve, so it can never
  face backwards or spin. Over the last part it blends to the robot's screen.
- Out of the station: its own route built from the room outward, ending at the belt view the
  person left from. It's not the inbound route played backwards.
- Room to room: room → own hallway → hub centre (turning through it) → other hallway → other
  room. The first visit's door greeting plays here too.
- Durations live in `look.ts`: into the station about 6 s, out about 5 s, room to room about 5 s.
- Reduced motion jumps straight to the end, as now. A click or Escape skips to the end, as now.

**Room-to-room button (goal 4).** In each control room's building view, a Liquid Glass
button beside the Back button: "→ The Vault" in Mission Control, "→ Mission Control" in the
Vault. Names come from the settings file. The web address changes as with any building, so
reload and browser Back still work.

**Vault door (goal 5).** The hinge moves to the hallway's back (-z) edge. The door swings
into the room toward the back wall and rests flat against the side wall. The door shrinks
about 20% so it fits before the back wall and deposit boxes. It stays clear of the camera's
room spot. The checks: the door's open outline stays clear of the desk, the back wall and
the camera.

**Greeting (goals 6, 7).** A small seat sits in the hallway beside the door, on the side
away from the camera's path. The timeline, roughly 7 to 8 s, is in `stationLayout.ts`:
- The camera reaches its stop short of the door.
- The robot rises and turns to the wheel.
- It cracks the wheel slowly: a stiff start, then turning freer, with the bolts sliding back.
- The door swings open.
- The robot glides through the doorway to its chair, with a small hop up and a settle into
  the seat.
- Working resumes, while the camera swoops from the stop to its spot behind the robot.

The robot's hands follow the wheel rim while turning it. Opened straight into the Vault (a
reload or link), the greeting plays in place, as now. With reduced motion the door is simply
open and the robot is at its desk.

## Spec change (section 7, "Inside a building"), for Steve to approve
Replace the station flight sentences with:
> Station flights are one smooth, continuous swoop: in through the hub's hatch, through the
> hub, down that module's hallway to the robot, at a steady pace with no stops. Back flies
> out the same way just as smoothly. From either control room a button goes straight to the
> other room through the hallways and hub, without leaving the station. [Mission Control
> hallway sentence unchanged.] The Vault's hallway ends at a round vault door that opens into
> the room, away from the desk. On the first visit of each app session the robot waits on a
> seat in the hallway, slowly cracks the door's wheel, swings it open, then glides to its
> desk and hops into its chair as the camera follows. The door stays open and the robot stays
> at its desk until the app is reloaded.

## Left to the builder
The exact curve type and corner rounding, the look-ahead distance, the seat's model, the
greeting's exact timings (within about 7 to 8 s) and the door's final size and angle, as long
as the clearance checks pass.

## Changed while building (found in live checks, 2026-11-17)
- Hallways widened 1.9 → 2.3 (Steve's addition); the hub grew (radius 2.4 → 3.0) so its sides fit the openings.
- Out of the station: the flight in, played in reverse (backs out facing the room, hallway and
  station), 6 s instead of 5 s, so it never has to turn round outside.
- The approach comes in slightly off to one side so it clears the station's big outer ring (the old
  path flew through the ring's tube).
- The camera's door stop is further back (about 3.4 from the door) and the robot turns the wheel
  from the seat side, so the wheel and its hands stay in view.
- The open door lies flat against the wall away from the desk; its far end shows at the right edge
  of the Vault room view (unavoidable on that wall).
