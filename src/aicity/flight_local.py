"""Flight School's local-model analysis: Ollama on this Mac turns a month's draft into proposals.

Used when [career] ai = "local". The draft and the context (existing skills, the 34
competencies, the resume's item ids) go only to Ollama at 127.0.0.1; nothing leaves the Mac.
The answer must be the same proposals JSON the Claude Code skill writes, and it goes
through the same checks; an unusable answer saves nothing.
"""

import json

import httpx

from aicity.competencies import LIMITS
from aicity.flight_proposals import FlightError, validate_proposals

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
TIMEOUT_S = 600  # a local model can take a few minutes on a long month

RULES = f"""You turn one month's work notes into proposals the owner approves one by one.
Only what the notes state: never add duties, numbers, results or tools that aren't there.
Main job at a general level: never names of people, clients or projects, documents, file or
system identifiers, room numbers or meeting details. Side roles described generically.
Competency examples are written as "I...", with situation <= {LIMITS["situation"]}, action <=
{LIMITS["action"]} and outcome <= {LIMITS["outcome"]} characters, at most one per competency.
Answer with JSON only: a list of {{"kind": ..., "payload": {{...}}}} where kind is one of
bullet {{text, skills, competencies}}, example {{competency, situation, action, outcome}},
new_skill {{name, category 1-7, level 1-5, related, competencies}}, level_change {{skill, to,
evidence}}, recommendation {{skill, kind task|course, title, provider, url or null, price,
free}}, resume_change {{section, action add|replace|remove, item id or null, text}}.
Use existing skill names exactly; add a new_skill before naming a new skill elsewhere."""

_UNUSABLE = "The local model's answer couldn't be used. Nothing was saved."


def analyse_local(draft: str, context: str, model: str, client: httpx.Client) -> list[dict]:
    if not draft.strip():
        raise FlightError("The month's draft is empty: add the dump first.")
    body = {
        "model": model,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": RULES},
            {"role": "user", "content": f"CONTEXT\n{context}\n\nNOTES FOR THE MONTH\n{draft}"},
        ],
    }
    try:
        response = client.post(OLLAMA_URL, json=body, timeout=TIMEOUT_S)
    except httpx.TransportError:
        raise FlightError("Start Ollama first.") from None
    if response.status_code != 200:
        raise FlightError(f"Ollama answered {response.status_code}; is the model downloaded?")
    try:
        content = response.json()["message"]["content"]
        data = json.loads(content)
    except (ValueError, KeyError, TypeError):
        raise FlightError(_UNUSABLE) from None
    if isinstance(data, dict) and set(data) == {"proposals"}:
        data = data["proposals"]
    try:
        return validate_proposals(data)
    except FlightError:
        raise FlightError(_UNUSABLE) from None
