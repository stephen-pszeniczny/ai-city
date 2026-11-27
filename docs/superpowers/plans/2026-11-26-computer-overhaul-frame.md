# Computer overhaul PR 1: frame, design kit, background hold, robot live view

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every desk computer becomes a Mac-style all-in-one with a left glass app list and a building-tinted desktop, built on a shared design kit; the 3D scene holds still behind the screen; each robot's monitor shows its building's live counts.

**Architecture:** A new `frontend/src/ui/` design kit (CSS tokens + small React components). `Desktop.tsx` is rebuilt as the new computer using the kit and a `deskTheme` (tint + wallpaper). A `HoldContext` tells animated 3D pieces to skip per-frame work while the screen is open (asteroid orbit excepted) and when out of view. `workScreen` gains a counts-only live view from a pure `liveStat`. Apps keep their current styling in this PR (PRs 2–4 move them onto the kit).

**Tech Stack:** React 19, TypeScript, React Three Fiber, Vite; `node --test` for pure helpers.

**Spec:** `docs/superpowers/specs/2026-11-26-computer-overhaul-design.md` (PR 1 of 4).

## Global Constraints

- No Apple logo, name or wallpaper; original gradient art and glyphs only.
- No new dependencies; no visual layout tests (pure helpers only).
- Robot monitor: counts, rings and bars only, never names, titles or amounts.
- Reduce Motion: app switching is instant; existing reduced-motion rules stay.
- Tab switch animation about 150 ms. Screen view 10–15 % larger than today.
- `npm test`, `npm run typecheck`, `npm run build` clean before every commit; backend untouched.

## Review Focus

1. **Reduce Motion on** → tabs switch instantly and the held scene stays still (no animation sneaks back). Test in Tasks 3 and 4.
2. **Leaving the screen** (Back, Escape, browser back) → animation resumes at once; nothing stays frozen. Test in Task 4.
3. **A locked or not-set-up building** (Vault locked, no `[jobs]`) → the robot monitor shows a neutral state, never an error or a number it can't know. Test in Task 5.
4. **A building with one app or many** → the left list lays out without overflow (scrolls past ~8 apps). Test in Task 3 (`appListLayout`).
5. **Unbuilt building at the computer** → the "under construction" desktop still shows, with the new frame. Test in Task 3.

---

### Task 1: Design kit

**Files:** Create `frontend/src/ui/kit.css`, `frontend/src/ui/Kit.tsx`, `frontend/src/ui/kit.ts`; Test `frontend/tests/kit.test.ts`

**Interfaces:**
- CSS custom properties on `.kit` root: `--kit-bg`, `--kit-glass`, `--kit-glass-strong`, `--kit-line`, `--kit-text`, `--kit-muted`, `--kit-accent` (default royal blue `#3d6df2`), `--kit-radius-s|m|l` (8/12/16 px), `--kit-space-1..5` (4/8/12/16/24 px), `--kit-blur` (18px).
- Components: `GlassButton({children, active?, icon?, onClick, ...})`, `Tile({label, value, children?})`, `Chip({children, tone?: "default"|"warn"|"good"})`, `Section({title, children})`, `ProgressBar({value})`, `Field` (label + input wrapper).
- `kit.ts`: `clamp01(value: number): number`, `progressPercent(value: number): string` (`"0%"`…`"100%"`, NaN → `"0%"`).

- [ ] **Step 1:** failing tests for `clamp01` and `progressPercent` (−1 → 0, 0.425 → "43%", 2 → "100%", NaN → "0%").
- [ ] **Step 2–4:** fail; implement; pass.
- [ ] **Step 5: Commit** `Design kit: tokens and shared components`

### Task 2: Desk theme (tint and wallpaper)

**Files:** Create `frontend/src/desktop/deskTheme.ts`; Test `frontend/tests/deskTheme.test.ts`

**Interfaces:** `deskTheme(id: BuildingId): { accent: string; wallpaper: string }`. Accent from `tintOf(id)` except Mission Control uses a blue-white `#9db8ff` (its station tint is near-white); wallpaper is a CSS layered radial/linear gradient over `#05070c` that includes the accent.

- [ ] **Step 1:** failing tests: every building id returns a hex accent; planner, finance, jobs and career accents differ; wallpaper contains the accent; output is stable for the same id.
- [ ] **Step 2–4:** fail; implement; pass.
- [ ] **Step 5: Commit** `Desk theme: building tint and wallpaper`

### Task 3: The new computer

**Files:** Modify `frontend/src/desktop/Desktop.tsx` (rebuilt), `frontend/src/desktop/desktop.css` (rebuilt on kit tokens); Create `frontend/src/desktop/appTabs.ts`; Test `frontend/tests/appTabs.test.ts`

