# Flight School: monthly log, competencies, resume and skills web (design)

> Public file. Example values only. Real logs, examples, skills, levels and the resume live in
> the Personal database; the owner's settings live in the private settings file.

## Why

The owner wants one place to track the experience and knowledge he builds at his main job and in
side roles, to see his growth over time, and to build toward a professional engineering licence
(a professional engineering designation) and an up-to-date resume. Daily notes are scribbled and incomplete, so the
system can't rely on daily recaps: it works from one monthly brain dump.

The engineering regulator's process is competency-based: 34 competencies in 7 categories, each needing a
work example written as situation, action taken and outcome ("I…"), within character limits,
signed off by a registered engineer. Flight School builds that record month by month.

## Goals

1. **Monthly log.** On the 1st, a Mission Control to-do ("Log last month for Flight School") and
   a shuttle reminder. The owner writes a dump of last month (main-job work at a general level,
   side roles without disclosures, pasted tablet notes; photos of handwritten pages may be shown
   to the model). Drafts save; the month can be added to over several days.
2. **Analysis, approved item by item.** The model turns the dump into: log bullets, resume
   changes, competency examples, skill-level changes, new skills and recommendations. Each is a
   proposal the owner accepts, edits or rejects. Nothing is added that he didn't state.
3. **Archive.** Each finished month is saved: its bullets, the examples it produced and its
   progress check. Any month can be reopened.
4. **Competencies.** All 34, grouped in their 7 categories, each with zero or more examples
   (draft or ready). Coverage shown as "N / 34 ready".
5. **Master resume.** Kept as sections, imported once from the owner's Word file (reviewed before
   saving). Approved changes apply in one click; each change bumps an automatic version label
   ("v5 Nov 2026"), the label Opportunity Office's profile snapshots refer to. A fresh Word file
   is exported on demand.
6. **Skills web.** Every skill is a glowing orb coloured by its competency category and sized by
   level, linked to related skills and to the competencies it supports; competencies still to do
   are visible. Clicking an orb shows its level, its evidence and its recommendations.
7. **Levels.** 1 to 5. Starting levels set once by the owner (suggested from the resume import);
   each month the model proposes changes with the evidence shown; the owner approves.
8. **Recommendations.** Per skill: tasks and courses. Free first; a paid course or certification
   only when clearly worth it, with its price. Any recommendation can be sent to Mission
   Control's to-do list with one tap. The app never buys anything.
9. **Study.** A weekly target that starts at 0 hours and can be raised in the app. Minutes can be
   logged with or without a target, against a skill or course. Study is planned only through a
   **Study** chip in the Sunday check-in, added only when tapped.
10. **Progress check.** Made with each monthly run: competencies ready (+N), skill level changes,
    study time, resume version. A growth timeline stacks the months. It reports; it never nags.

## Non-goals (now)

- Tailoring the resume per job, cover letters (later, for engineering roles).
- Daily logging or reminders more often than monthly.
- Reading the owner's calendar, email or files on its own.
- Data Core's second brain (Phase 4). The web display is built so Data Core can reuse it.
- Flight School's screens in today's style: they are built after the computer overhaul.

## Anti-goals (a failure even if it works)

- A long-text screen (spec section 7): chips, bars, orbs and short labels.
- A resume or competency example that says more than the owner stated, or inflates it.
- Main-job specifics stored or shown: no drawings, documents, identifiers, names or meeting
  details (spec section 5). The dump screen shows these rules as chips.
- Anything sent, published or bought without the owner's action.
- A study plan that fills free time or turns red.

## Constraints

- Career data is sensitive (spec section 4): every Flight School route needs Touch ID once per
  app session in Personal mode (a third lock, like the Vault's and Opportunity Office's); the
  belt badge is a count only. Sample mode has made-up data and no lock.
