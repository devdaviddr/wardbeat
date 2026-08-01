import json

from fastapi.testclient import TestClient

from app.main import app
from app.settings import get_settings

client = TestClient(app)


def _reset_settings():
    get_settings.cache_clear()


def test_config_shape_and_mock_mode(monkeypatch):
    monkeypatch.setenv("NIM_MOCK", "true")
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    # No token now fails closed (spec v0.12.0); tokenless dev must opt in.
    monkeypatch.setenv("AI_ALLOW_INSECURE_NO_TOKEN", "true")
    _reset_settings()

    res = client.get("/config")
    assert res.status_code == 200
    body = res.json()

    # documented keys present
    for key in (
        "service_version",
        "mode",
        "models",
        "endpoint_host",
        "rate_limit_rpm",
        "timeout_seconds",
        "embed_dim",
        "api_key_configured",
        "service_token_required",
    ):
        assert key in body

    assert body["mode"] == "mock"
    assert set(body["models"]) == {"extract", "embed", "rerank"}
    assert body["api_key_configured"] is False
    assert body["service_token_required"] is False

    _reset_settings()


def test_config_live_mode_when_key_present(monkeypatch):
    monkeypatch.setenv("NIM_MOCK", "false")
    monkeypatch.setenv("NVIDIA_API_KEY", "super-secret-key-value")
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("AI_ALLOW_INSECURE_NO_TOKEN", "true")
    _reset_settings()

    body = client.get("/config").json()
    assert body["mode"] == "live"
    assert body["api_key_configured"] is True

    _reset_settings()


def test_config_never_leaks_secrets(monkeypatch):
    """The serialised response must contain neither secret value, only presence."""
    monkeypatch.setenv("NIM_MOCK", "false")
    monkeypatch.setenv("NVIDIA_API_KEY", "leak-canary-api-key")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "leak-canary-service-token")
    _reset_settings()

    # Send the token so the request passes auth and the serialised config
    # body itself is what gets checked (unauthenticated it would only ever
    # assert on the 401/503 error body).
    raw = json.dumps(
        client.get(
            "/config", headers={"x-service-token": "leak-canary-service-token"}
        ).json()
    )
    assert "leak-canary-api-key" not in raw
    assert "leak-canary-service-token" not in raw
    assert "nvidia_api_key" not in raw
    assert "ai_service_token" not in raw

    _reset_settings()
