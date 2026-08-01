"""The reranker's disable must be a cooldown, not a latch (spec v0.11.0 FR9).

The bug these pin: `_rerank_disabled = True` was set on a single 404 and never
reset, so one bad response degraded every later copilot query to raw cosine
ordering for the life of the process, invisibly.
"""

import httpx
import pytest

from app import rerank as rerank_mod
from app.rerank import RERANK_COOLDOWN_SECONDS, rerank, reset_rerank_state
from app.settings import Settings

PASSAGES = ["alpha", "beta", "gamma"]


def live_settings() -> Settings:
    return Settings(nim_mock=False, nvidia_api_key="test-key")


@pytest.fixture(autouse=True)
def clean_state():
    """Module-level cooldown state leaks between tests otherwise."""
    reset_rerank_state()
    yield
    reset_rerank_state()


class FakeClock:
    """Controllable stand-in for `time.monotonic`."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch) -> FakeClock:
    fake = FakeClock()
    monkeypatch.setattr(rerank_mod.time, "monotonic", fake)
    return fake


def _responder(monkeypatch, statuses: list[int], calls: list[int]):
    """Serve `statuses` in order, repeating the last one, recording each call."""

    async def post(self, url, json=None, headers=None):  # noqa: ANN001
        idx = min(len(calls), len(statuses) - 1)
        calls.append(idx)
        status = statuses[idx]
        if status == 200:
            # Reverse order, so a real rerank is distinguishable from identity.
            body = {
                "rankings": [
                    {"index": i, "logit": 1.0}
                    for i in reversed(range(len(json["passages"])))
                ]
            }
            return httpx.Response(200, json=body, request=httpx.Request("POST", url))
        return httpx.Response(status, json={}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)


async def test_404_disables_the_reranker_for_the_cooldown(monkeypatch, clock):
    calls: list[int] = []
    _responder(monkeypatch, [404], calls)

    order, reranked = await rerank(live_settings(), "q", PASSAGES, 3)
    assert reranked is False
    assert order == [0, 1, 2]  # identity == upstream cosine order
    assert len(calls) == 1

    # Inside the cooldown the endpoint is not hit again.
    clock.advance(RERANK_COOLDOWN_SECONDS - 1)
    await rerank(live_settings(), "q", PASSAGES, 3)
    assert len(calls) == 1


async def test_reranker_re_enables_after_the_cooldown(monkeypatch, clock):
    """The whole point of FR9: a 404 must not be permanent."""
    calls: list[int] = []
    _responder(monkeypatch, [404, 200], calls)

    await rerank(live_settings(), "q", PASSAGES, 3)
    assert len(calls) == 1

    clock.advance(RERANK_COOLDOWN_SECONDS + 1)
    order, reranked = await rerank(live_settings(), "q", PASSAGES, 3)

    assert len(calls) == 2, "cooldown expired but the reranker was never retried"
    assert reranked is True
    assert order == [2, 1, 0]


async def test_re_enable_and_disable_transitions_are_logged(monkeypatch, clock, caplog):
    calls: list[int] = []
    _responder(monkeypatch, [404, 404], calls)

    with caplog.at_level("INFO", logger="wardbeat.ai"):
        await rerank(live_settings(), "q", PASSAGES, 3)
        assert any("reranker disabled" in r.message for r in caplog.records)

        caplog.clear()
        clock.advance(RERANK_COOLDOWN_SECONDS + 1)
        await rerank(live_settings(), "q", PASSAGES, 3)
        assert any("cooldown expired" in r.message for r in caplog.records)


async def test_transient_failure_does_not_start_a_cooldown(monkeypatch, clock):
    """A 5xx or a timeout is a blip. Backing off 15 minutes for it would be the
    same over-reaction in a new costume."""
    calls: list[int] = []
    _responder(monkeypatch, [503, 200], calls)

    _, reranked = await rerank(live_settings(), "q", PASSAGES, 3)
    assert reranked is False

    # No cooldown, so the very next call retries immediately.
    _, reranked = await rerank(live_settings(), "q", PASSAGES, 3)
    assert reranked is True
    assert len(calls) == 2


async def test_mock_mode_never_calls_the_reranker(monkeypatch, clock):
    calls: list[int] = []
    _responder(monkeypatch, [200], calls)

    order, reranked = await rerank(
        Settings(nim_mock=True, nvidia_api_key=""), "q", PASSAGES, 2
    )
    assert (order, reranked) == ([0, 1], False)
    assert calls == []
