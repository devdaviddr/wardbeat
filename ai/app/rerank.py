import logging
import time
from typing import Optional

import httpx

from app.settings import Settings

log = logging.getLogger("wardbeat.ai")

# How long the reranker stays disabled after it reports itself unavailable
# (spec v0.11.0 FR9).
#
# This used to be a plain `_rerank_disabled = True` that never reset: one 404 —
# from a tier that does not include the reranker, a model id typo, a transient
# gateway blip — silently degraded every subsequent copilot query to raw cosine
# ordering for the life of the process. Retrieval quality dropped and nothing
# ever recovered short of a restart, which nobody knew to do.
#
# Fifteen minutes is chosen so the *cost of being wrong is symmetric*. A 404 is
# usually a tier or configuration fact, so retrying every request would burn a
# rate-limit slot and add a round-trip of latency to each copilot answer for no
# benefit. Retrying once every 15 minutes costs at most four wasted calls an
# hour — negligible against the 30 RPM budget — and, crucially, bounds the
# degradation window at 15 minutes instead of "until someone restarts the pod".
RERANK_COOLDOWN_SECONDS = 900.0

# Monotonic deadline after which the reranker is retried; None means enabled.
# `time.monotonic` rather than wall clock so an NTP step cannot strand it.
_rerank_disabled_until: Optional[float] = None


def reset_rerank_state() -> None:
    """Clear the cooldown. For tests and for an explicit operator reset."""
    global _rerank_disabled_until
    _rerank_disabled_until = None


def _is_disabled() -> bool:
    """Whether the reranker is currently cooling off, re-enabling it (loudly) if
    the cooldown has expired."""
    global _rerank_disabled_until
    if _rerank_disabled_until is None:
        return False
    remaining = _rerank_disabled_until - time.monotonic()
    if remaining > 0:
        return True
    _rerank_disabled_until = None
    log.info(
        "reranker cooldown expired after %.0fs; retrying the hosted reranker",
        RERANK_COOLDOWN_SECONDS,
    )
    return False


def _disable_for_cooldown(reason: str) -> None:
    global _rerank_disabled_until
    _rerank_disabled_until = time.monotonic() + RERANK_COOLDOWN_SECONDS
    log.warning(
        "reranker disabled for %.0fs (%s); using cosine order until then",
        RERANK_COOLDOWN_SECONDS,
        reason,
    )


async def rerank(
    settings: Settings, query: str, passages: list[str], top_n: int
) -> tuple[list[int], bool]:
    """Return passage indices ordered most-relevant-first, and whether a real
    reranker was used. Falls back to identity order (i.e. the upstream cosine
    ranking) when the hosted reranker is unavailable — logged, not silent, and
    time-boxed so the fallback cannot become permanent.
    """
    identity = (list(range(len(passages)))[:top_n], False)

    if settings.use_mock or not passages or _is_disabled():
        return identity

    url = f"{settings.nim_base_url.rstrip('/')}/ranking"
    payload = {
        "model": settings.nim_rerank_model,
        "query": {"text": query},
        "passages": [{"text": p} for p in passages],
    }
    headers = {"Authorization": f"Bearer {settings.nvidia_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=settings.nim_timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code == 404:
            _disable_for_cooldown("reranker unavailable on this tier")
            return identity
        resp.raise_for_status()
        rankings = resp.json()["rankings"]  # [{index, logit}], best-first
        order = [r["index"] for r in rankings][:top_n]
        return order, True
    except Exception as exc:  # noqa: BLE001 - degrade gracefully
        # Not a cooldown: a timeout or a 5xx is transient, and suppressing the
        # reranker for 15 minutes over one blip is the mistake this release is
        # correcting. Only a 404 (the endpoint is genuinely not there) backs off.
        log.warning("rerank failed (%s); using cosine order", exc)
        return identity
