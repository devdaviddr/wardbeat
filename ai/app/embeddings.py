import hashlib
import math
import re

import httpx

from app.settings import Settings

_TOKEN = re.compile(r"[a-z0-9]+")


def _mock_embedding(text: str, dim: int) -> list[float]:
    """Deterministic offline embedding via the hashing trick: bag-of-words
    hashed into `dim` buckets, then L2-normalised. Not semantic, but it gives
    lexical-overlap similarity — enough for the RAG path to retrieve sensibly
    with zero external calls.
    """
    vec = [0.0] * dim
    for tok in _TOKEN.findall(text.lower()):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        idx = h % dim
        sign = 1.0 if (h >> 8) & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


async def embed(
    settings: Settings, texts: list[str], input_type: str
) -> list[list[float]]:
    """Embed texts via the NIM embeddings endpoint, or the deterministic mock.
    `input_type` is "query" or "passage" (NVIDIA embed models are asymmetric).
    """
    if settings.use_mock:
        return [_mock_embedding(t, settings.embed_dim) for t in texts]

    url = f"{settings.nim_base_url.rstrip('/')}/embeddings"
    payload = {
        "model": settings.nim_embed_model,
        "input": texts,
        "input_type": input_type,
        "encoding_format": "float",
    }
    headers = {"Authorization": f"Bearer {settings.nvidia_api_key}"}
    async with httpx.AsyncClient(timeout=settings.nim_timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    # Preserve input order (NIM returns an index on each item).
    items = sorted(data["data"], key=lambda d: d.get("index", 0))
    return [item["embedding"] for item in items]
