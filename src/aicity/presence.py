"""Is the owner looking at the app right now? (In memory only, never saved.)

Each time the page asks for the notification list it says whether its window
has focus. The owner counts as looking only if the latest report said so and
came in the last 75 seconds: a window left open behind other apps reports "not
looking", and one closed without a word simply goes quiet and stops counting.

Written from request threads, read from the background reminder check, so it's
guarded by a lock.
"""

import threading
from collections.abc import Callable
from datetime import datetime, timedelta


class Presence:
    def __init__(self, clock: Callable[[], datetime], window_seconds: float = 75) -> None:
        self._clock = clock
        self._window = timedelta(seconds=window_seconds)
        self._lock = threading.Lock()
        self._last: tuple[datetime, bool] | None = None

    def report(self, looking: bool) -> None:
        with self._lock:
            self._last = (self._clock(), looking)

    def looking(self) -> bool:
        with self._lock:
            last = self._last
        if last is None:
            return False
        at, said = last
        return said and self._clock() - at <= self._window
