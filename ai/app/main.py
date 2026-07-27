import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.ratelimit import RateLimiter
from app.routers import copilot, embed, extract, health
from app.settings import get_settings

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.limiter = RateLimiter(settings.nim_rpm)
    logging.getLogger("wardbeat.ai").info(
        "AI plane up — mock=%s model=%s rpm=%s",
        settings.use_mock,
        settings.nim_extract_model,
        settings.nim_rpm,
    )
    yield


app = FastAPI(
    title="WardBeat AI plane",
    version="0.2.0",
    description="Barrier extraction over NVIDIA NIM (spec v0.2.0). Internal only.",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(extract.router)
app.include_router(embed.router)
app.include_router(copilot.router)
