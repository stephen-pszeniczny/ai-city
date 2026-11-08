# AI City

@SPEC.md

## Session rules
- Read SPEC.md (imported above) at the start of every session. It is the source of truth.
- Read the most recent note in `handoff/` before starting work, and write a new one at the end of each session.
- Anything marked **Not yet specified** in the spec must be asked, never assumed.
- Explain each step in plain language; give one recommendation with a one-line reason.
- Ask before anything that spends money, deletes data or affects privacy.
- SPEC.md is private: it is gitignored and must never be committed. Don't copy its personal details into any tracked file.
- Never commit personal data, day-job content, API keys, tokens, .env files or the resume. App data lives in `~/AI-City-Data`, outside the repo.
- `tests/fixtures/` may hold CSVs only because of a .gitignore exception. Fixtures must be generated fake data only, never copied or derived from real statements.
- After changing `.gitignore`, re-verify with `git status --ignored` before committing.

## Tooling
- `docs/tooling-roadmap.md` lists planned skills and plugins.
- At the start of each session and when a phase or building is done, check the Install later triggers. If one is met, say in one line which tool and why.
- Never install anything without showing the source repo, what it adds (hooks, MCP servers, scripts, network access) and the exact command, then waiting for a yes.
- Never suggest anything on the Do not install list.
