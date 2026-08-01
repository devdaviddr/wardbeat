"""Service-token auth (spec v0.12.0 M5): the AI plane fails CLOSED.

An empty AI_SERVICE_TOKEN used to disable auth entirely, so a deploy-time
misconfiguration silently opened every model endpoint. Now: no token
configured → every protected route is refused with 503 naming the missing
config; tokenless local dev must opt in via AI_ALLOW_INSECURE_NO_TOKEN=true.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.settings import get_settings


def _clear_auth_env(monkeypatch):
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("AI_ALLOW_INSECURE_NO_TOKEN", raising=False)
    get_settings.cache_clear()


def test_unconfigured_token_denies_everything(monkeypatch):
    _clear_auth_env(monkeypatch)

    res = TestClient(app).get("/config")
    assert res.status_code == 503
    # The detail must name the missing config so the operator can fix it.
    assert "AI_SERVICE_TOKEN" in res.json()["detail"]

    get_settings.cache_clear()


def test_unconfigured_token_denies_model_routes_too(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("NIM_MOCK", "true")
    get_settings.cache_clear()

    with TestClient(app) as client:
        res = client.post(
            "/extract",
            json={"note_id": "n1", "encounter_id": "e1", "text": "Awaiting TTOs."},
        )
    assert res.status_code == 503

    get_settings.cache_clear()


def test_healthz_stays_open_when_unconfigured(monkeypatch):
    """The compose healthcheck hits /healthz without a token; liveness must
    not depend on auth config."""
    _clear_auth_env(monkeypatch)

    assert TestClient(app).get("/healthz").status_code == 200

    get_settings.cache_clear()


def test_wrong_or_missing_token_is_401_when_configured(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("AI_SERVICE_TOKEN", "right-token")
    get_settings.cache_clear()

    client = TestClient(app)
    assert client.get("/config").status_code == 401
    assert (
        client.get("/config", headers={"x-service-token": "wrong-token"}).status_code
        == 401
    )

    get_settings.cache_clear()


def test_correct_token_is_accepted(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("AI_SERVICE_TOKEN", "right-token")
    get_settings.cache_clear()

    res = TestClient(app).get("/config", headers={"x-service-token": "right-token"})
    assert res.status_code == 200
    assert res.json()["service_token_required"] is True

    get_settings.cache_clear()


def test_explicit_insecure_optin_allows_tokenless_dev(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("AI_ALLOW_INSECURE_NO_TOKEN", "true")
    get_settings.cache_clear()

    res = TestClient(app).get("/config")
    assert res.status_code == 200
    assert res.json()["service_token_required"] is False

    get_settings.cache_clear()
