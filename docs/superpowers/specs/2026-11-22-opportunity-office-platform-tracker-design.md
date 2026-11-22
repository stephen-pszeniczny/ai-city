# Opportunity Office: platform tracker (design)

> Public file. Example values only. The real platform list, statuses, pay ranges, domains and
> projects live in the private settings file and the Personal database.
>
> Replaces the 2026-11-20 design (roster + automatic scan + leads inbox).

## Why the change

A real scan of nine official public job lists (2026-11-22) read 509 postings and found 0
suitable roles: public lists hold the companies' own staff jobs, while paid AI-training work is
posted inside each platform behind a login. No app may log in for the owner (accounts could be
banned; spec sections 4 and 12). So the building tracks platforms instead of scanning feeds.

## What it does

1. **Platform roster.** One card per platform: status (not applied, applied, assessment,
   onboarding, active, paused, rejected), date last checked, date the profile was last updated,
   assessments passed, a typical hourly pay range typed by the owner, and a plain link to the
   platform's login page. No credentials, nothing fetched.
2. **Check rounds.** Each status has a check interval: active every 3 days; applied, assessment
   and onboarding weekly; paused monthly; not applied and rejected never. The round sits inside
   the Sunday check-in: it lists only platforms due; each gets **Open** (the link), **Nothing
   new** (stamps the date) or **Found something** (opens the log form). Between Sundays the belt
   badge shows how many platforms are due (count only).
3. **Opportunity log.** A project found on a platform: the platform, a generic title the owner
   writes, hourly pay and currency (USD or CAD), hours a week. No description and nothing copied
   from the platform (project pages are usually confidential). Status: found → applied →
   assessment → accepted or rejected → active → ended. Pay below the floor ($30 USD/hr in the
   example) is flagged; CAD shown beside USD at the Bank of Canada rate. Active projects' platform
   names are offered as companies in The Vault's side-work form.
4. **Profile snapshots.** Per platform: the resume version label submitted, domains claimed,
   assessments passed. A refresh nudge when the profile is 90+ days old or its resume label
   differs from the current master resume label.

Locked with Touch ID like the Vault; the badge is counts only. Sample mode has made-up platforms
and projects. Scoring is parked.

## Settings (`[jobs]`)

```toml
[jobs]
pay_floor_usd = "30"
pay_preferred_usd = "40"
master_resume_label = "v1 Nov 2026"   # optional; Flight School will own it later

[jobs.check_days]                      # optional; these are the defaults
active = 3
applied = 7
assessment = 7
onboarding = 7
paused = 30

[[jobs.platforms]]
id = "platform_a"
name = "Platform A"
url = "https://example.com/login"
start_status = "active"                # optional; default not_applied
```

## Removed from the first build

The leads inbox, rules scoring, posting-text reader, search profiles and the leads, scores and
scan-run tables (empty in the Personal database; approved 2026-11-22). The roster's stage
history, the Touch ID lock and the counts-only badge are kept and extended.
