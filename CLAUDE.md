# Asteroid Belt

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

## Security checkpoints
- Run a security audit (the installed `security-audit` skill, quick profile unless Steve picks another) at these checkpoints: when a phase ends, when a building is finished, before any public README screenshots or demo, and after a change to locks, the front door (`security.py`), file imports or anything an AI model can drive.
- At a checkpoint, say in one line that an audit is due and what it covers. A full audit uses many helper agents and a lot of usage, so before starting ask Steve to check his usage limit, and wait for his go-ahead. Never start one without that yes.
- Gitleaks and the blocked-words check still run on every commit, as now.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
