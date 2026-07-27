from fastapi import APIRouter, Depends, Request

from app.extract.pipeline import extract_note
from app.schemas import ExtractRequest, ExtractionResult
from app.security import require_service_token
from app.settings import get_settings

router = APIRouter()


@router.post(
    "/extract",
    response_model=ExtractionResult,
    dependencies=[Depends(require_service_token)],
)
async def extract(req: ExtractRequest, request: Request) -> ExtractionResult:
    settings = get_settings()
    limiter = request.app.state.limiter
    return await extract_note(settings, limiter, req.note_id, req.text)
