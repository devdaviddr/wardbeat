from app.forecast import demand_forecast, discharge_forecast


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


def test_demand_net_position():
    d = demand_forecast(free_beds=4, predicted_discharges=6, window_hours=12)
    assert d["expected_admissions"] == 6  # 0.5/hr * 12
    assert d["net_beds"] == 4  # 4 + 6 - 6