- **AI (owner's decision):** default is Claude Opus 5.5 run by the owner inside Claude Code on his
  plan: no API key, no extra cost. A setting switches to the local model (Ollama), with an
  **Analyse** button in the app. Both paths produce the same proposals file. Only the dump text
  (and, with Opus, any photos the owner shows in the session) reaches the model. Photos are never
  stored. During an Opus run, web searches are limited to course topics, never the owner's notes.
- Rows are never hard-deleted; STRICT tables via numbered migrations; strict settings parsing;
  the Mission Control to-do and the reminder follow the statement reminder's pattern.
- Word import and export need `python-docx` (MIT): a new dependency, shown to the owner and
  approved before it's added (14-day rule, pinned). The local model, if the owner switches to it,
  is a multi-gigabyte download from Ollama's library: also shown and approved first.
- The monthly to-do and any recommendation sent to Mission Control are ordinary to-dos (category
  personal; Claude's call), worded generically ("Log last month for Flight School").

## Approaches considered

1. **How the model reads the dump and saves proposals.** (a) A local command-line helper,
   `scripts/flight.py` (chosen): `draft YYYY-MM` prints the month's dump; `propose FILE` checks a
   proposals file against a schema and saves it as pending proposals. Runs as the owner in his
   terminal, so no Touch ID prompt is needed. (b) The model calling the app's web routes: a Touch
   ID unlock every run and more moving parts. Rejected.
2. **How the skills web is drawn.** (a) The 3D engine the belt already uses (React Three Fiber)
   with a small hand-written spring layout (chosen): real glow and motion, no new library,
   reusable by Data Core. (b) A flat 2D graph library: less glow and a new dependency. Rejected.
3. **Order.** (a) Flight School first in today's style: its screens get built twice. (b) The
   overhaul first: Flight School waits longest. (c) **Engine first, then the overhaul, then
   Flight School's screens in the new style** (chosen).

## Design

### Settings (`[career]`, private file)

```toml
[career]
ai = "claude_code"          # claude_code (default) | local
local_model = "a-local-model:tag"   # only used when ai = "local"
reminder_day = 1            # day of the month for the to-do and reminder (1 to 28)
```

The weekly study target lives in the database (changed in the app), starting at 0.

### Data (one migration, STRICT, never hard-deleted)

- **Competencies** are fixed reference data in code (id like `2.1`, category 1 to 7, name),
  copied from the regulator's current competency guide, with the source and date noted.
- `fs_months`: month (YYYY-MM), draft text, status (draft, proposed, done), updated at.
- `fs_proposals`: month, kind (bullet, resume_change, example, level_change, new_skill,
  recommendation), payload JSON, status (pending, accepted, edited, rejected), decided at.
- `fs_bullets`: accepted log bullets per month (text, optional skill and competency links).
- `fs_examples`: competency id, month, situation, action, outcome (the regulator's character limits
  enforced), status (draft, ready).
- `fs_skills`: name, primary competency category (its colour), level 1 to 5, created at;
  `fs_skill_links`: skill↔skill (related) and skill↔competency (supports), with a strength.
- `fs_level_events`: skill, from, to, evidence references, approved at (history of levels).
- `fs_recommendations`: skill, kind (task, course), title, provider, URL (https), price text,
  free flag, status (open, done, dismissed, sent), linked Mission Control task.
- `fs_study`: date, minutes, optional skill or recommendation; `fs_study_target`: minutes per
  week with the date it changed (history kept).
- `fs_resume_sections` and `fs_resume_items` (the master resume as ordered sections and items);
  `fs_resume_versions` (label, created at, snapshot JSON).
- `fs_progress`: one row per finished month (the progress-check numbers).

### The monthly run

1. The to-do and reminder appear on `reminder_day` if last month isn't done.
2. The owner writes the dump in Flight School → **Monthly log** (draft autosaves).
3. **Opus (default):** in Claude Code the owner runs the project skill `/flight-log`. It runs
   `scripts/flight.py draft 2026-11`, reads the dump (and any photos the owner adds in the chat),
   applies the rules below, optionally web-searches courses, writes a proposals file and runs
   `scripts/flight.py propose`. **Local:** the app's **Analyse** button sends the dump to Ollama
   on the Mac with the same rules and saves the same proposals.
4. The owner reviews proposals in the app; accepting applies them (bullets, examples, levels,
   skills, resume items, recommendations). When none are pending, the month is done: the progress
   check is saved, the resume version bumps if it changed, and the to-do ticks off.

**Rules the model follows** (in the skill file and the local prompt): only what the dump states;
general level for the main job (no names, documents, identifiers, meeting details); "I"
statements; the regulator character limits for examples; free-first courses with prices; propose, never
apply.

### Until the screens exist (Claude's call)

The engine ships before the overhaul, so the first monthly runs (from 1 December) happen entirely
in Claude Code: the owner pastes or writes the dump in the chat (`scripts/flight.py save-draft
2026-11` stores it), `/flight-log` proposes, and the owner accepts, edits or rejects each item in
the chat (`scripts/flight.py decide`). The Mission Control to-do says to run `/flight-log`. The
in-app Monthly log tab replaces this once the screens exist; the helper keeps working either way.

### Skills web: visual design

The web lives in Flight School's **Skills** tab: a dark, deep-space canvas inside the window.

- **Nodes.**
  - *Category hubs* (7): larger translucent rings in their category colour, labelled, anchoring
    the web like star systems.
  - *Competency nodes* (34): small solid discs around their hub. **Ready** (has a ready
    example): lit, with a soft glow. **Still to do**: hollow, grey, with a slowly pulsing dashed
    ring.
  - *Skill orbs*: glowing spheres in their primary category colour. **Size by level:** radius
    grows with the square root of the level, so level 5 looks clearly bigger without swamping
    the web. Each orb has a bright core, a fresnel rim (edges glow brighter than the middle), an
    additive halo sprite, and a gentle bloom pass.
- **Colours.** Seven distinct hues tuned for black backgrounds and checked for contrast, kept
  within the app's blue, grey and black theme (no neon clash). A legend chip row names them.
- **Edges.** Thin lines in a blend of their two ends' colours; brightness follows link
  strength. Faint particles drift along skill→competency links ("evidence flowing in").
- **Layout.** A spring simulation: links pull together, all nodes push apart, hubs are gently
  pinned in a ring; it settles in about a second and then breathes slightly (a slow drift, a
  1–2 % pulse in orb glow).
- **Interaction.** Drag to orbit, scroll to zoom, right-drag to pan. Hover an orb: it brightens,
  its neighbours stay lit, everything else dims to 20 %, and a Liquid Glass label shows name and
  level. Click: the camera eases to it and a side panel opens with level (with history), evidence
  (bullets, examples, platform assessments), recommendations and "send to to-dos". A **Still to
  do** chip row lists empty competencies; clicking one flies to it.
- **Moments.** An approved level-up plays a ring pulse and the orb grows smoothly over about
  0.6 s; a new skill fades in and is pulled into place by its links.
- **Comfort and speed.** Reduced motion turns off drift, particles and camera easing.
  Instanced meshes keep it smooth with a few hundred nodes; it pauses when hidden. Pure layout
  and sizing functions are tested on their own; the drawing reuses the belt's engine.

### Screens (built after the overhaul, in its style)

Tabs: **Monthly log** (dump, guardrail chips, proposals to review), **Archive** (months, each with
bullets, examples, progress check), **Competencies** (7 categories, 34 rows, coverage bar),
**Skills** (the web), **Resume** (sections, version, export), **Study** (logged time, target).
The belt badge: "Log due" when last month isn't done, else nothing. Sunday check-in: a **Study**
chip beside the usual events.

## Left to the builder

- Exact colours (contrast-checked), glow and bloom strengths, spring constants.
- The local model's choice and prompt wording (tested against fixture dumps).
- Word import's mapping of headings to sections (the owner reviews before saving).
- How the regulator's competency names and limits are stored (with source and date).
- Splitting into PRs (suggested: data + competencies + settings + lock + monthly to-do; helper
  + skill + proposals; resume import and export; then the screens after the overhaul).
