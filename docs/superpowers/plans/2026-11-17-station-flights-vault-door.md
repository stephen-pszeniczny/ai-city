# Station Flights, Room-to-Room Travel and Vault Door Greeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Robots always have arms. Station flights (in, out, and room to room) are one smooth swoop. The vault door swings clear of the desk and camera. The first-visit greeting has the robot crack the door open from a hallway seat and hop into its chair.

**Architecture:** A new pure module `stationRoute.ts` builds each station route as one curve sampled by distance with a single ease and a look-ahead facing. It replaces the waypoint hops in `flightPath.ts`. A new pure module `vaultGreeting.ts` gives the door, wheel, bolts and robot pose for any second of the greeting. `VaultDoor.tsx` and `ControlStation.tsx` render from it. `CameraRig.tsx` flies routes. `App.tsx` adds the room-to-room button.

**Tech Stack:** React + TypeScript, Three.js via React Three Fiber, `node --test` (run with `npm test` in `frontend/`).

**Spec:** `docs/superpowers/specs/2026-11-17-station-flights-vault-door-design.md` (and SPEC.md section 7, already updated).

## Global Constraints
- Asteroid flights (`asteroidArc`) and the building ↔ screen lean stay exactly as they are.
- All tunable amounts live in `frontend/src/belt/look.ts`. Station measurements and timelines live in `frontend/src/interior/stationLayout.ts`.
- Durations: into the station 6 s, out 5 s, room to room 5 s (`LOOK.flights.toStationSeconds = 6`, `fromStationSeconds = 5`, `roomToRoomSeconds = 5`). The greeting adds about 7 to 8 s.
- A click or Escape during a flight finishes it. Reduced motion jumps instead of flying.
- The vault door state is in memory only: it opens on the first Vault visit of each app session and stays open until reload.
- Building names come from the settings file (`nameOf`). Code uses the IDs `planner` and `finance`.
- Never commit SPEC.md. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Escape or click during the greeting:** the door ends open and the robot ends seated at its desk. It never gets stuck in the hallway or mid-hop (test in Task 3, wiring in Task 6).
2. **Browser Back or a new click mid-flight:** the next route starts from wherever the camera is, with no snap (test in Task 5: a route started from a mid-hallway pose).
3. **Belt view rotated behind the station:** the flight in swings round to the hatch instead of passing through the hull (test in Task 5).
4. **First Vault visit via the room-to-room button:** the camera stops at the door and the greeting plays (test in Task 5, live check in Task 6).
5. **Reload straight into `/b/finance` on first load, or with reduced motion:** the greeting plays in place. With reduced motion the door is open, the seat is empty and the robot is at its desk (test in Task 3, live check in Task 6).

---

### Task 1: Robots always have arms

**Files:**
- Modify: `frontend/src/interior/Robot.tsx` (arm meshes near line 490; `if (!near) return;` near line 259)

- [ ] **Step 1:** Draw the arm meshes at both detail levels. Remove the `near &&` guard around the arms block.
- [ ] **Step 2:** Run hand and arm placement every frame at both levels. Move the `if (!near) return;` below the `placeArm` loop, or drop it if nothing after it is near-only. The glass-in-hand logic can stay near-only.
- [ ] **Step 3:** Run `npm test && npx tsc --noEmit` in `frontend/`. Expected: all pass, clean.
- [ ] **Step 4: Live check.** Start the app on demo data. Take screenshots of the belt (zoomed on two asteroids) and of one asteroid building view with a neighbouring asteroid's robot in frame. Expected: every robot has two arms. Check that idle belt fps stays at 60.
- [ ] **Step 5:** Commit: `Robots: arms at every distance`.

### Task 2: Wider hallways; vault door hinges the other way, smaller, with a hallway seat

Steve's addition: both hallways get slightly wider (`HALL.width` 1.9 → 2.3) so the seat fits
beside the camera's path. Everything sized from the hallway (hub openings, room doorways,
hallway walls, panels, status screens, the Mission Control hallway's consoles) must follow
`HALL.width`. Test: add `"hallway is wide enough for the seat"`, which checks that the seat is at least
0.9 from the hallway's centre line and at least 0.15 from its wall.

