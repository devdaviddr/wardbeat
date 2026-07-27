import asyncio
import time


class RateLimiter:
    """Minimal async token-bucket. Caps real NIM calls under the free tier's
    ~40 RPM ceiling (we run at a lower default for headroom). Mock calls bypass
    it entirely.
    """

    def __init__(self, rpm: int) -> None:
        self._capacity = max(1, rpm)
        self._tokens = float(self._capacity)
        self._refill_per_sec = self._capacity / 60.0
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                elapsed = now - self._updated
                self._tokens = min(
                    self._capacity, self._tokens + elapsed * self._refill_per_sec
                )
                self._updated = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                # Not enough tokens — wait for the next one to refill.
                wait = (1 - self._tokens) / self._refill_per_sec
                await asyncio.sleep(wait)
