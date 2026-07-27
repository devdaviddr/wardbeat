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

    # Service auth ----------------------------------------------------------
    # Shared secret; Next.js sends it as X-Service-Token. Empty = auth disabled
    # (dev convenience only).
    ai_service_token: str = ""

    # Rate-limit budget for the free hosted tier (~40 RPM); keep headroom.
    nim_rpm: int = 30

    # Model call timeout (seconds).
    nim_timeout: float = 30.0

    @property
    def use_mock(self) -> bool:
        """Fall back to the mock whenever mock is on OR no key is present."""
        return self.nim_mock or not self.nvidia_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
