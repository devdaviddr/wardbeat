"""Provenance is the release's load-bearing claim, so these tests pin the one
distinction that used to be invisible: a live call that FAILED and was answered
by the mock must never look like a live answer.
"""

import pytest

from app import answer as answer_mod
from app import classify as classify_mod
from app import narrate as narrate_mod
from app import recommend as recommend_mod
from app.answer import answer_from_passages
from app.classify import classify
from app.narrate import narrate_briefing
from app.nim import NimError
from app.provenance import call_model
from app.query_intent import build_query_intent
from app.recommend import recommend_actions
from app.settings import Settings

PASSAGES = [
    {"id": "p1", "text": "TTOs must be dispensed within four hours. Pharmacy owns this.", "source": "Policy"},
    {"id": "p2", "text": "Transport is booked by the ward clerk.", "source": "Policy"},
]

BARRIERS = [{"id": "b1", "type": "tto", "quote": "waiting on TTOs"}]


def mock_settings() -> Settings:
    """NIM_MOCK on — no live call is attempted."""
    return Settings(nim_mock=True, nvidia_api_key="")


def live_settings() -> Settings:
    """Live configured, so a failure here is a fallback and not a mock run."""
    return Settings(nim_mock=False, nvidia_api_key="test-key")


@pytest.fixture
def broken_nim(monkeypatch):
    """Make every chat call fail, so the live path degrades to the mock."""

    async def boom(settings, messages):
        raise NimError("NIM 503: upstream unavailable")

    for module in (answer_mod, classify_mod, narrate_mod, recommend_mod):
        monkeypatch.setattr(module, "chat_json", boom)


# --- the three states -------------------------------------------------------


async def test_mock_mode_reports_mock_and_no_model():
    result = await answer_from_passages(mock_settings(), "how long for TTOs?", PASSAGES)
    assert result.provenance == "mock"
    assert result.model_used is None


async def test_live_success_reports_live_and_the_model_id():
    async def ok():
        return {"answer": "Four hours.", "citations": [1], "grounded": True}

    settings = live_settings()
    result = await call_model(settings, "test", mock=lambda: {}, live=ok)
    assert result.provenance == "live"
    assert result.model_used == settings.nim_extract_model


async def test_failed_live_call_reports_fallback_not_live(broken_nim):
    """The whole point: the mock answered, but live was configured and tried."""
    result = await answer_from_passages(live_settings(), "how long for TTOs?", PASSAGES)
    assert result.provenance == "fallback"
    # The model was still *called* — a privacy audit needs to know the note text
    # reached the endpoint even though the response never came back.
    assert result.model_used == live_settings().nim_extract_model


async def test_fallback_logs_a_warning_with_the_underlying_error(broken_nim, caplog):
    with caplog.at_level("WARNING", logger="wardbeat.ai"):
        await answer_from_passages(live_settings(), "q", PASSAGES)
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("fell back to the mock" in m and "503" in m for m in warnings), warnings


# --- grounding honesty (M2) -------------------------------------------------


async def test_mock_answer_is_never_grounded():
    result = await answer_from_passages(mock_settings(), "how long for TTOs?", PASSAGES)
    assert result.value["grounded"] is False
    # Citations survive so the source stays openable — it is the *claim* of
    # grounding that is withdrawn, not the provenance trail.
    assert result.value["citations"] == ["p1"]


async def test_mock_ward_answer_is_never_grounded():
    result = await answer_from_passages(
        mock_settings(), "which beds are free?", PASSAGES, kind="ward"
    )
    assert result.value["grounded"] is False


async def test_fallback_answer_is_never_grounded(broken_nim):
    result = await answer_from_passages(live_settings(), "q", PASSAGES)
    assert result.provenance == "fallback"
    assert result.value["grounded"] is False


async def test_live_answer_may_be_grounded(monkeypatch):
    async def composed(settings, messages):
        return {"answer": "Four hours.", "citations": [1], "grounded": True}

    monkeypatch.setattr(answer_mod, "chat_json", composed)
    result = await answer_from_passages(live_settings(), "q", PASSAGES)
    assert result.provenance == "live"
    assert result.value["grounded"] is True


