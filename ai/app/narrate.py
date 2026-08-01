from app.nim import NimError, chat_json
from app.provenance import ModelResult, call_model
from app.settings import Settings

SYSTEM_PROMPT = """\
You are the WardBeat flow briefer. Write a short (2-4 sentence) shift briefing for
a charge nurse using ONLY the figures and beds provided. You are a narrator, not a
forecaster: never invent or recompute any number — use exactly the numbers given.
Reference specific bed labels. Lead with the net bed position, then the likely
discharges and the beds gated on a barrier to chase.

Every number you write must appear verbatim in STATS. If a figure is absent from
STATS it could not be computed, and you must not state it, estimate it, derive it
from the other figures, or imply it.

In particular, when `net_beds` is absent there is NO net bed position. Do not
write one. Do not compute one from `free` and `predicted_discharges_24h`. Do not
say the ward is short of beds, has beds to spare, or is balanced. Say plainly
that the net bed position is not available, give the reason if one is provided,
and then narrate only the figures you were actually given.

Return a single JSON object: {"briefing": string}. No other keys, no prose."""


def _net_position(net: float) -> str:
    """'2 beds short' / '1 bed to spare'. Projections carry a decimal, so trim a
    trailing '.0' rather than print '2.0 beds short'."""
    magnitude = abs(net)
    shown = f"{magnitude:g}"
    plural = "" if magnitude == 1 else "s"
    return f"{shown} bed{plural} " + ("short" if net < 0 else "to spare")


def _mock(payload: dict) -> dict:
    s = payload.get("stats", {})
    window = s.get("window_hours", 12)
    net = s.get("net_beds")
    admissions = s.get("expected_admissions")

    if net is None:
        reason = str(payload.get("demand_unavailable_reason") or "").strip()
        tail = f" {reason}" if reason else ""
        lead = f"Net bed position over the next {window}h is not available.{tail} "
    else:
        lead = f"Ward is heading {_net_position(net)} over the next {window}h: "

    against = (
        f", against {admissions} expected admissions" if admissions is not None else ""
    )
    body = (
        f"{s.get('predicted_discharges_24h', 0)} of {s.get('occupied', 0)} occupied "
        f"beds are likely to discharge{against}, with {s.get('free', 0)} free now."
    )

    at_risk = payload.get("at_risk", [])
    risk_txt = (
        " Beds gated on a barrier: "
        + ", ".join(f"{r['label']} ({', '.join(r['barriers'])})" for r in at_risk)
        + "."
        if at_risk
        else ""
    )
    return {"briefing": f"{lead}{body}{risk_txt}"}


def _format(payload: dict) -> str:
    s = payload.get("stats", {})
    lines = [f"STATS: {s}"]
    # Naming the gap explicitly beats leaving the model to notice a missing key.
    if payload.get("demand_unavailable_reason"):
        lines.append(
            "NOT AVAILABLE: net bed position and expected admissions — "
            f"{payload['demand_unavailable_reason']}"
        )
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


async def narrate_briefing(
    settings: Settings, payload: dict
) -> ModelResult[dict]:
    async def live() -> dict:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _format(payload)},
        ]
        raw = await chat_json(settings, messages)
        briefing = str(raw.get("briefing", "")).strip()
        # An empty briefing means the mock's prose would be shown instead, which
        # is a fallback — not a live narration with nothing to say.
        if not briefing:
            raise NimError("Model returned an empty briefing")
        return {"briefing": briefing}

    return await call_model(
        settings, "narrate", mock=lambda: _mock(payload), live=live
    )
