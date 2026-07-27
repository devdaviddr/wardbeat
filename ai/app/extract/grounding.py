from difflib import SequenceMatcher
from typing import Optional

from app.schemas import BarrierOut


def _find_span(text: str, quote: str) -> Optional[tuple[int, int]]:
    """Locate `quote` in `text`. Exact (case-insensitive) first, then a fuzzy
    fallback that tolerates minor model paraphrasing. Returns (start, end) or
    None if it cannot be grounded.
    """
    if not quote:
        return None

    lower_text = text.lower()
    lower_quote = quote.lower().strip()

    idx = lower_text.find(lower_quote)
    if idx != -1:
        return idx, idx + len(lower_quote)

    # Fuzzy fallback: slide a window the length of the quote and take the best
    # match above a similarity threshold. Cheap enough for note-sized text.
    n = len(lower_quote)
    if n < 4 or n > len(lower_text):
        return None
    best_ratio = 0.0
    best_start = -1
    step = max(1, n // 4)
    for start in range(0, len(lower_text) - n + 1, step):
        window = lower_text[start : start + n]
        ratio = SequenceMatcher(None, window, lower_quote).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_start = start
    if best_ratio >= 0.75 and best_start >= 0:
        return best_start, best_start + n
    return None


def ground_barriers(
    text: str, barriers: list[BarrierOut]
) -> tuple[list[BarrierOut], bool]:
    """Keep only barriers whose cited quote can be located in the source note;
    normalise their span to the real offsets and snap the quote to the source
    text. Returns (grounded_barriers, all_were_grounded).
    """
    kept: list[BarrierOut] = []
    all_grounded = True
    for b in barriers:
        span = _find_span(text, b.source.quote)
        if span is None:
            all_grounded = False
            continue
        start, end = span
        b.source.start = start
        b.source.end = end
        b.source.quote = text[start:end]
        kept.append(b)
    return kept, all_grounded
