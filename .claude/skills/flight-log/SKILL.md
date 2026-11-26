---
name: flight-log
description: Flight School's monthly run. Use when the owner says it's time to log a month for Flight School, runs /flight-log, or the Mission Control to-do "Log last month for Flight School" is due. Turns his monthly brain dump into log bullets, competency examples, skill updates, recommendations and resume changes, each approved by him.
---

# Flight School monthly log

You turn the owner's dump of last month into proposals he approves one by one. You never
apply anything yourself; the helper saves proposals and his decisions apply them.

All commands run from the repo root with `.venv/bin/python scripts/flight.py …`.

## Steps

1. **Month.** Default is last month (`YYYY-MM`). Confirm it in one line.
2. **Collect the dump.** Ask him to paste or type what he did that month: main-job work at a
   general level, side roles without anything confidential, and any rough notes from his
   tablet. He may share photos of handwritten pages: read them and use only the text; never
   save, copy or describe the images anywhere else. Daily detail isn't expected.
3. **Save the draft** (add to it if he sends more):
   `printf '%s' "<the text>" | .venv/bin/python scripts/flight.py save-draft 2026-11`
   (use a quoted heredoc for long text). Show him nothing he didn't write.
4. **Read the context:** `flight.py draft 2026-11` and `flight.py context` (existing skills
   and levels, the 34 competencies marked ready or empty, open recommendations, and the
   resume's sections with each item's id).
5. **Draft proposals** following the rules below, as a JSON list of `{"kind", "payload"}`:
   - `bullet`: `{text ≤ 300, skills: [names], competencies: [ids]}`: 3 to 8 per month.
   - `example`: `{competency, situation ≤ 300, action ≤ 1650, outcome ≤ 300}`: only where the
     month truly shows that competency; prefer **empty** ones; written as "I…".
   - `new_skill`: `{name ≤ 60, category 1–7, level 1–5, related: [existing names], competencies: [ids]}`.
   - `level_change`: `{skill, to, evidence ≤ 300}`: only with clear evidence from the month.
   - `recommendation`: `{skill, kind: task|course, title, provider, url (https) or null,
     price, free}`: 1 to 3. Free first; a paid course or certification only when clearly worth
     it, with its price. You may web-search **course topics only** (never his notes) for current
     options and prices.
   - `resume_change`: `{section, action: add|replace|remove, item: id or null, text ≤ 300}`:
     `item` is the id shown by `context` (null when adding). Only for things worth a resume
     line; one or two a month at most.
6. **Save them:** write the JSON to this session's scratch folder (never inside the repo), then
   `flight.py propose 2026-11 <file>`. If it's refused, fix the item it names and try again.
7. **Review with him, one at a time:** `flight.py pending 2026-11`; show each proposal as a few
   short lines; he says accept, edit or reject. For an edit, write his edited payload to a file
   and run `flight.py decide <id> edit <file>`; otherwise `flight.py decide <id> accept|reject`.
   Accept the `new_skill` proposals before level changes or recommendations that name them.
8. **Finish:** `flight.py status 2026-11`. Tell him in two or three lines what changed
   (competencies ready, skill levels, resume changes). The month's to-do ticks off by itself.

## Rules

- **Only what he stated.** Never add duties, numbers, results or tools he didn't mention.
  Never inflate.
- **Main job at a general level:** tasks, skills used, milestones, lessons. Never names of
  people, clients or projects, never drawings, documents, file or system identifiers, room
  numbers, or meeting details. If the dump contains any, leave them out and tell him.
- **Side roles described generically,** with nothing confidential from any platform.
- **Competency examples** follow the regulator's format and limits; one example per
  competency per month at most.
- **Propose, never apply.** Every change waits for his decision.
- Keep everything you show short: bullets and chips, not paragraphs.
