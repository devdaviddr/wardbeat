from fastapi import APIRouter

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
