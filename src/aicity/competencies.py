"""The engineering regulator's competencies for the professional engineering application.

34 competencies in 7 categories. Each needs a work example written as situation,
action taken and outcome ("I..."), within the character limits below. Copied from the
regulator's competency-based assessment application form (February 2026 edition),
with wording for 1.1, 1.2, 1.6 and 5.1 completed from its experience records form
(August 2026). "Professional standards" marks the competencies the form flags as such.
Re-check against the current forms before applying.
"""

from dataclasses import dataclass

SOURCE = (
    "Competency-based assessment application form (Feb 2026) and experience records form (Aug 2026)"
)

CATEGORIES: dict[int, str] = {
    1: "Technical competence",
    2: "Communication",
    3: "Project and financial management",
    4: "Team effectiveness",
    5: "Professional accountability",
    6: "Social, economic, environmental and sustainability",
    7: "Continuing professional development",
}

# Characters allowed in each part of a work example.
LIMITS = {"situation": 300, "action": 1650, "outcome": 300}


@dataclass(frozen=True)
class Competency:
    id: str
    category: int
    name: str
    professional_standards: bool = False


def _c(id_: str, name: str, standards: bool = False) -> Competency:
    return Competency(id_, int(id_.split(".")[0]), name, standards)


COMPETENCIES: tuple[Competency, ...] = (
    _c(
        "1.1",
        "You demonstrate knowledge of the regulations, codes and standards used in Canada "
        "or the international equivalent, including relevant local engineering procedures and "
        "practices.",
        True,
    ),
    _c(
        "1.2",
        "You understand the materials, operations, project and design constraints that best "
        "fit the intended purpose and can address interdisciplinary impacts.",
    ),
    _c("1.3", "You analyze technical risks and propose solutions to reduce them."),
    _c("1.4", "You apply engineering knowledge to design solutions."),
    _c("1.5", "You understand solution methods and can independently verify the results."),
    _c(
        "1.6",
        "You know the safety regulations, codes, and standards used in Canada or the "
        "equivalent international standard.",
        True,
    ),
    _c("1.7", "You understand systems and components of systems."),
    _c(
        "1.8",
        "You have been exposed to the stages of a process or project life cycle, from "
        "concept and feasibility analysis through implementation.",
    ),
    _c("1.9", "You understand the roles of peer review and quality management.", True),
    _c(
        "1.10",
        "You can transfer design intentions and information to drawings and design documents.",
    ),
    _c(
        "2.1",
        "You demonstrate effective verbal communication skills when interacting with team "
        "members, clients, contractors and the public.",
    ),
    _c(
        "2.2",
        "You demonstrate effective written communication skills when interacting with team "
        "members, clients, contractors and the public.",
    ),
    _c("2.3", "You can review essential documents.", True),
    _c("3.1", "You understand project management principles."),
    _c("3.2", "You take on progressive responsibility in project planning and execution."),
    _c("3.3", "You adjust expectations based on available resources."),
    _c("3.4", "You understand the financial aspects of the work."),
    _c("3.5", "You request and respond to feedback."),
    _c("4.1", "You collaborate respectfully with others, including those from other disciplines."),
    _c("4.2", "You work to resolve differences."),
    _c(
        "5.1",
        "You can apply the Code of Ethics principles or its international equivalent "
        "standard in the engineering environment.",
        True,
    ),
    _c("5.2", "You are aware of your scope of practice and professional limitations."),
    _c("5.3", "You understand how conflict of interest affects professional practice."),
    _c("5.4", "You understand professional accountability."),
    _c("5.5", "You understand the appropriate use of the stamp and seal."),
    _c("5.6", "You understand your strengths and weaknesses and how they affect your work."),
    _c(
        "6.1",
        "You know the safeguards to protect the public and methods to mitigate adverse impacts.",
    ),
    _c("6.2", "You understand the relationship between engineering activity and the public.", True),
    _c("6.3", "You understand the role of regulatory bodies in the practice of engineering."),
    _c(
        "6.4",
        "You are aware of specific sustainability clauses added to practice guidelines "
        "applicable to your area.",
    ),
    _c(
        "6.5",
        "You consider how sustainability principles could be applied and promoted in your "
        "specific engineering work.",
    ),
    _c("7.1", "You demonstrate completion of professional development activities."),
    _c("7.2", "You are aware of your knowledge gaps and areas requiring development."),
    _c(
        "7.3",
        "You have a professional development plan to address knowledge gaps and stay "
        "current in your practice.",
    ),
)

_BY_ID = {c.id: c for c in COMPETENCIES}


def competency(id_: str) -> Competency:
    """The competency with this id ("2.1"). Raises KeyError for an unknown id."""
    return _BY_ID[id_]