**Interfaces:**
- `appListLayout(count: number): { scroll: boolean }` (scroll when count > 8).
- `switchMode(reduceMotion: boolean): "instant" | "slide"`.
- Desktop: aluminium body (dark thin bezel, aluminium chin and stand), menu bar (building name, Sample chip, clock), one glass window. Left list: each app a `GlassButton` with icon and name; the open one `active` (blue glow + 3 px blue bar at its left, `aria-current="page"`); "later" apps dimmed with the existing note. Main area: the open app panel with the slide-and-fade (~150 ms) unless `switchMode` says instant. Unbuilt buildings show the construction desktop in the new frame. Desktop background `deskTheme(id).wallpaper`; window glow uses its accent. Overall scale about 12 % larger than today's monitor.

- [ ] **Step 1:** failing tests: `appListLayout(3).scroll === false`, `appListLayout(9).scroll === true`; `switchMode(true) === "instant"`, `switchMode(false) === "slide"`; `appsFor` unchanged (existing apps test passes).
- [ ] **Step 2–4:** fail; implement; pass; `npm run build`.
- [ ] **Step 5:** live check in the browser (Playwright, Sample mode, port 8765 per the runbook pause/start routine): each built building's computer shows the left list, switching works, construction desktop shows for an unbuilt one. Screenshot to `.playwright-mcp/`.
- [ ] **Step 6: Commit** `Desk computers: Mac-style frame with a left glass app list`

### Task 4: Hold the scene behind the screen

**Files:** Create `frontend/src/belt/hold.tsx`; Modify `frontend/src/App.tsx` (provider), `frontend/src/interior/Robot.tsx`, `Gadget.tsx`, `DeskProps.tsx`, `WallPanels.tsx`, `Console.tsx`, `VaultDoor.tsx`, `frontend/src/belt/BeltScene.tsx` (Earth and sky, not the asteroid orbit); Test `frontend/tests/hold.test.ts`

**Interfaces:** `HoldProvider({hold, children})`, `useHold(): boolean`; pure `shouldAnimate({ hold, inView, keepMoving }: {...}): boolean` (true when `keepMoving`, else `!hold && inView`). App passes `hold = view.level === "screen"`. Each animated piece returns early in `useFrame` when `!shouldAnimate(...)`; asteroid orbit passes `keepMoving: true`. `inView` from the camera frustum against the object's bounding sphere, checked at most every 10 frames.

- [ ] **Step 1:** failing tests for `shouldAnimate` (hold → false; hold + keepMoving → true; out of view → false; in view, no hold → true).
- [ ] **Step 2–4:** fail; implement; pass; build.
- [ ] **Step 5:** live check: at a computer, robots and Earth still, asteroids moving; Back → robots animate again at once. Note frame time before/after (browser performance panel or `renderer.info`), record in the commit message.
- [ ] **Step 6: Commit** `Scene holds still behind the computer screen`

### Task 5: Robot monitor live view

**Files:** Create `frontend/src/interior/liveStat.ts`, `frontend/src/interior/useLiveStats.ts`; Modify `frontend/src/interior/workScreen.ts`, `frontend/src/interior/Monitor.tsx`; Test `frontend/tests/liveStat.test.ts`, update `frontend/tests/workScreen.test.ts`

**Interfaces:**
- `type LiveStat = { headline: string; gauge: number | null; style: "ring" | "bar" | "radar" }`.
- `liveStat(id: BuildingId, input: { dueToday?: number; overdue?: number; vaultBadge?: string | null; jobsBadge?: string | null }): LiveStat | null` — planner: `"3 due today"` (or `"All clear"`), ring; finance: the badge text or `"All in order"`, bar, gauge null; jobs: badge text or `"No checks due"`, radar; others: null.
- `useLiveStats(): Partial<Record<BuildingId, LiveStat>>` fetching only counts-only endpoints (open tasks → counts, `getVaultBadge`, `getJobsBadge`), refetch every 60 s; any error → that building omitted.
- `workScreen` gains `live: LiveStat | null` and stops returning task titles (`list` removed); Monitor draws the live view (large headline, ring/bar/radar) on the main tab and redraws its texture only when the live value changes or the tick advances.

- [ ] **Step 1:** failing tests: planner with 3 due → `"3 due today"`, 0 → `"All clear"`; finance with null badge → `"All in order"`; jobs `"2 platforms to check"` passes through; career → null; workScreen output has no task titles.
- [ ] **Step 2–4:** fail; implement; pass; build.
- [ ] **Step 5: Commit** `Robot monitors show their building's live counts`

### Task 6: Finish

- [ ] Clear caches; `npm test`, `npm run typecheck`, `npm run build`; backend `pytest -q` (unchanged, still green); gitleaks and blocked words via the commit hook.
- [ ] Live Sample run: belt → each built building → computer; screenshots of Mission Control, Vault and Opportunity Office computers.
- [ ] `graphify update .`; commit; open PR 1. Security checkpoint: not required (no locks, imports or AI paths change).
