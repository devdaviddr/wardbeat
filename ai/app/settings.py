from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration for the WardBeat AI plane.

    Read from the environment (the Compose `ai` service passes these in). Keep
    NIM_MOCK=true to run fully offline with deterministic extraction; set it to
    false with a real NVIDIA_API_KEY to hit the hosted NIM endpoint.
    """

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    # Extraction backend ----------------------------------------------------
    nim_mock: bool = True
    nvidia_api_key: str = ""
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    nim_extract_model: str = "nvidia/nvidia-nemotron-nano-9b-v2"
    nim_embed_model: str = "nvidia/nv-embedqa-e5-v5"
    nim_rerank_model: str = "nvidia/llama-3.2-nv-rerankqa-1b-v2"
    embed_dim: int = 1024

    # Service auth ----------------------------------------------------------
    # Shared secret; Next.js sends it as X-Service-Token. Empty = auth disabled
    # (dev convenience only).
    ai_service_token: str = ""

    # Rate-limit budget for the free hosted tier (~40 RPM); keep headroom.
    nim_rpm: int = 30

    # Model call timeout (seconds).
    nim_timeout: float = 30.0

    # Completion token budget for extraction. Nemotron is a reasoning model, so
    # this covers reasoning + the JSON payload; 1024 comfortably fits a note's
    # barriers while keeping per-call latency (and the hang risk) down. Raise it
    # only if extractions start getting truncated (empty content / finish_reason
    # == "length").
    nim_extract_max_tokens: int = 1024

    @property
    def use_mock(self) -> bool:
        """Fall back to the mock whenever mock is on OR no key is present."""
        return self.nim_mock or not self.nvidia_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
