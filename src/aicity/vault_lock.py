"""A building's Touch ID lock: asked once per app session, enforced by the server.

The Vault and Opportunity Office each have their own lock (and their own keys).

unlock() shows the Mac's own Touch ID prompt (password as the backup), the
same one the Personal mode switch uses, and hands back a random key. The page
keeps that key in memory only and sends it with every Vault request in
Personal mode. The key stops working when the page reloads (it's gone), the
app restarts (a new lock knows no keys), or the mode changes (forget()).
"""

import secrets
import threading
from collections.abc import Callable

from aicity.mode import OwnerCheck, SwitchBusy, SwitchRefused, SwitchUnavailable, ask_owner


class VaultLock:
    def __init__(
        self, ask: Callable[[], OwnerCheck] = ask_owner, *, place: str = "The Vault"
    ) -> None:
        self._ask = ask
        self._place = place
        self._key: str | None = None
        self._waiting = threading.Lock()

    def unlock(self) -> str:
        """Ask for Touch ID and return a fresh key. Only the newest key works."""
        if not self._waiting.acquire(blocking=False):
            raise SwitchBusy("Already waiting for Touch ID.")
        try:
            answer = self._ask()
            if answer == OwnerCheck.UNAVAILABLE:
                raise SwitchUnavailable(
                    "Touch ID isn't available. Run scripts/build_touch_id_helper.py once, "
                    "then try again."
                )
            if answer != OwnerCheck.CONFIRMED:
                raise SwitchRefused(f"Touch ID didn't confirm. {self._place} stays locked.")
            self._key = secrets.token_urlsafe(32)
            return self._key
        finally:
            self._waiting.release()

    def allows(self, key: str | None) -> bool:
        current = self._key
        if not key or current is None:
            return False
        return secrets.compare_digest(key.encode(), current.encode())

    def forget(self) -> None:
        self._key = None
