# Tooling roadmap

Planned Claude Code skills, plugins and dev tools for this project.
Nothing gets installed without first showing the source repo, what it adds (hooks, MCP servers, scripts, network access) and the exact command, then getting approval.
Third-party marketplace auto-update stays off.

## Install now

| Tool | Source | Purpose |
|---|---|---|
| claude-code-setup | `claude-plugins-official` (Anthropic) | Analyses the repo and recommends Claude Code setup. Recommendations are reviewed, not auto-installed. |
| Superpowers | `obra/superpowers` | The single workflow framework for this project. |
| frontend-design | Anthropic official plugin | Design baseline for the 3D belt UI. SPEC.md section 7 design rules override this skill's style suggestions. |
| gitleaks pre-commit hook | Homebrew `gitleaks` | Blocks commits containing keys, tokens or account-number patterns. Hook lives in `.githooks/`, rules in `.gitleaks.toml`. False positives get a narrow allowlist entry, never a disabled rule. |
| Explore subagent (Haiku) | Project `.claude/agents/` | Only if the built-in Explore agent doesn't already use Haiku. Read-only tools. |
| Data-protection hook | Project `.claude/settings.json` (PreToolUse) | `.claude/hooks/protect-data.py`. Denies file and search tools (Read, Edit, Write, NotebookEdit, Grep, Glob) on the private data folder and any `.env` file; asks before editing the private spec or running shell commands that mention either. Fails closed (any error means ask). Applies to subagents too. Tests: `/usr/bin/python3 .claude/hooks/test_protect_data.py`. |
| Auto-format hook (ruff + prettier) | Project `.claude/settings.json` (PostToolUse) | `.claude/hooks/format-file.py`. After Edit/MultiEdit/Write, runs `ruff format` on Python files in the repo and `prettier --write` on frontend files, using the pinned local copies. Layout only, no lint fixes. Skips files outside the repo (links resolved), `.venv`, `node_modules`, `dist`, `.git`, the private spec and `.env` files. Never blocks an edit; no network. Tests: `/usr/bin/python3 .claude/hooks/test_format_file.py`. |
| Playwright MCP | `microsoft/playwright-mcp` (npm `@playwright/mcp@0.0.84`), project `.mcp.json` | Lets Claude open the local page, click through it and take screenshots during verification. Isolated in-memory browser profile, headless, browser requests limited to `http://127.0.0.1:5173` and `http://127.0.0.1:8765`. Version pinned; same 14-day rule as libraries. |
| Graphify | `Graphify-Labs/graphify` (PyPI `graphifyy==0.9.101`, pinned by the 14-day rule) | Code map I query before searching files. Installed 2026-11-17 in its own Python 3.13 environment (`~/.local/share/graphify-venv`, linked at `~/.local/bin/graphify`), separate from the app. Project-only setup: skill in `.claude/skills/graphify/`, a section in `CLAUDE.md`, and two PreToolUse hooks (`graphify hook-guard`) that only nudge toward the map and fail open. Maps code only and offline (`GRAPHIFY_BACKEND=none graphify extract . --code-only`; refresh with `graphify update .`); no semantic pass, so nothing leaves the Mac. `graphify-out/` is git-ignored; `.graphifyignore` also excludes the private spec, `.env` files and screenshots. Remove with `graphify uninstall --purge` and delete the venv. |
| security-audit | `cloudflare/security-audit-skill` (MIT), pinned to commit `c1c8a8c14710` | Installed 2026-11-26 at user level (`~/.claude/skills/security-audit/`), copied file by file from the reviewed commit (not `npx skills add`), so none of its files are in this repo. Instruction documents, a report schema and two Node.js validators that only read and write files: no hooks, no MCP servers, no network, installs nothing. Guidance mode (security questions, focused reviews) writes nothing. Full audit mode runs only on an explicit request, uses several helper agents (noticeably more usage) and writes its report to `~/security-audit-skill/ai-city/run-<N>/`, outside the repo. Run one full audit at the Phase 1b wrap-up, before the first README screenshots. Remove by deleting the folder. |

## Install later

Each item waits for its trigger. Check triggers at the start of each session and when a phase or building is done.

| Trigger | Tool | Notes |
|---|---|---|
| Code starts feeling bloated | ponytail (`DietrichGebert/ponytail`) | |
| A skill is needed that isn't on this list | find-skills (`vercel-labs/skills`) | Always review the source and `SKILL.md` first. |
| First building agent is working | eval-harness from `affaan-m/everything-claude-code` | That one skill only. |
| Starting the README or architecture docs | diagram-design (`cathrynlavery/diagram-design`) | |
| Starting Opportunity Office | career-ops (`santifer/career-ops`) | Reference only, cloned to a separate private folder outside this repo. Also run the resume parse check at this point (structure only). |
| Starting side-income research | last30days | API keys only, never browser cookies. |
| Belt UI still looks generic after frontend-design, or the planned visual pass of the plan and check-in screens starts | Impeccable vs Hallmark (`Nutlope/hallmark`, MIT) | Compare and install only one: both are anti-generic design skills that overlap with frontend-design. Copy files by hand after reading them, not with `npx skills add`. |
| Hitting usage limits | Headroom | |
| Demo video time | HyperFrames vs OpenMontage | Compare before choosing one. |
| Making custom skills | skill-creator (Anthropic skills repo) | |
| React Three Fiber or FastAPI APIs repeatedly come out wrong | context7 MCP | Sends library names and queries to an external service. |
| Before the first README screenshots | Full security audit with the installed security-audit skill, plus a personal-data check of the screenshots | Replaces the planned security-reviewer subagent. Complements gitleaks and the blocked-words check. |

## Do not install

| Tool | Reason |
|---|---|
| OmniRoute, claude-mem | Security and privacy concerns for this project. |
| Understand Anything | Duplicates Graphify. |
| REA | Not relevant. |
| gen-test (custom skill) | Overlaps Superpowers TDD. |
| caveman, i-have-adhd | Covered by existing `CLAUDE.md` rules. |
| GSD, BMAD Method, gstack, Karpathy skills, Matt Pocock skills | Overlap with Superpowers (Matt Pocock skills re-checked 2026-11-26: still overlap). |
| Community "security audit" skills from other authors | Cloudflare's security-audit skill (installed) and the built-in `/security-review` cover this; several community copies are unverified, and one was flagged for an obfuscated file. |
| UI UX Pro Max, taste, Archify, PPT Master, marketing skills, humanizer | Duplicate chosen tools or not relevant. |
| Any skill from an unknown author with no README, or one that asks for credentials, cookies or bank access | Unverifiable or requests access this project never grants. |
