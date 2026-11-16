# 3D City Scenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder home with the 3D city, fly into each building's robot scene, and lean into the robot's screen to use the building's apps (City Hall: the real to-do list).

**Architecture:** One React Three Fiber `<Canvas>` for the whole app; the camera flies between three levels (city → building → screen) driven by the URL. Space (stars, Earth, belt, asteroids) is one shared plain-three module ported from the approved prototype and used by every level. Level 3 is a DOM desktop over the still-running canvas, ported from the `spike/desktop-screen` prototype.

**Tech Stack:** React 19, TypeScript, three 0.187, @react-three/fiber 9.8.2, @react-three/drei 10.7.9 (all already installed), react-router-dom 7, FastAPI backend, Node built-in test runner, pytest.

**Spec:** `docs/superpowers/specs/2026-11-15-3d-city-scenes-design.md` (and SPEC.md section 7, private).

## Global Constraints

- No new packages (npm or Python). Postprocessing uses three's own addons (`three/addons/postprocessing/*`).
- Building IDs in code: `planner, finance, jobs, career, mail, relationships, projects, gym, library`. Display names only from settings (`GET /api/buildings`).
- Built today: `planner` only. Every other building and app shows "under construction".
- CSS colours with transparency use commas (`rgba(1, 2, 3, 0.5)`), never space-separated triples (gitleaks SIN rule).
- No blocked words in code, comments or commit messages (pre-commit hook).
- Robot is original: not Anthropic's logo or branding, not copied from any film, game or brand.
- Screenshots and checks in Sample mode on a throwaway `AICITY_DATA_DIR` only.
- `prefers-reduced-motion`: cross-fades instead of camera flights; slower space motion.
- Level 3 monitor size: `width: min(1210px, 100%, calc(66vh * 1.6))`, 16:10 screen.
- Flights about 1.2 s, ease-in-out. Asteroid crossing the control-station window about 40 s.
- No visual layout tests (spec section 10); logic gets unit tests.

## Review Focus

1. Unsaved task edits when leaving level 3 by Back button, Escape or browser Back → asks first (Task 4 test: `confirmLeave` with a dirty guard).
2. Reload or deep link at `/b/planner/screen`, or an unknown ID like `/b/nope` → lands on that view, or on the city for unknown IDs (Task 4 tests on `parsePath`).
3. WebGL unavailable or the scene throws → a clear message with a link to the plain `/todo` page, not a blank screen (Task 3, live check by forcing the error).
4. Engine down while inside a scene → the scene keeps rendering and the screen shows the to-do panel's existing engine-down state (Task 8 live check).
5. Half-screen laptop window (1024×700) → monitor fits with no page scroll; labels don't overlap the top bar (Task 8 and Task 9 live checks).

---

### Task 1: Building names route

**Files:**
- Modify: `src/aicity/main.py` (add route next to `/api/mode`)
- Modify: `tests/test_get_routes_read_only.py` (add `/api/buildings`)
- Create: `tests/test_buildings_route.py`
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Produces: `GET /api/buildings` → `[{"id": "planner", "name": "<from settings>"}, …]` in `BUILDING_IDS` order; 503 with a setting-named message when settings are missing or invalid (existing `SettingsError` handler).
- Produces (frontend): `type BuildingId = "planner" | "finance" | "jobs" | "career" | "mail" | "relationships" | "projects" | "gym" | "library"`; `type Building = { id: BuildingId; name: string }`; `getBuildings(): Promise<Building[]>`.