async def test_mock_recommendations_are_never_grounded():
    result = await recommend_actions(mock_settings(), "Bed 1", BARRIERS, PASSAGES)
    assert result.provenance == "mock"
    assert result.value, "the mock still recommends an action per barrier"
    assert all(r["grounded"] is False for r in result.value)


async def test_fallback_recommendations_are_never_grounded(broken_nim):
    result = await recommend_actions(live_settings(), "Bed 1", BARRIERS, PASSAGES)
    assert result.provenance == "fallback"
    assert all(r["grounded"] is False for r in result.value)


# --- every model-backed capability carries the envelope ---------------------


async def test_classify_carries_provenance():
    result = await classify(mock_settings(), "how many beds are free?")
    assert result.value == "ward_state"
    assert result.provenance == "mock"


async def test_classify_unknown_route_counts_as_fallback(monkeypatch):
    """A route the allow-list rejects means keyword matching decided it."""

    async def nonsense(settings, messages):
        return {"path": "something-else"}

    monkeypatch.setattr(classify_mod, "chat_json", nonsense)
    result = await classify(live_settings(), "how many beds are free?")
    assert result.provenance == "fallback"
    assert result.value == "ward_state"


async def test_query_intent_carries_provenance():
    result = await build_query_intent(mock_settings(), "how many beds are free?")
    assert result.provenance == "mock"
    assert result.value["aggregation"] == "count"


async def test_narrate_carries_provenance():
    result = await narrate_briefing(mock_settings(), {"stats": {"net_beds": -3}})
    assert result.provenance == "mock"
    assert result.value["briefing"]


async def test_narrate_empty_briefing_counts_as_fallback(monkeypatch):
    async def empty(settings, messages):
        return {"briefing": "   "}

    monkeypatch.setattr(narrate_mod, "chat_json", empty)
    result = await narrate_briefing(live_settings(), {"stats": {"net_beds": -3}})
    assert result.provenance == "fallback"
    assert result.value["briefing"], "the mock's prose is still returned"


# --- empty-input short circuits never claim to be live ----------------------


async def test_refusal_with_no_passages_is_not_live():
    result = await answer_from_passages(live_settings(), "q", [])
    assert result.provenance == "mock"
    assert result.model_used is None
    assert result.value["grounded"] is False


# --- the wire contract ------------------------------------------------------

# Every route that can return model output, and a body that exercises it.
MODEL_ROUTES = [
    ("/extract", {"note_id": "n1", "text": "Awaiting TTOs from pharmacy."}),
    ("/copilot/route", {"question": "how many beds are free?"}),
    ("/copilot/query-intent", {"question": "how many beds are free?"}),
    (
        "/copilot/answer",
        {"question": "how long for TTOs?", "passages": PASSAGES, "kind": "policy"},
    ),
    ("/agent/recommend", {"patient_label": "Bed 1", "barriers": BARRIERS, "policy": PASSAGES}),
    ("/forecast/narrate", {"stats": {"net_beds": -3, "window_hours": 12}}),
]


@pytest.mark.parametrize("path,body", MODEL_ROUTES)
def test_every_model_route_returns_the_envelope(path, body, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.settings import get_settings

    monkeypatch.setenv("NIM_MOCK", "true")
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    # Tokenless now fails closed (spec v0.12.0); tests opt in explicitly.
    monkeypatch.setenv("AI_ALLOW_INSECURE_NO_TOKEN", "true")
    get_settings.cache_clear()

    # As a context manager so the lifespan runs — /extract needs app.state.limiter.
    with TestClient(app) as client:
        res = client.post(path, json=body)
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["provenance"] == "mock"
    assert payload["model_used"] is None

    get_settings.cache_clear()


@pytest.mark.parametrize("path", ["/forecast/discharge", "/forecast/demand"])
def test_deterministic_forecast_routes_carry_no_provenance(path, monkeypatch):
    """These are closed-form arithmetic with no model in either mode, so a
    live/mock label would imply a choice that is never made.
    """
    from fastapi.testclient import TestClient

    from app.main import app
    from app.settings import get_settings

    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("AI_ALLOW_INSECURE_NO_TOKEN", "true")
    get_settings.cache_clear()

    res = TestClient(app).post(path, json={})
    assert res.status_code == 200, res.text
    assert "provenance" not in res.json()

    get_settings.cache_clear()
