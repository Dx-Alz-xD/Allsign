"""Failed-login throttle, per email address, held in process memory (run the API as a single worker)."""

import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable


class LoginThrottle:
    def __init__(
        self,
        max_failures: int = 10,
        window_seconds: float = 15 * 60,
        max_tracked: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.max_tracked = max_tracked
        self._clock = clock
        self._failures: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque[float] | None:
        failures = self._failures.get(key)
        if failures is None:
            return None
        while failures and failures[0] <= now - self.window_seconds:
            failures.popleft()
        if not failures:
            del self._failures[key]
            return None
        return failures

    def retry_after(self, key: str) -> int:
        """Seconds until another attempt is allowed; 0 when it is allowed now."""
        with self._lock:
            now = self._clock()
            failures = self._recent(key, now)
            if failures is None or len(failures) < self.max_failures:
                return 0
            return max(1, int(failures[0] + self.window_seconds - now + 0.999))

    def record_failure(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            failures = self._recent(key, now) or deque(maxlen=self.max_failures)
            failures.append(now)
            self._failures[key] = failures
            self._failures.move_to_end(key)
            while len(self._failures) > self.max_tracked:
                self._failures.popitem(last=False)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()
