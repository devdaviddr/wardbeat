import logging

from app.nim import NimError, chat_json
from app.settings import Settings

log = logging.getLogger("wardbeat.ai")

SYSTEM_PROMPT = """\
You are the WardBeat flow briefer. Write a short (2-4 sentence) shift briefing for
a charge nurse using ONLY the figures and beds provided. You are a narrator, not a
forecaster: never invent or recompute any number — use exactly the numbers given.
Reference specific bed labels. Lead with the net bed position, then the likely
discharges and the beds gated on a barrier to chase.

Return a single JSON object: {"briefing": string}. No other keys, no prose."""


def _mock(payload: dict) -> dict:
    s = payload.get("stats", {})
    net = s.get("net_beds", 0)
    pos = (
        f"{abs(net)} bed{'s' if abs(net) != 1 else ''} short"
        if net < 0
        else f"{net} bed{'s' if net != 1 else ''} to spare"
    )
    at_risk = payload.get("at_risk", [])
    risk_txt = (
        " Beds gated on a barrier: "
        + ", ".join(f"{r['label']} ({', '.join(r['barriers'])})" for r in at_risk)
        + "."
        if at_risk
        else ""
    )
    briefing = (
        f"Ward is heading {pos} over the next {s.get('window_hours', 12)}h: "
        f"{s.get('predicted_discharges_24h', 0)} of {s.get('occupied', 0)} occupied beds "
        f"are likely to discharge, against {s.get('expected_admissions', 0)} expected "
        f"admissions and {s.get('free', 0)} free now.{risk_txt}"
    )
    return {"briefing": briefing}


def _format(payload: dict) -> str:
    s = payload.get("stats", {})
    lines = [f"STATS: {s}"]
    if payload.get("predicted_discharges"):
        lines.append(
            "LIKELY DISCHARGES: "
            + "; ".join(
                f"{d['label']} (p={d['p']}, ~{d['predicted_days']}d)"
                for d in payload["predicted_discharges"]
            )
        )
    if payload.get("at_risk"):
        lines.append(
            "GATED ON A BARRIER: "
            + "; ".join(
                f"{r['label']}: {', '.join(r['barriers'])}" for r in payload["at_risk"]
            )
        )
    return "\n".join(lines)


async def narrate_briefing(settings: Settings, payload: dict) -> dict:
    if settings.use_mock:
        return _mock(payload)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _format(payload)},
    ]
    try:
        raw = await chat_json(settings, messages)
        briefing = str(raw.get("briefing", "")).strip()
        return {"briefing": briefing or _mock(payload)["briefing"]}
    except (NimError, Exception) as exc:  # noqa: BLE001
        log.warning("narrate failed (%s); using mock", exc)
        return _mock(payload)
