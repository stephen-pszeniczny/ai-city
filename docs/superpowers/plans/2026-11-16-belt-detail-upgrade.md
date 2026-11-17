# Belt Detail Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3D belt detailed and alive: new working robots, detailed desks with gadgets and projectors, realistic rock, a connected station with hallways and a vault door, slower path flights, and a richer Earth with shooting stars.

**Architecture:** All "how much" values live in `belt/look.ts`. Behaviour that can be wrong is pure TypeScript with unit tests (robot action picker, work-screen content, level of detail, flight paths, vault door, hallway status, shooting-star timing); the 3D components read from those. Every asteroid keeps its desk and robot permanently on its spinning deck (portal into `spin`), with a lighter far version, so all three views show the same world. The station interior (hub, two hallways, two rooms) is one set built once at the station's origin.

**Tech Stack:** React 19, TypeScript, three 0.187, @react-three/fiber 9.8.2, @react-three/drei 10.7.9 (already installed), Node built-in test runner (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-16-belt-detail-upgrade-design.md` (and SPEC.md section 7, private).

## Global Constraints

- No new packages, no downloaded models or textures; everything generated in code. No post-processing pass.
- Building IDs in code: `planner, finance, jobs, career, mail, relationships, projects, gym, library`. Display names only from `GET /api/buildings`.
- Built today: `planner` only.
- Robot is original: capsule body fully in the building tint, wide emissive visor in the building tint, short antenna with blinking tip. Not any brand, film or game character.
- Robot actions: random weighted order, never the same action twice in a row (Steve).
- No sensitive data on hallway or belt screens: counts and status only, never amounts.
- Idle performance: about 60 fps at 1440×900 on the belt and inside each level, no frames over 33 ms.
- Flights: about 3 s to an asteroid, about 6 s into the station; click or Escape during a flight skips to its end; reduced motion jumps.
- CSS/canvas colours with transparency use commas (`rgba(1, 2, 3, 0.5)`) (gitleaks rule).
- No blocked words in code, comments or commit messages (pre-commit hook).
- Screenshots and checks in Sample mode on a throwaway `AICITY_DATA_DIR` only.
- No visual layout tests (spec section 10); logic gets unit tests.

## Review Focus

1. Pressing Escape or clicking during a flight → the flight finishes instantly; it does not also step out a level (Task 5 test `escape during flight skips, does not navigate`).
2. Changing destination mid-flight (Back while flying in) → the new flight starts from wherever the camera is, no jump (Task 5 test `path starts from the given pose`).
3. Tab hidden for minutes, then shown → robot picks one new action, doesn't race through dozens (Task 1 test `a long gap gives one transition`).
4. Reduced motion → flights jump, shooting stars and the toy rocket stay off, robot motion calmer (Task 1 `motionScale`, Task 6 test `no shooting stars with reduced motion`).
5. Nine robots and desks at once → far ones drop to the light version (Task 2 test `detailFor` thresholds), checked live with the frame-rate run.

---

### Task 1: Look settings, action picker and the new robot

**Files:**
- Create: `frontend/src/belt/look.ts`
- Create: `frontend/src/interior/robotBrain.ts`
- Rewrite: `frontend/src/interior/Robot.tsx`
- Test: `frontend/tests/robotBrain.test.ts`

**Interfaces:**
- Produces: `LOOK` (as sketched to Steve: `detail`, `farDetailDistance`, `robot.{glowStrength,bob,busyness,funActions}`, `gadgets.{enabled,speed}`, `hologramHeight`, `station.{wallPanelMotion,blinkingLights}`, `flights.{toAsteroidSeconds,toStationSeconds}`, `earth.{cityLights,cloudSpeed}`, `shootingStars.{minSeconds,maxSeconds}`); `motionScale(reduced: boolean): number` (1, or 0.3 when reduced).
- Produces: `type RobotAction = "type" | "switchTab" | "read" | "sip" | "stretch" | "lookAround" | "spin" | "wave" | "gadget"`; `mulberry32(seed: number): () => number`; `class RobotBrain { constructor(seed: number, opts?: { funShare?: number; busyness?: number }); update(t: number): { action: RobotAction; progress: number; tick: number }; react(): void }`. `tick` increments each time the screen should change (each typing burst step and each tab switch).
- Produces: `<Robot tint seed detail onWork? />` where `detail: "near" | "far"` and `onWork?(state)` reports the brain state each frame to the screen.

- [ ] **Step 1: Write failing tests** in `robotBrain.test.ts`:
  - `never repeats an action twice in a row` (10 000 transitions with seed 1, no `a[i] === a[i-1]`).
  - `typing is the most common action` (counts over 10 000: `type` highest).
  - `fun share follows funShare` (funShare 0.05 → spin+wave+stretch under 10%).
  - `react() makes the next action wave or spin`.
  - `a long gap gives one transition` (update(0) then update(600) → exactly one action change).
  - `same seed, same sequence; different seeds differ`.
  - `durations stay in range` (each action's duration within its min–max).
  - `motionScale(true) === 0.3`, `motionScale(false) === 1`.
- [ ] **Step 2: Run** `npm test` → FAIL (module not found).
- [ ] **Step 3: Implement** `look.ts` and `robotBrain.ts`. Weights: type 5, switchTab 2, read 2, sip 1, lookAround 1, gadget 1, and fun actions (stretch, spin, wave) sharing `funShare` of the total. Pick by weight excluding the previous action. Durations (s): type 3–7, switchTab 1.2–2, read 2–4, sip 2–3, lookAround 1.5–3, gadget 2–4, stretch 2–3, spin 2.2–3, wave 1.8–2.5; scaled by `1 / busyness`.
- [ ] **Step 4: Rewrite `Robot.tsx`**: capsule body (whole shell in tint, darker tint joints), wide curved visor with emissive tint (intensity × `glowStrength`), antenna with blinking tip, round head merged into the capsule, short arms with mitten hands, swivel chair with low back. Pose per action (typing fingers alternate, hand to mouse for switchTab, glass to visor for sip, chair turns 360° for spin, arm wave toward camera for wave, head nods for read). Gentle idle bob always. `detail="far"`: body, visor, antenna only; bob only.
- [ ] **Step 5: Run** `npm test`, `npm run typecheck` → pass.
- [ ] **Step 6: Commit** "Robot: new capsule design and a random action brain".

### Task 2: Working screens, detailed desks, gadgets, projector, always-present desks

**Files:**
- Create: `frontend/src/interior/workScreen.ts` (pure content), `frontend/src/interior/DeskProps.tsx` (glass, plant, lamp, mouse and mat, cable, projector), `frontend/src/interior/Gadget.tsx` (one gadget per building), `frontend/src/belt/lod.ts`
- Modify: `frontend/src/interior/Monitor.tsx` (draw `workScreen` content, redraw on `tick`, max 4 redraws/s), `frontend/src/interior/Desk.tsx` (keys as instanced caps, drawer, cable tray), `frontend/src/interior/AsteroidDesk.tsx`, `frontend/src/belt/asteroids.ts`, `frontend/src/belt/BeltScene.tsx`, `frontend/src/belt/hologram.ts`, `frontend/src/belt/CameraRig.tsx` (new `DESK_SPOT` camera)
- Test: `frontend/tests/workScreen.test.ts`, `frontend/tests/lod.test.ts`

**Interfaces:**
- Consumes: `RobotBrain` state via `Robot onWork`.
- Produces: `workScreen(id: BuildingId, built: boolean, tick: number, tasks?: ScreenLine[]): WorkScreen` with `WorkScreen = { tabs: string[]; active: number; progress: number[]; log: string[]; chart: number[] }`; `detailFor(distance: number): "near" | "far"` (near below `LOOK.farDetailDistance`).
- Produces: `AsteroidBuilding.projector: THREE.Vector3` (deck coords of the projector lens) and the hologram root at `LOOK.hologramHeight` above the deck.

- [ ] **Step 1: Write failing tests**: `workScreen` — `planner tabs include "To-do" and use the real task titles`, `unbuilt buildings say "Setting up" and stay under construction`, `same tick same screen; next tick changes progress or log`, `log lines are generic` (no digits followed by `$`, no `@`); `lod` — `detailFor(5) === "near"`, `detailFor(LOOK.farDetailDistance + 1) === "far"`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** `workScreen.ts` and `lod.ts`; Monitor draws tabs, progress bars, log, small chart, and Mission Control's task list as its To-do tab.
- [ ] **Step 4: Desks**: bigger deck (deck cylinder radius 1.9 → 3.0, rim and windows follow; rock scale so the top fits), desk group scale 0.65, detailed keyboard, `DeskProps`, gadget per building as in the design (Flight School rocket loops around the asteroid, launches every 20–40 s, skipped with reduced motion), under-construction sign turned to face the camera, posts behind.
- [ ] **Step 5: Always present**: `BeltScene` portals an `AsteroidDesk` into every asteroid's `spin`; each picks `detailFor` from camera distance every 0.5 s. Holder no longer hidden inside; hologram and banner float at `LOOK.hologramHeight`, a faint beam cone runs from the projector lens up to the hologram.
- [ ] **Step 6: Camera**: `DESK_SPOT.camera` higher and further right and back, screen tilted toward it, so most of the screen shows past the robot's head; `screenCamera` re-fitted so the level 3 overlay still lines up. Clicking the robot calls `brain.react()`; desk and screen open the computer.
- [ ] **Step 7: Run** `npm test`, typecheck, build; live look at belt and two asteroids; frame-rate check on the belt.
- [ ] **Step 8: Commit** "Desks: working screens, props, gadgets, projector holograms; robots on every asteroid".

### Task 3: Asteroid and small-rock realism

**Files:**
- Modify: `frontend/src/belt/space/rock.ts` (detail 5 → 6, craters with raised rims, ridges, finer colour variation, darker crevices), `frontend/src/belt/space/noise.ts` (add `bumpTexture(size, seed)`), `frontend/src/belt/asteroids.ts` (bump map, a few boulders scattered on the rock), `frontend/src/belt/space/belt.ts` (four base shapes instead of one, bump map, size and colour variety)

**Interfaces:** `rockGeometry(seed, tint, detail?: number)`; `bumpTexture(size: number, seed: number): THREE.CanvasTexture` (cached per session).

- [ ] **Step 1:** Implement; keep the flat top matching the new deck.
- [ ] **Step 2: Run** typecheck, build, `npm test`; live look at belt and an asteroid; frame-rate check.
- [ ] **Step 3: Commit** "Rock: craters, bumps and boulders; more varied belt rocks".

### Task 4: Station rebuilt with hub, hallways and vault door

**Files:**
- Create: `frontend/src/interior/StationInterior.tsx` (hub room, both hallways, both rooms), `frontend/src/interior/Hallway.tsx` (`kind: "planner" | "finance"`: control panels, windows, status screens for Mission Control), `frontend/src/interior/VaultDoor.tsx`, `frontend/src/interior/WallPanels.tsx` (animated canvas: bar meters, level gauges, waveform, status lights), `frontend/src/belt/vaultDoor.ts`, `frontend/src/belt/hallwayStatus.ts`
- Modify: `frontend/src/belt/station.ts` (exterior: hub joined to both modules by hallway tubes, hatch on the hub), `frontend/src/interior/ControlStation.tsx` (window most of the front wall; desk inside the vault for `finance`), `frontend/src/interior/Console.tsx` (keypads, switches, levers, dials, gauge screens, LEDs), `frontend/src/belt/BeltScene.tsx` (show interior when camera is inside the station's box, exterior otherwise)
- Test: `frontend/tests/vaultDoor.test.ts`, `frontend/tests/hallwayStatus.test.ts`

**Interfaces:**
- Produces: `vaultDoor = { isOpen(): boolean; claimFirstOpening(): boolean; resetForTests(): void }` (module singleton, in memory: first claim true, then false until reload).
- Produces: `hallwayStatus(buildings: Building[], openTasks: BadgeTask[], built: ReadonlySet<BuildingId>): { id: BuildingId; name: string; text: string }[]` (planner: badge or "N open"; unbuilt: "Under construction"; built others: "Ready").
- Produces: `STATION_PATHS` points used by Task 5: hub hatch (outside), hub centre, hallway ends per module, vault door stop, final robot pose (reuses `ROOM.camera`).

- [ ] **Step 1: Write failing tests**: `first opening is claimed once`, `door stays open after first opening`, `hallway status shows counts, never amounts`, `unbuilt buildings read Under construction`, `excludes planner and finance from the list` (they're the station itself).
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** `vaultDoor.ts`, `hallwayStatus.ts`.
- [ ] **Step 4: Build** the interior set and exterior changes. Vault first visit: robot stands at the door panel, door rolls aside, robot waves, walks back to its chair, then normal work. Later visits: door open, robot already working.
- [ ] **Step 5: Run** tests, typecheck, build; live look at both rooms and hallways; frame-rate check inside.
- [ ] **Step 6: Commit** "Station: hub, hallways, vault door, detailed consoles and moving panels".

### Task 5: Slower path flights, skippable

**Files:**
- Create: `frontend/src/belt/flightPath.ts`, `frontend/src/belt/flightState.ts`
- Modify: `frontend/src/belt/CameraRig.tsx`, `frontend/src/App.tsx` (Escape and clicks skip a running flight first)
- Test: `frontend/tests/flightPath.test.ts`, `frontend/tests/flightState.test.ts`

**Interfaces:**
- Produces: `type Pose = { position: Vec3; target: Vec3 }`, `type Waypoint = Pose & { at: number }`; `samplePath(points: Waypoint[], seconds: number): Pose` (Catmull-Rom through positions and targets, eased within each segment, clamped at ends); `reversePath(points): Waypoint[]`; `stationPath(id: "planner" | "finance", from: Pose, opts: { stopAtDoor: boolean }): Waypoint[]`; `asteroidArc(from: Pose, goal: Pose, k: number): Pose` (curved approach: lifts and swings around, settles on goal; goal re-read every frame as the asteroid moves).
- Produces: `flightState = { flying(): boolean; start(): void; end(): void; skip(): void; skipRequested(): boolean }`.

- [ ] **Step 1: Write failing tests**: `path starts from the given pose`, `path ends exactly on the last waypoint`, `reverse path ends where forward began`, `station path to the vault stops at the door when asked`, `station path to Mission Control turns left (negative x)`, `durations match LOOK`, `asteroidArc k=0 is from and k=1 is goal`, `escape during flight skips, does not navigate` (flightState.skip sets skipRequested; App handler returns early while flying).
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement**; CameraRig uses `stationPath` / `asteroidArc` / reverse on Back; lens widens as the camera passes the hatch.
- [ ] **Step 4: Run** tests, typecheck, build; live: every building in and out, Back mid-flight, Escape mid-flight, reduced motion.
- [ ] **Step 5: Commit** "Flights: slower paths through the station, skippable".

### Task 6: Earth detail and shooting stars

**Files:**
- Modify: `frontend/src/belt/space/earth.ts` (double texture size, sharper coasts, city lights clustered along coasts and rivers × `LOOK.earth.cityLights`, cloud drift, stronger atmosphere rim)
- Create: `frontend/src/belt/space/shootingStars.ts`
- Modify: `frontend/src/belt/space/index.ts`
- Test: `frontend/tests/shootingStars.test.ts`

**Interfaces:** `nextGap(rng: () => number, min: number, max: number): number`; `createShootingStars(scene, opts: { reducedMotion: boolean }): { update(t: number): void; dispose(): void }`.

- [ ] **Step 1: Write failing tests**: `gaps stay within min and max`, `no shooting stars with reduced motion`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement**; keep the texture cache per session.
- [ ] **Step 4: Run** tests, typecheck, build; live look; measure texture build time (under 0.5 s).
- [ ] **Step 5: Commit** "Earth: more detail and city lights; occasional shooting stars".

### Task 7: Spec update and session check

**Files:**
- Modify: `SPEC.md` section 7 (private; show Steve the wording first): robot design and actions, clicking the robot reacts, robots visible from the belt, desk projector holograms floating above, connected station with hallways and vault door, slower flights.
- Create: `handoff/2026-11-16-session-5.md`

- [ ] **Step 1:** Show Steve the section 7 wording; apply after his yes.
- [ ] **Step 2: Session check**: clear caches; full backend, frontend and hook tests; ruff, prettier, tsc, build; gitleaks full history; blocked words; every design goal verified live with screenshots at 1440×900 and 1024×700, reduced motion on and off; 60 s frame-rate run per level.
- [ ] **Step 3:** Scorecard (spec section 2 format) in the handoff note; commit.
