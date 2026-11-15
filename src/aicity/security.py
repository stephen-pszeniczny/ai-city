"""The front door lock: checks every request before it reaches the app.

Rule 1 (Host check): the request must be addressed to this app on this Mac.
    Blocks "DNS rebinding", where a malicious website makes the browser
    think its own domain is 127.0.0.1 and then talks to local apps.

Rule 2 (Origin check): any request that could change data (anything other
    than GET or HEAD) must say it came from the app's own page. Blocks other
    websites open in the browser from sending commands to the app.

GET and HEAD are reading-only by convention in this app: no GET endpoint
may ever change data, which is why they skip rule 2.

Refusals never repeat the rejected header back, so nothing odd gets echoed.
"""

from collections.abc import Iterable

from starlette.types import ASGIApp, Receive, Scope, Send

from aicity import config

SAFE_METHODS = frozenset({"GET", "HEAD"})
LOCAL_NAMES = ("127.0.0.1", "localhost")


def allowed_hosts(dev: bool) -> frozenset[str]:
    """Host header values the app answers to."""
    ports = [config.PORT] + ([config.DEV_PORT] if dev else [])
    return frozenset(f"{name}:{port}" for name in LOCAL_NAMES for port in ports)


def allowed_origins(dev: bool) -> frozenset[str]:
    """Origin header values allowed to change data."""
    return frozenset(f"http://{host}" for host in allowed_hosts(dev))


class FrontDoorMiddleware:
    """Applies the Host and Origin rules to every HTTP request."""

    def __init__(self, app: ASGIApp, *, dev: bool) -> None:
        self.app = app
        self.hosts = allowed_hosts(dev)
        self.origins = allowed_origins(dev)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = _headers(scope["headers"])

        if headers.get("host", "").lower() not in self.hosts:
            await _refuse(scope, receive, send, 400, "Unrecognised host.")
            return

        method = scope.get("method", "GET")
        needs_origin = scope["type"] == "websocket" or method not in SAFE_METHODS
        if needs_origin and headers.get("origin", "").lower() not in self.origins:
            await _refuse(scope, receive, send, 403, "Request not from the app's own page.")
            return

        await self.app(scope, receive, send)


def _headers(raw: Iterable[tuple[bytes, bytes]]) -> dict[str, str]:
    """Header names lowercased. A header sent twice is treated as invalid."""
    result: dict[str, str] = {}
    for name, value in raw:
        key = name.decode("latin-1").lower()
        result[key] = "" if key in result else value.decode("latin-1").strip()
    return result


async def _refuse(scope: Scope, receive: Receive, send: Send, status: int, message: str) -> None:
    if scope["type"] == "websocket":
        await send({"type": "websocket.close", "code": 1008})
        return
    body = ('{"detail":"' + message + '"}').encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
