import json
from typing import Any

import httpx

from app.settings import Settings


class NimError(RuntimeError):
    pass


async def chat_json(
    settings: Settings, messages: list[dict[str, str]]
) -> dict[str, Any]:
    """Call the NIM OpenAI-compatible chat endpoint and return the parsed JSON
    content. Requests JSON output; tolerates models that wrap it in prose by
    extracting the first {...} block.
    """
    url = f"{settings.nim_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.nim_extract_model,
        "messages": messages,
        "temperature": 0,
        # Nemotron is a reasoning model — reasoning tokens count toward the
        # budget, so this must clear reasoning + the JSON payload without a tight
        # cap leaving `content` null. Configurable via NIM_EXTRACT_MAX_TOKENS;
        # the default keeps per-call latency down (see settings).
        "max_tokens": settings.nim_extract_max_tokens,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {settings.nvidia_api_key}",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=settings.nim_timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            raise NimError(f"NIM {resp.status_code}: {resp.text[:300]}")
        data = resp.json()

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:  # pragma: no cover - defensive
        raise NimError(f"Unexpected NIM response shape: {data}") from exc

    if not content:
        finish = data["choices"][0].get("finish_reason")
        raise NimError(f"Empty content (finish_reason={finish})")

    return _parse_json_object(content)


def _parse_json_object(content: str) -> dict[str, Any]:
    content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    # Fallback: pull the first balanced {...} block out of any surrounding prose.
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(content[start : end + 1])
        except json.JSONDecodeError as exc:
            raise NimError(f"Model did not return valid JSON: {content[:300]}") from exc
    raise NimError(f"Model did not return JSON: {content[:300]}")
