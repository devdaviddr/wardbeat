from app.forecast import (
    HISTORY_HOURS,
    MIN_ADMISSIONS_FOR_PROJECTION,
    demand_forecast,
    discharge_forecast,
)
from app.narrate import _mock as narrate_mock


def test_mffd_raises_probability():
    unfit = discharge_forecast({"mffd": False, "open_barriers": 0})
    fit = discharge_forecast({"mffd": True, "open_barriers": 0})
    assert fit["p_discharge_24h"] > unfit["p_discharge_24h"]


def test_more_barriers_lowers_probability():
    few = discharge_forecast({"mffd": True, "open_barriers": 1})
    many = discharge_forecast({"mffd": True, "open_barriers": 3})
    assert many["p_discharge_24h"] < few["p_discharge_24h"]


def test_social_care_extends_predicted_days():
    without = discharge_forecast({"mffd": True, "open_barriers": 1})
    with_sc = discharge_forecast(
        {"mffd": True, "open_barriers": 1, "has_social_care": True}
    )
    assert with_sc["predicted_days"] > without["predicted_days"]


# --- Length of stay ---------------------------------------------------------


def test_long_stay_lowers_probability():
    """The feature the product used to hardcode to 3. If this stops
    discriminating, `days_admitted` is a dead input again."""
    short = discharge_forecast({"mffd": True, "days_admitted": 2})
    long_stay = discharge_forecast({"mffd": True, "days_admitted": 12})
    assert long_stay["p_discharge_24h"] < short["p_discharge_24h"]


def test_days_admitted_is_monotone_beyond_the_expected_stay():
    ps = [
        discharge_forecast({"mffd": True, "days_admitted": d})["p_discharge_24h"]
        for d in (4, 6, 9)
    ]
    assert ps == sorted(ps, reverse=True)


def test_unknown_length_of_stay_applies_no_penalty():
    """`None` must not be coerced into a stay. It scores as no over-stay
    signal — the same score a 3-day stay gets — but it is not the claim that
    the patient has been in for three days."""
    unknown = discharge_forecast({"mffd": True, "days_admitted": None})
    absent = discharge_forecast({"mffd": True})
    at_expected = discharge_forecast({"mffd": True, "days_admitted": 3})
    penalised = discharge_forecast({"mffd": True, "days_admitted": 8})
    assert unknown == absent == at_expected
    assert unknown["p_discharge_24h"] > penalised["p_discharge_24h"]


# --- Demand -----------------------------------------------------------------


def test_demand_projects_from_admission_history():
    # 14 admissions over 7 days = 2/day = 1 per 12h.
    d = demand_forecast(
        free_beds=4, predicted_discharges=6, admissions_last_7d=14, window_hours=12
    )
    assert d["insufficient_history"] is False
    assert d["expected_admissions"] == round(14 / HISTORY_HOURS * 12, 1)
    assert d["expected_admissions"] == 1.0
    assert d["net_beds"] == 9.0  # 4 + 6 - 1
    assert d["reason"] is None


def test_demand_scales_with_the_window():
    half = demand_forecast(
        free_beds=0, predicted_discharges=0, admissions_last_7d=28, window_hours=12
    )
    full = demand_forecast(
        free_beds=0, predicted_discharges=0, admissions_last_7d=28, window_hours=24
    )
    assert full["expected_admissions"] > half["expected_admissions"]


def test_demand_varies_with_the_ward_history():
    """The regression this release exists to remove: the old implementation
    returned the same number for every ward, hour and day."""
    quiet = demand_forecast(
        free_beds=0, predicted_discharges=0, admissions_last_7d=7, window_hours=12
    )
    busy = demand_forecast(
        free_beds=0, predicted_discharges=0, admissions_last_7d=70, window_hours=12
    )
    assert busy["expected_admissions"] > quiet["expected_admissions"]


def test_demand_returns_no_figure_below_the_threshold():
    d = demand_forecast(
        free_beds=4,
        predicted_discharges=6,
        admissions_last_7d=MIN_ADMISSIONS_FOR_PROJECTION - 1,
        window_hours=12,
    )
    assert d["insufficient_history"] is True
    assert d["expected_admissions"] is None
    assert d["net_beds"] is None
    assert "6 admissions" in d["reason"]


def test_demand_threshold_is_inclusive():
    d = demand_forecast(
        free_beds=0,
        predicted_discharges=0,
        admissions_last_7d=MIN_ADMISSIONS_FOR_PROJECTION,
        window_hours=12,
    )
    assert d["insufficient_history"] is False


def test_demand_distinguishes_no_history_from_zero_admissions():
    unknown = demand_forecast(
        free_beds=0, predicted_discharges=0, admissions_last_7d=None, window_hours=12
    )
    none_recorded = demand_forecast(
        free_beds=0, predicted_discharges=0, admissions_last_7d=0, window_hours=12
    )
    assert unknown["insufficient_history"] is True
    assert none_recorded["insufficient_history"] is True
    assert unknown["reason"] != none_recorded["reason"]
    assert "0 admissions" in none_recorded["reason"]


def test_demand_never_defaults_a_figure_to_zero():
    """A zero would render as a number a bed manager could act on."""
    for n in (None, 0, 1, MIN_ADMISSIONS_FOR_PROJECTION - 1):
        d = demand_forecast(
            free_beds=4, predicted_discharges=2, admissions_last_7d=n, window_hours=12
        )
        assert d["expected_admissions"] is None
        assert d["net_beds"] is None


# --- Narration of an absent figure ------------------------------------------


def test_narration_mock_states_no_bed_position_when_demand_is_absent():
    out = narrate_mock(
        {
            "stats": {
                "occupied": 12,
                "free": 4,
                "predicted_discharges_24h": 6,
                "window_hours": 12,
            },
            "demand_unavailable_reason": (
                "Only 3 admissions recorded in the last 7 days."
            ),
            "at_risk": [],
        }
    )["briefing"]
    assert "not available" in out
    assert "Only 3 admissions" in out
    assert "short" not in out
    assert "spare" not in out
    assert "expected admissions" not in out


def test_narration_mock_states_the_bed_position_when_demand_is_present():
    out = narrate_mock(
        {
            "stats": {
                "occupied": 12,
                "free": 4,
                "predicted_discharges_24h": 6,
                "expected_admissions": 1.0,
                "net_beds": -3.0,
                "window_hours": 12,
            },
            "at_risk": [],
        }
    )["briefing"]
    assert "3 beds short" in out
    assert "1.0 expected admissions" in out
