# Opportunity Office: platform roster, Sunday scan and leads inbox (design)

> Public file. Example values only. The real platform list, sign-up stages, skills list and
> search keywords live in the private settings file and the Personal database.

## Why

Steve wants steady part-time or contract AI training, evaluation and agent-testing work alongside
his main job. Until now that meant ad-hoc Google searches and, for an earlier job hunt, a
hand-kept Notion tracker. He asked for a better process than that, not a copy of it: short,
concise and the same every week.

Research for this design (2026-11-20) changed the shape of the building:

- Most paid AI-training gigs are posted **inside** each platform after you join, behind a login.
  No feed can see them, and scraping is ruled out (spec section 12). So the way in is to be
  joined to several platforms with an active profile, not to chase job ads.
- Some companies publish **official public job lists** (Greenhouse, Ashby and Lever job-board
  APIs, built for embedding a company's openings on other sites). These are mostly staff jobs,
  but real contract roles do appear (e.g. remote AI red-teaming contracts at $65+/hr on one
  list on the day of research).
- General remote job boards with feeds are mostly low-paid noise for this kind of work.

Not urgent: Steve already has remote work and is happy in his main job. This building should
make the search cheap to keep up, not demand attention.

## Goals

1. **Platform roster.** One card per AI-training platform, each with a stage
   (Not joined → Applied → Assessment → Active → Quiet) and one next step
   ("finish the assessment", "not joined yet"). Platforms already joined start as Active.
2. **Automatic Sunday scan.** Sunday 7:00 PM (or on next open if overdue), read the official
   public job lists named in settings, filter, score and keep the top 10 new leads. One
   notification when ready. Each source is isolated: one failing shows a warning, the rest run.
3. **Paste a role.** For anything found elsewhere (an email invite, a search result): paste the
   link and the job text; the app fills in what it can (pay, type, Canada, remote) and Steve
   fixes the rest before saving. The link is stored, never fetched.
4. **One inbox.** Scan results and pasted roles in one ranked list. One tap each:
   Apply / Save / Skip. Applied leads move through Applied → Interview → Offer / Rejected, keep
   the date applied and a short resume-version label (e.g. "v3 Nov 2026").
5. **Follow-ups.** 10 days after applying with no status change, a Mission Control to-do
   appears ("Follow up: Company A, AI evaluator"), category side work.
6. **Weekly pass inside the Sunday check-in.** A compact Opportunity Office section: new leads
   (top 3 with Apply / Save / Skip), platform nudges, follow-ups due. Target: about 10 minutes.
   Steve expects to apply to 1–2 roles a week, not 10 (2026-11-20): the check-in and the top of
   Leads show the best 3, the rest sit behind "Show more", and **Skip the rest** clears the
   remaining new leads in one tap. The scan still keeps up to 10 for weeks with more time.
7. **Search profiles.** Filters, keywords and the temporary skills list live in named profiles in
   settings, not in code. One profile now ("AI training"); an engineering one later needs no
   rebuild.
8. **Background through one connection point.** Scoring asks one function for Steve's
   background. Today it returns the profile's temporary skills list; Flight School's Archive
   replaces it in Phase 2.
9. **Building finished on the belt.** Opportunity Office joins the built set: construction sign
   down, its radar-dish landmark up, belt badge ("N new leads", "N follow-ups"), desk computer
   apps instead of the "under construction" desktop.
10. **Sample mode** gets made-up platforms, leads in every state, and one ready-made
    "leads ready" notification. The scan never runs against real sources in Sample mode.

## Non-goals (now)

- **AI scoring.** No local-model reason or per-gap plan yet. Rules first; AI comes after
  Flight School exists (its Archive is the better input) and after an Ollama model is chosen.
  Spec section 6 still applies: per-building switch, off by default.
- **Reading the resume.** Opportunity Office never reads the resume file (Steve, 2026-11-20).
  The resume parse check moves to Flight School.
- **Resume tailoring and cover letters.** Flight School's job (Phase 2). Opportunity Office
  only keeps the hook: a lead can later ask Flight School for a tailored version.
- **Engineering roles.** Only the profile mechanism is built now.
- **Combining profiles.** Spec allows it later (information added across profiles on Steve's
  approval). Now: profiles stay separate; nothing copies between them.
- **Job Bank.** Its open data is monthly bulk files, not a search feed. Left out until a
  source with clear terms is found.
- **Auto-applying, scraping, fetching pasted links, LinkedIn or Indeed.** Never.

## Anti-goals (a failure even if it works)

- A weekly chore that takes longer than about 10 minutes, or nags.
- A feed full of full-time, US-only or under-$30 roles.
- A long-text screen. Information as chips, bars, counts and short labels (spec section 7).
- Any personal data in the public repo, demo data or screenshots.

## Constraints

- Spec sections 4 (privacy), 6 (AI off by default), 8 (filters: open to Canada; pay floor
  $30 USD/hr, $40+ preferred; CAD shown beside it at the Bank of Canada rate; ranges ranked by
  the low end, ranges straddling the floor flagged; contract or part-time, about 10–15 hrs/week;
  excludes full-time, physical work and online businesses; engineering-domain AI trainer roles
  allowed), 12 (official sources only).
- Each source's terms are checked before it is added to the example settings or the runbook.
  The scan sends no personal data: only plain GET requests to public endpoints.
- Leads roll off after 90 days unless applied (applied leads kept indefinitely, as all history).
- Existing patterns: STRICT SQLite tables via numbered migrations (next is 014), rows never
  hard-deleted, strict settings parsing with clear errors, `fx.py` for exchange rates, the
  reminder loop for scheduled checks (Personal only), notifications with shuttle/ticker/Mac,
  belt badges with counts only, desk apps listed in `frontend/src/desktop/apps.ts`, building
  built flag in `frontend/src/belt/built.ts`.

## Approaches considered

1. **Automatic weekly feed only** (the original spec wording). Honest yield would be a handful
   of roles a week, and it misses where most of the work actually is (inside platforms).
   Rejected as the whole building; kept as one part.
2. **A tracker for what Steve finds by hand** (a better Notion). Steve explicitly asked for
   something better than his old process. Rejected.
3. **Roster + scan + one inbox, run as part of the Sunday check-in** (chosen, Claude's design,
   accepted by Steve 2026-11-20). Puts effort where the work is (platform sign-ups), automates
   what official sources allow, and folds the weekly pass into a routine that already exists.

Scoring source: Steve agreed to a temporary skills list in settings rather than reading the
resume now, so scoring can be built and tested before Flight School, then reconnected and
re-tested once Flight School is built (expected to start within a week or two).

## Design

### Settings (`[jobs]`, private file; example values in `settings.example.toml`)

```toml
[jobs]
scan_day = "sun"            # default
scan_time = "19:00"         # default
top_n = 10                  # leads kept per scan
follow_up_days = 10
roll_off_days = 90

[[jobs.profiles]]
id = "ai_training"
name = "AI training"
active = true
pay_floor_usd = "30"
pay_preferred_usd = "40"
hours = [10, 15]
job_types = ["contract", "part_time", "temporary", "freelance"]
title_words = ["ai trainer", "evaluator", "red team", "annotator", "rater", "expert"]
exclude_words = ["full-time", "senior manager", "recruiter"]
location_ok = ["canada", "worldwide", "anywhere", "north america", "remote"]
skills = ["python", "technical writing", "mechanical design", "..."]   # temporary background

[[jobs.sources]]
id = "company_a"
name = "Company A"
kind = "greenhouse"         # greenhouse | ashby | lever
board = "companya"          # the board's public slug
profiles = ["ai_training"]
enabled = true

[[jobs.platforms]]
id = "platform_a"
name = "Platform A"
url = "https://example.com/experts"
start_stage = "active"      # optional; default not_joined
```

### Data (migration 014, STRICT, never hard-deleted)

- `job_platform_stages`: platform id, stage, next step (short text), changed at. History kept
  (one row per change; latest wins).
- `job_leads`: origin (scan source id or `pasted`), external id (scan) or none, url, title,
  company, location text, remote (yes/no/unknown), job type, pay low/high, pay currency, pay
  unit (hour/year/unknown), canada ok (yes/no/unknown), short description excerpt (capped),
  first seen, last seen, closed at (vanished from its source), status
  (new / saved / skipped / applied / interview / offer / rejected / expired), applied at,
  resume label. Unique on (origin, external id) for scanned leads.
- `job_lead_scores`: lead × profile: score 0–100, verdict (strong / maybe / skip), matched
  skills, gap words, flags (pay not listed, range straddles floor, Canada unknown).
- `job_scan_runs`: started, finished, per-source outcome (ok / failed with short reason, count).
- Notification kind `jobs` (leads ready). Follow-ups are Mission Control tasks, linked to the
  lead so a status change or a second run never makes a duplicate.

### Scoring (rules)

1. **Hard filters** (drop): not remote; location says a country list without Canada; job type
   full-time; known pay below the floor; title or text hits an exclude word.
2. **Kept with a flag:** pay not listed, Canada unknown, range straddling the floor.
3. **Score** from: skill overlap with the background (largest weight), pay (≥ preferred scores
   higher; ranges use the low end), hours fit, title match. Verdict: strong / maybe / skip.
4. **Gap words:** skills named in the posting from a small vocabulary in settings that aren't
   in Steve's background, shown as chips. (Plans per gap come with AI / Flight School later.)
5. Pay shown in USD with CAD beside it from `fx.py` (latest rate, its date shown).

Background comes from `background_for(profile)`; today it returns the profile's `skills`.

### Scan

- Sunday at `scan_time`, run by the reminder loop if the app is open; otherwise on next open
  when overdue. A **Scan now** button too. Personal database only.
- Each source fetched on its own with a timeout; a failure records a warning and the scan
  continues. Results upserted by (source, external id); leads missing from a source that
  answered get `closed at`. Same company + similar title within 30 days across origins is
  merged (career-ops idea: repost detection).
- New leads passing filters are scored; the top `top_n` stay `new`; the rest are kept but
  hidden behind "show all". One `jobs` notification if there's at least one new lead.

### Screens (desk computer apps: Leads, Platforms)

```
Leads                                          [Scan now] [+ Paste a role]
 New (4)   ★ $65–125 Company A · AI red teamer   82 ████████░  strong
                          python  writing  · gap: security        [Apply][Save][Skip]
 Saved (2) · Applied (3) · Closed
 Applied   Company C  applied Nov 12  ⏳ follow-up Nov 22   [Interview][Rejected]

Platforms
 ● Active      Platform A   Platform B
 ◐ Assessment  Platform C   → finish the test
 ○ Not joined  Platform D   Platform E   → apply
```

Apply asks for the resume label (remembers the last one). Platform cards change stage with one
tap and open the platform's URL. Paste a role shows the extracted fields as editable chips.

### Sunday check-in section

```
Opportunity Office   4 new · 1 follow-up · 2 platform steps
 ★ $65 AI red teamer  82   [Apply][Save][Skip]
 Platform C: finish the test        Company C: follow up
```

### Career-ops

Cloned to `~/Reference/career-ops` (MIT), read only, never run. Ideas reused and rewritten in
Python with credit in the code: the clear "don't apply" verdict, closed-posting detection,
repost detection, follow-up timing.

### Lock (spec section 4: career views and job applications are sensitive)

- The Leads and Platforms apps and all `/api/jobs` routes except the badge need Touch ID, once
  per app session, the same mechanism as the Vault (`vault_lock.py`), with its own unlock state.
- The belt badge is counts only ("4 new leads", "1 follow-up"), no names, without Touch ID.
- The check-in's Opportunity Office section shows counts only until unlocked; one tap unlocks
  (Touch ID) and shows the top 3 and steps. Sample mode: no lock (made-up data), same as Vault.
- Follow-up to-dos stay generic in Mission Control: "Follow up on an application" plus a link
  that opens the lead (behind the lock). No company name in the to-do list.

### Rules settled at review (Claude's calls, 2026-11-20)

- **Last week's untouched leads.** Each scan's top 10 replace the New list. Untouched leads from
  earlier scans move to "Earlier" (still savable or appliable) and stop counting in the badge
  and the check-in. They expire with the 90-day roll-off.
- **Platform stages.** Not joined / Applied / Assessment / Active / Quiet, where Quiet means
  joined but no work lately. Steve sets stages; nothing moves by itself. Each card can hold one
  next step. The check-in shows at most 2 platform steps, oldest-changed first; "Not now"
  snoozes a platform for 4 weeks. A platform with no next step never nudges.
- **Pay.** Hourly USD is used as is; hourly CAD is converted to USD with the inverse of the
  Bank of Canada rate. Yearly pay or any other currency counts as "pay not listed" (kept,
  flagged, ranked after leads with known pay) with the raw pay text shown. `fx.py` stays
  USD↔CAD only.
- **Reposts.** The first row survives; a later copy is stored with `merged_into` pointing at it
  and never shown. The survivor's status carries over (a skipped role stays skipped). A pasted
  role that matches a scanned lead joins it (the paste only fills empty fields).
- **Follow-ups.** One per application, made 10 days after Applied if the status hasn't changed.
  Finishing the to-do doesn't make another. Interview, Offer and Rejected never make one.
- **Filtered-out roles.** Stored with status `filtered` (hidden, public posting data only) so
  later scans skip them quickly; rolled off at 90 days. A pasted role that fails a filter is
  saved anyway with the reason shown as a chip (Steve chose to add it).

## Left to the builder

- Exact score weights and verdict thresholds (tested with fixtures; tune with Steve after a
  few real scans).
- Text extraction rules for pasted roles and descriptions (pay patterns, type, location).
- Split into PRs (suggested: settings + data + rules scoring; scan; screens + check-in +
  belt; follow-ups + Sample mode), following the daily-plan build's pattern.
- Fixture design: generated fake postings only (`tests/fixtures/`).
