# AI City Runbook

How to run, back up, fix and recover AI City. Written to be followed when tired: do the steps in order, don't skip.

If something here is out of date, tell Claude Code: "the runbook is wrong about X, fix it."

---

## 1. Where things live

| What | Where | In GitHub? |
|---|---|---|
| Code | `~/Projects/ai-city` | Yes (public) |
| Your data (database, statements, resume, exports, logs) | `~/AI-City-Data` | **Never** |
| API keys and Gmail tokens | macOS Keychain | **Never** |
| Backups | External drive, encrypted | **Never** |

## 2. Start and stop the app

_To be filled in during Phase 1a._

## 3. Back up

_To be filled in when the external drive is set up (Phase 0)._

## 4. Restore from backup

_To be filled in when the external drive is set up (Phase 0)._

## 5. Update

### Code
_To be filled in during Phase 1a._

### Libraries (Python and Node packages)
_To be filled in during Phase 1a._

### Tools (Homebrew, Ollama, models)
_To be filled in when the first AI feature is built._

## 6. Common fixes

_Added as problems come up. Format: **Symptom** → what to do._

**After any fresh clone** → run `git config core.hooksPath .githooks` inside the repo. That setting isn't copied with the repo, and without it the gitleaks secret check won't run on commits. Needs `brew install gitleaks` first.

**A commit is blocked by gitleaks** → read the RuleID it printed. If it's a real secret or account number, follow section 7, Case A. If it's a false positive, ask Claude Code to add a narrow allowlist entry to `.gitleaks.toml`. Never disable the rule, and never use `--no-verify`.

---

## 7. 🚨 Emergency: a secret or personal data may have been committed

A "secret" is an API key, a Gmail token, a GitHub token or a password.
"Personal data" is anything from `~/AI-City-Data`: a statement, your resume, the database, email, day-job notes.

**Stay calm. Work out which case you're in, then follow only that section.**

```
cd ~/Projects/ai-city
git status          # is it only staged, or already committed?
git log origin/main..HEAD --oneline   # commits listed here have NOT been pushed yet
```

### Case A: it's staged but not committed

1. Unstage it: `git restore --staged <file>`
2. Move the file to `~/AI-City-Data` (or delete it if it's a stray copy).
3. Ask Claude Code to add a pattern to `.gitignore` so it can't happen again, then check: `git status --ignored`
4. Done. Nothing left your Mac.

### Case B: it's committed but NOT pushed

The commit is still only on your Mac.

1. **Do not push.**
2. If it's in the most recent commit:
   ```
   git rm --cached <file>
   git commit --amend --no-edit
   ```
3. If it's in an older commit, stop and ask Claude Code: "a secret is in an unpushed commit, remove it from history." Don't try to rewrite history from memory.
4. Confirm it's gone: `git log --all --stat | grep <filename>` should print nothing.
5. Add a `.gitignore` pattern (as in Case A).
6. A secret that never left the Mac doesn't need replacing, but replacing it anyway is cheap peace of mind.

### Case C: GitHub blocked the push ("push protection")

Push protection did its job, and nothing went public.

1. **Do not click "allow" or use the bypass link GitHub shows.**
2. Follow Case B to remove the secret from your unpushed commits, then push again.

### Case D: it's already on GitHub (public)

Assume it was copied within minutes: bots scan public repos constantly. Deleting the file does **not** undo that, because it stays in the history.

**Step 1: Kill the secret first. Do this before anything else.**

| What leaked | Where to revoke it |
|---|---|
| Claude API key | console.anthropic.com → API Keys → delete the key, then create a new one |
| Gmail / Google token | myaccount.google.com → Security → Your connections to third-party apps → remove AI City |
| GitHub token | github.com → Settings → Applications → revoke; then run `gh auth login` again |
| Any other key | That service's dashboard → revoke / regenerate |

Put the new key in the Keychain (never in a file in the repo).

**Step 2: Check for misuse.**
- Claude API: console.anthropic.com → Usage and Billing. Look for activity you don't recognise.
- Google: myaccount.google.com → Security → Recent security activity.
- GitHub: Settings → Security log.

**Step 3: If it was personal data rather than a key** (you can't "revoke" a statement or a resume):
1. Make the repo private temporarily: GitHub repo → Settings → General → Danger Zone → Change visibility → Private.
2. Continue with Step 4, then contact GitHub Support (support.github.com) and ask them to remove cached views of the commit.
3. If anyone forked the repo, their copy keeps it. Tell GitHub Support about the forks too.

**Step 4: Clean the history.** Ask Claude Code: "remove `<file>` from all git history and force-push." It will use `git filter-repo`. Check afterwards on github.com that the file is gone from the commit history.

**Step 5: Prevent a repeat.** Add a `.gitignore` pattern, re-check with `git status --ignored`, and record what happened in the next handoff note in general terms (never the secret itself).

**Step 6:** If you made the repo private in Step 3, switch it back to public. Then confirm secret scanning and push protection are still on: repo → Settings → Advanced Security.
