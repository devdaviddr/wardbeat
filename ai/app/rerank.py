import logging

import httpx

from app.settings import Settings

log = logging.getLogger("wardbeat.ai")

# Whether the hosted reranker has been found unavailable (avoid re-hitting a 404
# every call). Reset per process.
_rerank_disabled = False


async def rerank(
    settings: Settings, query: str, passages: list[str], top_n: int
) -> tuple[list[int], bool]:
    """Return passage indices ordered most-relevant-first, and whether a real
    reranker was used. Falls back to identity order (i.e. the upstream cosine
    ranking) when the hosted reranker is unavailable — logged, not silent.
    """
    global _rerank_disabled
    identity = (list(range(len(passages)))[:top_n], False)

    if settings.use_mock or _rerank_disabled or not passages:
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
            _rerank_disabled = True
            log.warning("reranker unavailable on this tier; using cosine order")
            return identity
        resp.raise_for_status()
        rankings = resp.json()["rankings"]  # [{index, logit}], best-first
        order = [r["index"] for r in rankings][:top_n]
        return order, True
    except Exception as exc:  # noqa: BLE001 - degrade gracefully
        log.warning("rerank failed (%s); using cosine order", exc)
        return identity