**Files:**
- Modify: `frontend/src/interior/stationLayout.ts`, `frontend/src/interior/VaultDoor.tsx`
- Test: `frontend/tests/station.test.ts`

**Interfaces:**
- Produces in `stationLayout.ts`:
  - `VAULT_DOOR = { x, radius, centreY, hingeZ }`. The radius is at most 0.76; `hingeZ = -radius`, the hallway's back edge.
  - `vaultDoorOpenOutline(): THREE.Vector3[]`: the four floor-plan corners (y = 0) of the fully open door slab, station coordinates.
  - `HALL_SEAT: THREE.Vector3`: the seat's position (station coordinates). It sits against the hallway's -z wall, about 1.0 before `VAULT_DOOR.x`.
  - `DOOR_OPEN_ANGLE`: the rotation about y that lays the door flat against the room's side wall, swinging into +x toward -z.

- [ ] **Step 1: Write the failing tests** in `station.test.ts`:

```ts
test("open vault door clears the back wall, camera and desk", () => {
  const room = new THREE.Vector3(MODULE_X.finance, 0, 0).add(ROOM_OFFSET);
  const cam = room.clone().add(roomView("finance").camera);
  const monitor = room.clone().add(roomView("finance").screen);
  for (const c of vaultDoorOpenOutline()) {
    assert.ok(c.z > ROOM_SIZE.back + 0.05, "before the back wall");
    assert.ok(c.x >= VAULT_DOOR.x - 0.01, "swings into the room, not the hallway");
    assert.ok(Math.hypot(c.x - cam.x, c.z - cam.z) > 0.5, "clear of the camera");
    assert.ok(c.z < monitor.z - 1.0, "well away from the desk");
  }
});

test("hallway seat is inside the hallway, before the door", () => {
  assert.ok(HALL_SEAT.x < VAULT_DOOR.x - 0.5 && HALL_SEAT.x > HALL.startX);
  assert.ok(HALL_SEAT.z < HALL.z && Math.abs(HALL_SEAT.z - HALL.z) < HALL.width / 2);
});
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL (`vaultDoorOpenOutline` and `HALL_SEAT` not exported).
- [ ] **Step 3: Implement** the new layout values. In `VaultDoor.tsx`:
  - Move the hinge group to `z = VAULT_DOOR.hingeZ` and the barrels to the -z edge.
  - Use `DOOR_OPEN_ANGLE`.
  - Add the seat: a small stool tinted with the Vault's metals, rendered at `HALL_SEAT` and always present.
  - `doorProgress` stays as is for now; Task 4 replaces it.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit: `Vault door: hinge on the far edge, smaller, hallway seat`.

### Task 3: Greeting timeline (pure)

**Files:**
- Create: `frontend/src/interior/vaultGreeting.ts`
- Modify: `frontend/src/interior/stationLayout.ts` (replace `VAULT_OPENING`), `frontend/src/belt/vaultDoor.ts`
- Test: `frontend/tests/vaultGreeting.test.ts`

**Interfaces:**
- Produces:
  - `VAULT_GREETING = { rise: 0.8, toWheel: 1.4, crack: 3.6, swing: 5.4, glide: 7.0, seated: 7.6 } as const` in `stationLayout.ts`. These are phase end times in seconds. `VAULT_OPENING` is removed, and all its users switch over.
  - `GreetingPoints = { seat: Vector3; wheel: Vector3; chair: Vector3; doorway: Vector3 }`. They're in the robot's away frame, the frame `RobotAway.position` uses today, relative to the chair. `chair` is the origin.
  - `greetingPoints(): GreetingPoints` builds them from `HALL_SEAT`, `VAULT_DOOR` and the room layout.
  - `greetingAt(s: number, pts: GreetingPoints): GreetingFrame`. Here `s` is seconds since the greeting started; negative means waiting.
  - `GreetingFrame = { wheel: number /* radians */; bolts: number /* 0..1 retracted */; door: number /* 0..1 open */; robot: { position: Vector3; yaw: number; hands: [Vector3, Vector3] | null; onChair: boolean } }`
  - `vaultDoor.finishNow(nowMs: number): void` schedules the opening so it reads as finished (`nowMs - VAULT_GREETING.seated * 1000 - 1`). `openingTimeFor` uses `VAULT_GREETING.seated`.
- The phases: waiting on the seat; rise (s < rise); move to the wheel (to `toWheel`); crack the wheel, with a stiff start whose angle follows an ease-in curve, and the bolts retract over the last 40% of the crack; swing the door (to `swing`); glide through the doorway to above the chair (to `glide`); hop and settle (to `seated`, a single arc peaking about 0.25 above chair height); then on the chair. While cracking, `hands` sit on the wheel rim at opposite sides, turning with it. Otherwise `hands` is `null`.

- [ ] **Step 1: Write the failing tests** in `vaultGreeting.test.ts`. Set `pts = greetingPoints()` and `G = VAULT_GREETING`.
  - `"waits on the hallway seat"`: `greetingAt(-1, pts)` has robot at `pts.seat`, door 0, wheel 0, `onChair` false.
  - `"cracks the wheel slowly at first"`: the wheel angle increases over the crack window. The angle at 25% of the window is < 15% of the angle at the window's end. `hands` is non-null mid-crack.
  - `"bolts are back before the door moves"`: at the frame where door first exceeds 0.01, bolts equal 1.
  - `"robot stays in the hallway until the door is mostly open"`: for every s, if `robot.position` is past `pts.doorway` toward the chair, then door ≥ 0.9.
  - `"hops into the chair"`: the max robot y in [glide, seated] is ≥ 0.2 above `pts.chair.y`. At `G.seated` and at `s = 99` the robot is at `pts.chair`, `onChair` is true and door is 1.
  - `"no jumps"`: stepping s from -0.5 to `G.seated + 0.5` by 1/60, robot position moves < 0.1 per step and the wheel < 0.3 rad per step.
  - `"finishNow reads as finished"`: after `vaultDoor.resetForTests(); vaultDoor.claimFirstOpening(); vaultDoor.finishNow(1000)`, `greetingAt((1000 - vaultDoor.openingStart()!) / 1000, pts)` has `onChair` true and door 1.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `vaultGreeting.ts` and the `vaultDoor.ts` and `stationLayout.ts` changes. Keep the existing `VaultDoor.tsx` and `ControlStation.tsx` compiling by pointing them at `VAULT_GREETING` (the full wiring is Task 4).
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5:** Commit: `Vault greeting: timeline for the robot, wheel, bolts and door`.

### Task 4: Render the greeting

**Files:**
- Modify: `frontend/src/interior/VaultDoor.tsx`, `frontend/src/interior/ControlStation.tsx` (greeting block near lines 111 to 142), `frontend/src/interior/Robot.tsx` (`RobotAway` and hand targets)

**Interfaces:**
- Consumes: `greetingAt`, `greetingPoints`, `VAULT_GREETING`, `vaultDoor.openingStart()`.
- Produces: `RobotAway = { active: boolean; position: Vector3; yaw: number; hands?: [Vector3, Vector3] | null }`. When `hands` is set, the robot's hand targets use it (away frame) instead of its desk pose.

- [ ] **Step 1:** In `VaultDoor.tsx`, drive the hinge (`door × DOOR_OPEN_ANGLE`), the wheel and the bolts from `greetingAt`. Delete `doorProgress`. Before any opening this session, s is negative (closed). After the greeting, it's finished (open).
- [ ] **Step 2:** In `ControlStation.tsx`, the Vault robot is away while `!onChair`, which includes before the first visit, waiting on the seat. Copy the position, yaw and hands from `greetingAt` into `away`. Remove the old wave choreography (`greet`, `waved`).
- [ ] **Step 3:** In `Robot.tsx`, use `away.hands` when present.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit && npm run build`. Expected: clean.
- [ ] **Step 5: Live check.** Open `/b/finance` directly on a fresh load and watch from the room view. Take screenshots at 0.5 s (seat), mid-crack (hands on the wheel), mid-swing (door clear of the desk) and 8 s (seated, typing). Repeat with reduced motion emulated: the door is open, the seat is empty, the robot is at its desk.
- [ ] **Step 6:** Commit: `Vault greeting: robot cracks the wheel, opens the door, hops into its chair`.

