"""Belt XP's settings: what earns XP, the daily caps and the level curve.

Everything here is tunable. Changing a value re-prices past work too, because XP is
worked out from the database each time and never stored.
"""

# The buildings earning XP now: the built ones, in step with frontend/src/belt/built.ts.
# "career" (Flight School) joins when its screens ship; its rules are already written.
EARNING_BUILDINGS: frozenset[str] = frozenset({"planner", "finance", "jobs"})

# What each event is worth. "A day" is a local day; no cap means every one counts.
TODO_XP = 10
TODOS_PER_DAY = 5
GYM_XP = 15
ROUTINE_XP = 5  # per routine per day
CHECKIN_XP = 40  # once per week

SIDE_WORK_ENTRY_XP = 10
PAY_CONFIRMED_XP = 15
STATEMENT_XP = 40  # once per statement month

CHECK_XP = 10
CHECKS_PER_DAY = 3
PROJECT_XP = 15
PROJECT_STAGE_XP = 20
PROFILE_REFRESH_XP = 20  # once per platform per month

MONTH_LOGGED_XP = 60  # once per month
EXAMPLE_XP = 25
STUDY_MINUTES_PER_XP = 5
STUDY_MINUTES_PER_DAY = 60

# Estimated XP in a year at a normal pace: what it takes to reach level 100.
NORMAL_YEAR_XP: dict[str, int] = {
    "planner": 17500,  # about 3 to-dos a day, 4 gym blocks a week, routines, every check-in
    "finance": 3200,  # mostly pay and a monthly statement
    "jobs": 4300,  # check rounds, plus the odd project and profile refresh
    "career": 2200,  # the monthly log, examples and some study
}

MAX_LEVEL = 100
CURVE_EXPONENT = 1.25  # above 1: early levels come faster, later ones slower


def xp_for_level(building: str, level: int) -> int:
    """Total XP needed to reach a level (level 1 needs none)."""
    return round(NORMAL_YEAR_XP[building] * ((level - 1) / (MAX_LEVEL - 1)) ** CURVE_EXPONENT)


def level_for_xp(building: str, xp: int) -> int:
    """The level, 1 to 100, that this much XP has reached."""
    return next(
        (level for level in range(MAX_LEVEL, 1, -1) if xp >= xp_for_level(building, level)), 1
    )