- [ ] **Step 1: Write failing tests** `test_buildings_lists_all_nine_in_order` (ids equal `list(BUILDING_IDS)`, names equal the example settings' values), `test_buildings_missing_settings_is_503`, and add the path to the read-only GET test.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_buildings_route.py -q` → FAIL (404).
- [ ] **Step 3: Implement** the route with `load_settings().buildings`; add the frontend types and call.
- [ ] **Step 4: Run** full `pytest -q` and `npm run typecheck` → all pass.
- [ ] **Step 5: Commit** "Add GET /api/buildings for display names".

### Task 2: Shared space module

**Files:**
- Create: `frontend/src/city/space/` → `sky.ts` (stars, Milky Way, nebulae, sun), `earth.ts` (procedural Earth, textures cached at module level for the session), `belt.ts` (debris, dust), `rock.ts` (`rockGeometry(seed, tint)`), `orbit.ts`, `index.ts`
- Create: `frontend/src/city/Effects.tsx` (bloom at half resolution + film pass; takes over rendering with `useFrame(…, 1)`)
- Test: `frontend/tests/orbit.test.ts`

**Interfaces:**
- Produces: `ORBIT_R = 38`; `ASTEROIDS: readonly { id: BuildingId; tint: string; angleDeg: number }[]` (jobs #41c9d6 347, mail #ffb547 38, gym #ff5d6c 89, projects #ff7a45 141, relationships #ff7ab8 192, career #9b7bff 244, library #55d39a 295); `orbitAngle(angleDeg: number, t: number, speed: number): number` (radians); `orbitPosition(angleDeg, t, speed): [x, y, z]`; `ORBIT_SPEED = 0.02` (reduced motion `0.004`).
- Produces: `createSpace(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Space` where `Space = { update(t: number): void; dispose(): void }`.

- [ ] **Step 1: Write failing tests**: `orbitAngle(0, 0, 0.02) === 0`; `orbitAngle(90, 0, s) ≈ π/2`; full turn after `2π / 0.02` s returns to start (mod 2π); `orbitPosition` radius is `ORBIT_R` within 1e-9.
- [ ] **Step 2: Run** `npm test` → FAIL (module missing).
- [ ] **Step 3: Implement** by porting from `spike/desktop-screen:frontend/src/spike/spaceScene.ts`, typed (no `@ts-nocheck`), using `THREE.Timer` instead of the deprecated `THREE.Clock`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` → pass.
- [ ] **Step 5: Commit** "Add shared 3D space module (sky, Earth, belt, orbits)".

### Task 3: Level 1, the city

**Files:**
- Create: `frontend/src/city/CityCanvas.tsx` (the one `<Canvas>`, error boundary, pauses when `document.hidden`), `city/Station.tsx` (hub, ring, truss, solar wings, City Hall and Finance modules), `city/Asteroid.tsx`, `city/construction.tsx` (mining rig, scaffolding and the "under construction" sign, exported as `ConstructionSign` props `{ scale?: number }`), `city/landmarks.tsx` (seven landmarks, shown only when built), `city/Labels.tsx`, `city/badges.ts`, `city/built.ts`
- Modify: `frontend/src/App.tsx` (`/` renders the city; `/todo` stays as the plain fallback)
- Test: `frontend/tests/badges.test.ts`

**Interfaces:**
- Consumes: Task 1 `getBuildings`; Task 2 `createSpace`, `ASTEROIDS`, `orbitPosition`.
- Produces: `BUILT: ReadonlySet<BuildingId>` = `planner`; `plannerBadge(tasks: Task[], now: Date): string | null` → `"N overdue"` if any open task's goal date is before today (local), else `"N stale"` if any stale, else `null`; `anchorOf(id: BuildingId, t: number): THREE.Vector3` (world position of a building's label anchor).

- [ ] **Step 1: Write failing tests** for `plannerBadge`: 2 overdue + 1 stale → `"2 overdue"`; 0 overdue + 3 stale → `"3 stale"`; none → `null`; done/archived tasks never count; uses the local date (same trap as `dates.ts`).
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** the scene; OrbitControls with min distance 24, max 320, max polar 1.5, pan off; labels are drei `Html` glass pills, clicking a label or a building calls `onOpen(id)`; error boundary shows "3D isn't available in this browser" with a link to `/todo`; a visually hidden list of nine real buttons (one per building, settings names) opens the same views for keyboard and screen-reader users.
- [ ] **Step 4: Run** tests, typecheck, build; live: city renders, nine labels with settings names, City Hall badge matches the demo tasks, all seven asteroids show rigs, scaffolding and a readable sign and no landmark, forced error shows the fallback.
- [ ] **Step 5: Commit** "Add the 3D city: station, asteroids, belt, labels and badges".

### Task 4: Levels, URL, camera flights, Back

**Files:**
- Create: `frontend/src/city/levels.ts`, `city/CameraRig.tsx`, `frontend/src/leaveGuard.ts`
- Modify: `frontend/src/todo/TaskDetail.tsx` (report dirty to `leaveGuard`), `App.tsx` (routes `/b/:id`, `/b/:id/screen`)
- Test: `frontend/tests/levels.test.ts`, `frontend/tests/leaveGuard.test.ts`

**Interfaces:**
- Produces: `type View = { level: "city" } | { level: "building"; id: BuildingId } | { level: "screen"; id: BuildingId }`; `parsePath(path: string): View`; `toPath(view: View): string`; `back(view: View): View`; `setDirty(dirty: boolean): void`; `confirmLeave(ask: (msg: string) => boolean = window.confirm): boolean`.
- Produces: `CameraRig` props `{ view: View }`; flies 1.2 s ease-in-out to `poseFor(view, t)`; Escape navigates to `toPath(back(view))` only if `confirmLeave()`.

- [ ] **Step 1: Write failing tests**: `parsePath("/")` → city; `"/b/planner"` → building planner; `"/b/planner/screen"` → screen; `"/b/nope"` and `"/b/nope/screen"` → city; `toPath(parsePath(p)) === p` for the three valid shapes; `back(screen) → building`, `back(building) → city`, `back(city) → city`; `confirmLeave` returns true without asking when clean, asks with "Discard your unsaved changes?" when dirty and returns the answer.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement**; TaskDetail's existing Back confirm uses `confirmLeave` so there's one rule; browser Back at level 3 with a dirty task is blocked with react-router's `useBlocker` using the same guard.
- [ ] **Step 4: Run** tests, typecheck, build; live: click → flight → URL changes; Escape and Back step out; reload at each URL lands correctly.
- [ ] **Step 5: Commit** "Add city/building/screen levels with camera flights and Back".

### Task 5: Robot

**Files:**
- Create: `frontend/src/interior/Robot.tsx`

**Interfaces:**
- Produces: `Robot` props `{ tint: string; seated?: boolean }` (default seated); idle loop (head tilt, blink, typing hands) slowed under reduced motion.

- [ ] **Step 1: Implement** from simple shapes: rounded body, screen-face with two eyes, antenna, arms reaching to a keyboard height of 0.75 desk units.
- [ ] **Step 2: Verify live** in a temporary viewer route removed before commit; screenshot with two tints.
- [ ] **Step 3: Run** typecheck and build → pass. **Commit** "Add the robot character".

### Task 6: Control station (City Hall, Finance)

**Files:**
- Create: `frontend/src/interior/ControlStation.tsx`, `interior/Console.tsx` (keypad, buttons, levers), `interior/Desk.tsx` (shared with Task 7)

**Interfaces:**
- Consumes: Task 5 `Robot`; Task 4 `poseFor` gets a `building` pose per station.
- Produces: `ControlStation` props `{ id: "planner" | "finance"; tint: string; onOpenScreen(): void }`; `Desk` props `{ tint: string }`; monitor mount point exported as `MONITOR_MOUNT` (position + size) for Task 8.

- [ ] **Step 1: Implement** inside each module's half of the station; large window behind the console faces the ring so asteroids and belt cross it; clicking robot, desk or screen calls `onOpenScreen`; a visually hidden "Use the computer" button does the same from the keyboard.
- [ ] **Step 2: Verify live**: City Hall and Finance scenes, an asteroid crosses the window within about 40 s.
- [ ] **Step 3: Run** typecheck and build. **Commit** "Add control-station scenes for City Hall and Finance".

### Task 7: Asteroid desk scene

**Files:**
- Create: `frontend/src/interior/AsteroidDesk.tsx`

**Interfaces:**
- Consumes: `Robot`, `Desk`, Task 2 `ASTEROIDS`, Task 3 `BUILT` and `ConstructionSign`.
- Produces: `AsteroidDesk` props `{ id: BuildingId; tint: string; onOpenScreen(): void }`; sits on the asteroid's deck and turns with the asteroid's spin, so space sweeps slowly behind.

- [ ] **Step 1: Implement**; the camera pose for asteroid buildings follows the asteroid (computed each frame from `orbitPosition` and its spin).
- [ ] **Step 2: Verify live** for two asteroids with different tints; robot and desk take the tint; an unbuilt asteroid shows the sign beside the desk.
- [ ] **Step 3: Run** typecheck and build. **Commit** "Add asteroid desk scenes".

### Task 8: Monitor and desktop screen

**Files:**
- Create: `frontend/src/interior/Monitor.tsx` (level 2: live screen via drei `Html` with `transform`, display only), `frontend/src/desktop/Desktop.tsx`, `desktop/desktop.css`, `desktop/apps.ts`, `desktop/Surround.tsx` (station hull + console edge, or asteroid ground + desk edge, around the monitor)
- Test: `frontend/tests/apps.test.ts`

**Interfaces:**
- Consumes: Task 4 `View`; Task 6 `MONITOR_MOUNT`; existing `TodoPanel`.
- Produces: `appsFor(id: BuildingId): App[]` with `App = { id: string; name: string; ready: boolean }`; planner → `todo` (ready), `plan`, `review`, `projects` (not ready); every other building → one `construction` app, not ready.

- [ ] **Step 1: Write failing tests** for `appsFor` as above, and that every building ID returns at least one app.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** by porting the prototype's desktop (menu bar with building name from settings, Sample tag, clock; dock; window with its own scroll; Undo banner kept inside the screen); monitor size from Global Constraints; focus moves to the open window's heading when level 3 opens.
- [ ] **Step 4: Verify live**: level 2 shows the live list on the 3D monitor; level 3 swap is seamless; edit and archive work; engine down shows the panel's engine-down state while the scene keeps moving; 1024×700 fits with no page scroll.
- [ ] **Step 5: Run** tests, typecheck, build. **Commit** "Add the monitor and desktop screen".

### Task 9: Session check

- [ ] Fresh re-run of every check (backend tests, hook tests, frontend tests, ruff, prettier, typecheck, build, gitleaks full history, blocked words over every tracked file), GitHub Actions on the pushed commit.
- [ ] Live click-through of every goal in the design, in Sample mode, at 1440×900 and 1024×700, with reduced motion on and off.
- [ ] Idle performance: frame time and CPU over 60 s at level 1, 2 and 3; rendering stops when the tab is hidden.
- [ ] Scorecard and handoff note.
