import math
from typing import Optional

# Transparent logistic discharge model. Weights are interpretable and monotone;
# in production they would be fit from historical length-of-stay data (or replaced
# by a gradient-boosted model). This is deterministic — NOT an LLM.
_W = {
    "bias": 0.4,
    "mffd": 2.6,
    "open_barriers": -0.9,
    "has_social_care": -0.7,  # package-of-care / placement is slow
    "has_review": -0.4,
    "has_transport": -0.2,
    "edd_set": 0.5,
    "days_over": -0.15,  # per day admitted beyond an expected 3
}

# Length of stay past which the model starts penalising: a stay is "expected" up
# to this many days and each day beyond it lowers P(discharge).
_EXPECTED_LOS_DAYS = 3.0


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def _days_over(days_admitted: Optional[float]) -> float:
    """Days of stay beyond the expected length.

    `None` means the caller does not know how long the patient has been in —
    there is no admission timestamp on the encounter. Contributing 0 is the
    honest reading: the model applies no over-stay penalty rather than
    inventing a length of stay. It is *not* the same claim as "admitted today",
    even though both happen to score the same, because both genuinely carry no
    over-stay signal.
    """
    if days_admitted is None:
        return 0.0
    return max(0.0, float(days_admitted) - _EXPECTED_LOS_DAYS)


def discharge_forecast(f: dict) -> dict:
    """P(discharge within 24h) + predicted days-to-discharge for one patient
    from allow-listed features. Deterministic and monotone in each feature.
    """
    z = (
        _W["bias"]
        + _W["mffd"] * (1.0 if f.get("mffd") else 0.0)
        + _W["open_barriers"] * float(f.get("open_barriers", 0))
        + _W["has_social_care"] * (1.0 if f.get("has_social_care") else 0.0)
        + _W["has_review"] * (1.0 if f.get("has_review") else 0.0)
        + _W["has_transport"] * (1.0 if f.get("has_transport") else 0.0)
        + _W["edd_set"] * (1.0 if f.get("edd_set") else 0.0)
        + _W["days_over"] * _days_over(f.get("days_admitted"))
    )
    p = _sigmoid(z)

    # Predicted days: fit patients with no blockers ~1 day; each barrier adds a
    # day; social care adds more; not-fit adds a floor.
    days = 1
    days += int(f.get("open_barriers", 0))
    if f.get("has_social_care"):
        days += 2
    if not f.get("mffd"):
        days += 3
    days = max(1, min(days, 10))

    return {"p_discharge_24h": round(p, 3), "predicted_days": days}


# --- Demand -----------------------------------------------------------------

HISTORY_DAYS = 7
HISTORY_HOURS = HISTORY_DAYS * 24

# Minimum admissions on record before a rate is worth projecting from.
#
# Seven — one a day across the trailing week — is the point below which the
# projection stops carrying information. With six admissions on record, one
# extra or one missing arrival moves a 12-hour projection by ~0.09 beds against
# a projection of ~0.4: the sampling noise is the same order as the estimate.
# It is also the smallest count at which "beds needed tonight" is answering
# from more than a couple of arrivals. Below it the service returns no figure
# at all rather than a number a bed manager could act on.
MIN_ADMISSIONS_FOR_PROJECTION = 7


def demand_forecast(
    free_beds: int,
    predicted_discharges: int,
    admissions_last_7d: Optional[int],
    window_hours: int,
) -> dict:
    """Expected admissions over the window and the net bed position, projected
    from the ward's own trailing-7-day admission history.

    There is no synthetic baseline rate any more. When the history is too thin
    to project from, this returns **no figures** and the reason — an absent
    number is recoverable, a fabricated one is not.
    """
    window = max(1, window_hours)
    absent = {
        "expected_admissions": None,
        "net_beds": None,
        "insufficient_history": True,
        "admissions_last_7d": admissions_last_7d,
        "window_hours": window,
    }

    if admissions_last_7d is None:
        return {
            **absent,
            "reason": "No admission history was available to project from.",
        }

    if admissions_last_7d < MIN_ADMISSIONS_FOR_PROJECTION:
        return {
            **absent,
            "reason": (
                f"Only {admissions_last_7d} admission"
                f"{'' if admissions_last_7d == 1 else 's'} recorded in the last "
                f"{HISTORY_DAYS} days — fewer than the "
                f"{MIN_ADMISSIONS_FOR_PROJECTION} needed to project a rate."
            ),
        }

    rate_per_hour = admissions_last_7d / HISTORY_HOURS
    expected_admissions = round(rate_per_hour * window, 1)
    net_beds = round(free_beds + predicted_discharges - expected_admissions, 1)
    return {
        "expected_admissions": expected_admissions,
        "net_beds": net_beds,
        "insufficient_history": False,
        "reason": None,
        "admissions_last_7d": admissions_last_7d,
        "window_hours": window,
    }
