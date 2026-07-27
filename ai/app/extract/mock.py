import re
from datetime import date, timedelta
from typing import Optional

from app.schemas import BarrierOut, BarrierType, ExtractionResult, SourceSpan

# Keyword → barrier type. Order matters only for which sentence is cited first.
_KEYWORDS: dict[BarrierType, tuple[str, ...]] = {
    "tto": ("tto", "to take out", "to-take-out", "dispensed by pharmacy"),
    "transport": ("transport", "ambulance"),
    "social_care": (
        "package of care",
        "social service",
        "social work",
        "care home",
        "district nurse",
        "occupational therapy home",
        "poc",
    ),
    "review": (
        "review",
        "assessment",
    ),
    "other": (),
}

_POS_MFFD = ("fit for discharge", "medically fit", "mffd", "for discharge")
_NEG_MFFD = ("not fit", "not medically fit", "unfit", "not for discharge")


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip() for p in parts if p.strip()]


def _first_sentence_with(sentences: list[str], needle: str) -> Optional[str]:
    for s in sentences:
        if needle in s.lower():
            return s
    return None


def mock_extract(note_id: str, text: str) -> ExtractionResult:
    """Deterministic, offline extraction. Keyword/sentence based, so it never
    follows instructions embedded in the note (prompt-injection safe) — it only
    reads it. Good enough to drive the demo and the eval with zero dependencies.
    """
    low = text.lower()
    sentences = _sentences(text)

    mffd = any(p in low for p in _POS_MFFD) and not any(
        n in low for n in _NEG_MFFD
    )

    edd: Optional[str] = None
    if mffd and "today" in low:
        edd = date.today().isoformat()
    elif mffd and "tomorrow" in low:
        edd = (date.today() + timedelta(days=1)).isoformat()

    barriers: list[BarrierOut] = []
    for btype, needles in _KEYWORDS.items():
        for needle in needles:
            if needle in low:
                sentence = _first_sentence_with(sentences, needle) or text
                barriers.append(
                    BarrierOut(
                        type=btype,
                        source=SourceSpan(quote=sentence),
                        confidence=85,
                    )
                )
                break  # one barrier per type

    return ExtractionResult(
        note_id=note_id,
        model="mock",
        edd=edd,
        mffd_flag=mffd,
        barriers=barriers,
        escalations=[],
        grounded=True,
    )
