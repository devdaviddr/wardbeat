import math

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


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


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
        + _W["days_over"] * max(0.0, float(f.get("days_admitted", 0)) - 3.0)
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


def demand_forecast(
    free_beds: int, predicted_discharges: int, window_hours: int
) -> dict:
    """Expected admissions over the window and the net bed position. Baseline
    admission rate is a documented synthetic constant (no real feed).
    """
    admit_rate_per_hour = 0.5  # synthetic baseline
    expected_admissions = round(admit_rate_per_hour * max(1, window_hours))
    net_beds = free_beds + predicted_discharges - expected_admissions
    return {"expected_admissions": expected_admissions, "net_beds": net_beds}
