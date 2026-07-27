import logging

from app.extract.grounding import ground_barriers
from app.extract.mock import mock_extract
from app.extract.prompt import build_messages
from app.nim import NimError, chat_json
from app.ratelimit import RateLimiter
from app.schemas import BarrierOut, ExtractionResult, SourceSpan
from app.settings import Settings

log = logging.getLogger("wardbeat.ai")

_VALID_TYPES = {"tto", "transport", "social_care", "review", "other"}


async def extract_note(
    settings: Settings, limiter: RateLimiter, note_id: str, text: str
) -> ExtractionResult:
    """Extract barriers/EDD/MFFD from a note, then ground every barrier back to
    the source text. Falls back to the deterministic mock when NIM is disabled
    or unavailable, so the endpoint always returns a usable result.
    """
    if settings.use_mock:
        result = mock_extract(note_id, text)
    else:
        try:
            await limiter.acquire()
            raw = await chat_json(settings, build_messages(text))
            result = _to_result(note_id, settings.nim_extract_model, raw)
        except (NimError, Exception) as exc:  # noqa: BLE001 - degrade gracefully
            log.warning("NIM extraction failed (%s); using mock fallback", exc)
            result = mock_extract(note_id, text)

    # Grounding gate: drop any barrier we can't locate in the note; flag the
    # result as ungrounded if the model hallucinated evidence.
    kept, all_grounded = ground_barriers(text, result.barriers)
    result.barriers = kept
    result.grounded = all_grounded
    return result


def _to_result(note_id: str, model: str, raw: dict) -> ExtractionResult:
    barriers: list[BarrierOut] = []
    for item in raw.get("barriers", []) or []:
        btype = str(item.get("type", "other")).lower().strip()
        if btype not in _VALID_TYPES:
            btype = "other"
        quote = str(item.get("quote", "")).strip()
        if not quote:
            continue
        barriers.append(
            BarrierOut(
                type=btype,  # type: ignore[arg-type]
                source=SourceSpan(quote=quote),
                confidence=int(item.get("confidence", 80) or 80),
            )
        )

    edd = raw.get("edd")
    escalations = raw.get("escalations") or []
    if not isinstance(escalations, list):
        escalations = []

    return ExtractionResult(
        note_id=note_id,
        model=model,
        edd=edd if isinstance(edd, str) and edd else None,
        mffd_flag=bool(raw.get("mffd_flag", False)),
        barriers=barriers,
        escalations=[str(e) for e in escalations],
        grounded=True,
    )