### Task 5: Station routes (pure)

**Files:**
- Create: `frontend/src/belt/stationRoute.ts`
- Modify: `frontend/src/belt/look.ts`
- Test: `frontend/tests/stationRoute.test.ts`

**Interfaces:**
- Produces:
  - `type StationRoom = "planner" | "finance"`
  - `type Route = { duration: number; sample(t: number): Pose; doorStop: { at: number; hold: number } | null }`. `sample` clamps t to [0, duration]. `doorStop.at` is the time the camera arrives at the stop. The camera holds still for `hold` seconds.
  - `routeIn(room: StationRoom, from: Pose, opts: { stopAtDoor: boolean }): Route`
  - `routeOut(room: StationRoom, from: Pose, to: Pose): Route` (`to` is the saved belt pose)
  - `routeBetween(fromRoom: StationRoom, toRoom: StationRoom, from: Pose, opts: { stopAtDoor: boolean }): Route`
  - `roomPose(room: StationRoom): Pose`: the room view, camera behind the robot looking at its screen (station coordinates).
  - `LOOK.flights` gains `fromStationSeconds: 5`, `roomToRoomSeconds: 5`, `lookAhead: 2.5`, `outsideWeight: 0.3`.
- Algorithm (the decisions the tests don't pin):
  - Positions come from one `THREE.CatmullRomCurve3` (`"centripetal"`) through the route's points. The points run along the station's centre lines: outside the hatch, the hatch, a rounded hub corner (two points about 0.8 off centre so the turn is a curve), the hallway entrance, the hallway end, then the room pose. Out reverses the point order, ends at `to`, and adds one swing point after the hatch, offset sideways and up, so the turnaround reads as a curve like the asteroid flights.
  - **Timing:** compute arc length along the curve with a weight per unit length of `outsideWeight` outside the hull and 1 inside. Blend the weight smoothly over 2 units at the hatch so speed never jumps. Map time through one smoothstep over the whole moving time onto the weighted length. With a door stop, there are two legs (to the stop, then onward). Each leg gets its own smoothstep, and the hold sits between them.
  - **Facing:** as a direction, never by lerping target points. The look-ahead direction is the direction to the curve point `lookAhead` units further along. Over the first 20% of the moving time, slerp from the start pose's direction. Over the last 30%, slerp to the end pose's direction. Target = position + direction × the distance to the end target, so the last frame is exact. During the hold, face the door.
  - **Start from behind:** in `routeIn`, if the start lies more than 60° round from +z, as seen from the hub, insert one point 16 units from the hub on the bisector between the start's direction and +z, so the approach swings round outside the hull.
  - The door stop pose sits about 2.0 before `VAULT_DOOR.x`, slightly above eye height, looking at the door centre.
- [ ] **Step 1: Write the failing tests** in `stationRoute.test.ts`. Use `BELT` as in `flightPath.test.ts` and helpers that step t by 1/60 s:
  - `"routes start at the given pose and end exactly on the room pose"`: for `routeIn` both rooms, and `routeBetween` both directions.
  - `"routeOut ends exactly on the belt pose"`
  - `"durations match LOOK"`: in = 6, out = 5, between = 5 (no door stop). With a door stop, duration = the moving time + `doorStop.hold`, and `doorStop.hold ≥ VAULT_GREETING.swing`.
  - `"no stop-and-go"`: for every route without a door stop, the camera speed is > 0.2 units/s for t in [0.3, duration − 0.3]. The speed change between frames is < 1.0 units/s.
  - `"never spins"`: for every route, including a door-stop one, the facing direction turns < 3° per frame. The target is always ≥ 1.0 from the camera.
  - `"room to room passes through the hub"`: some sample lies within 1.0 of (0, y, 0). Every sample has |z| < `HALL.width / 2` while |x| > `HUB.radius`.
  - `"first vault visit stops before the door"`: `routeIn("finance", BELT, { stopAtDoor: true })` and `routeBetween("planner", "finance", roomPose("planner"), { stopAtDoor: true })` both have `doorStop` non-null. The camera is still during the hold, and the stop x < `VAULT_DOOR.x - 1.2`.
  - `"flight in from behind the station stays outside the hull"`: start at (0, 5, −40) looking at the origin. Before the hatch (z > `HUB.radius + 0.5`), every sample is > 3.0 from the station's x-axis spine (the segment x ∈ [−13, 13], y = 0, z = 0).
  - `"a route can start mid-hallway"`: `routeOut("finance", midHallwayPose, BELT)` starts exactly at `midHallwayPose` and passes the "never spins" check.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `stationRoute.ts`. Leave the old helpers in `flightPath.ts` and their tests in place; Task 6 deletes them, so every commit builds.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5:** Commit: `Station routes: one smooth swoop in, out and room to room`.

### Task 6: Fly the routes; room-to-room button

**Files:**
- Modify: `frontend/src/belt/CameraRig.tsx`, `frontend/src/belt/flightPath.ts` (delete the old station helpers now), `frontend/src/belt/levels.ts`, `frontend/src/App.tsx`, the CSS file holding `.belt__back`
- Test: `frontend/tests/levels.test.ts`, `frontend/tests/flightPath.test.ts`

**Interfaces:**
- Consumes: `routeIn`, `routeOut`, `routeBetween`, `Route`, `vaultDoor.finishNow`.
- Produces: `otherStationRoom(id: BuildingId): BuildingId | null` in `levels.ts` (`planner` ↔ `finance`, otherwise null).

- [ ] **Step 1: Write the failing test** in `levels.test.ts`: `otherStationRoom("planner") === "finance"`, `otherStationRoom("finance") === "planner"`, `otherStationRoom("jobs") === null`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement**:
  - `otherStationRoom`.
  - **CameraRig:** the flight kind `{ kind: "route"; route: Route; start: number; fovFrom: number; fovTo: number }` replaces `"path"`. The transitions:
    - belt → station room: `routeIn`.
    - station room → belt: `routeOut` from the current pose to `beltPose`.
    - building `planner` ↔ building `finance`: `routeBetween` from the current pose, with `fovTo` = inside.
  - **Door stop:** `stopAtDoor` is `toRoom === "finance" && !vaultDoor.isOpen()`. Then `claimVault(now + route.doorStop.at * 1000)`.
  - **Skip:** if the Vault greeting is playing or scheduled, call `vaultDoor.finishNow(performance.now())`.
  - The "be exact at the end" snap to `goal` stays.
  - **App:** at building level for a station room, a Liquid Glass button beside Back reads `→ {nameOf(other)}` and calls `go({ level: "building", id: other })`. Style it like `.belt__back`.
  - Delete the old station helpers from `flightPath.ts` (`stationPath`, `samplePath`, `reversePath`, `withStart`, `doorArrival`, `roomPoses`; keep `asteroidArc` and `Pose`) and their tests in `flightPath.test.ts`. Keep the asteroid and skip tests.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit && npm run build && npx prettier --check src tests`. Expected: clean.
- [ ] **Step 5: Live check** (fresh load, demo data). Use screenshots or short frame grabs at about 10 per second:
  - belt → Mission Control
  - Mission Control → belt
  - belt → Vault on the first visit (stop, greeting, swoop)
  - Vault → Mission Control → Vault (no greeting the second time; door open, robot at desk)
  - Escape mid-greeting (door open, robot seated)
  - browser Back mid-flight (no snap)
  - an asteroid flight (unchanged)
  - reduced motion (jumps)

  Watch for camera speed dips and spins; check that fps stays at 60 during flights.
- [ ] **Step 6:** Commit: `Station: fly smooth routes, Mission Control to Vault button`.

### Task 7: Verification, docs and handoff

- [ ] **Step 1:** Fix stale references:
  - the header comments in `flightPath.ts`, `CameraRig.tsx` and `VaultDoor.tsx`
  - mentions of the old wave greeting
  - `docs/` how-it-works text, if it describes station flights
- [ ] **Step 2:** Do the fresh re-run from SPEC section 2, with caches cleared: backend pytest, frontend `npm test`, hook tests, ruff and ruff format, prettier, tsc, build, gitleaks over the full history, and blocked words over every tracked file.
- [ ] **Step 3:** Run the defect hunt over the branch diff. Then build the scorecard (requirements table from the design's goals 1 to 7, evidence, bars, findings) and write the handoff note `handoff/2026-11-17-session-6.md`.
- [ ] **Step 4:** Ask Steve to review live. Then ask before merging `belt-detail-upgrade` into main and pushing.
