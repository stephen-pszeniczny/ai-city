"""Flight School's local-model path (Ollama on this Mac). A fake Ollama answers; no real model."""

import json

import httpx
import pytest

from aicity.flight_local import OLLAMA_URL, analyse_local
from aicity.flight_proposals import FlightError

GOOD = [
    {
        "kind": "example",
        "payload": {"competency": "2.1", "situation": "S", "action": "A", "outcome": "O"},
    }
]


def client_answering(content=None, *, status=200, raise_exc=None, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if raise_exc is not None:
            raise raise_exc(request)
        return httpx.Response(status, json={"message": {"role": "assistant", "content": content}})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_a_good_answer_becomes_validated_proposals():
    seen = []
    items = analyse_local(
        "Did things.", "CONTEXT", "some-model:8b", client_answering(json.dumps(GOOD), seen=seen)
    )
    assert items == GOOD
    [req] = seen
    assert req.url.host == "127.0.0.1" and str(req.url) == OLLAMA_URL
    body = json.loads(req.content)
    assert body["model"] == "some-model:8b" and body["stream"] is False
    assert "Did things." in json.dumps(body) and "CONTEXT" in json.dumps(body)
    assert "Only what" in body["messages"][0]["content"]  # the rules go in the system prompt


def test_an_object_wrapping_the_list_is_accepted():
    answer = json.dumps({"proposals": GOOD})
    assert analyse_local("x", "", "m", client_answering(answer)) == GOOD


@pytest.mark.parametrize(
    "content", ["not json", json.dumps([{"kind": "poem", "payload": {}}]), json.dumps({"other": 1})]
)
def test_an_unusable_answer_saves_nothing(content):
    with pytest.raises(FlightError, match="couldn't be used. Nothing was saved."):
        analyse_local("x", "", "m", client_answering(content))


def test_ollama_not_running():
    def refuse(request):
        return httpx.ConnectError("refused", request=request)

    with pytest.raises(FlightError, match="Start Ollama first."):
        analyse_local("x", "", "m", client_answering(raise_exc=refuse))


def test_ollama_error_status():
    with pytest.raises(FlightError, match="Ollama"):
        analyse_local("x", "", "m", client_answering("[]", status=404))


def test_empty_draft_is_refused():
    with pytest.raises(FlightError, match="draft"):
        analyse_local("   ", "", "m", client_answering(json.dumps(GOOD)))
