from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.security import require_service_token
from app.settings import get_settings

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "mock": s.use_mock,
        "model": "mock" if s.use_mock else s.nim_extract_model,
    }


class ModelIds(BaseModel):
    extract: str
    embed: str
    rerank: str


class ConfigResponse(BaseModel):
    """Non-sensitive AI-plane configuration for the Settings view. Secrets are
    reduced to presence booleans and never serialised as values."""

    service_version: str
    mode: str  # "mock" | "live"
    models: ModelIds
    endpoint_host: str
    rate_limit_rpm: int
    timeout_seconds: float
    embed_dim: int
    api_key_configured: bool
    service_token_required: bool


@router.get(
    "/config",
    response_model=ConfigResponse,
    dependencies=[Depends(require_service_token)],
)
async def config() -> ConfigResponse:
    """Report how the AI plane is wired, for the app's Settings view. Internal
    only (shared service token). Built field-by-field from an allow-list so no
    secret (NVIDIA_API_KEY, AI_SERVICE_TOKEN) can ever be included.
    """
    s = get_settings()
    return ConfigResponse(
        service_version="0.2.0",
        mode="mock" if s.use_mock else "live",
        models=ModelIds(
            extract=s.nim_extract_model,
            embed=s.nim_embed_model,
            rerank=s.nim_rerank_model,
        ),
        endpoint_host=urlparse(s.nim_base_url).netloc or s.nim_base_url,
        rate_limit_rpm=s.nim_rpm,
        timeout_seconds=s.nim_timeout,
        embed_dim=s.embed_dim,
        api_key_configured=bool(s.nvidia_api_key),
        service_token_required=bool(s.ai_service_token),
    )
