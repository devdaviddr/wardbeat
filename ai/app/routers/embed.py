from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.embeddings import embed
from app.security import require_service_token
from app.settings import get_settings

router = APIRouter()


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)
    input_type: Literal["query", "passage"] = "passage"


class EmbedResponse(BaseModel):
    model: str
    dim: int
    embeddings: list[list[float]]


@router.post(
    "/embed",
    response_model=EmbedResponse,
    dependencies=[Depends(require_service_token)],
)
async def embed_texts(req: EmbedRequest) -> EmbedResponse:
    settings = get_settings()
    vectors = await embed(settings, req.texts, req.input_type)
    return EmbedResponse(
        model="mock" if settings.use_mock else settings.nim_embed_model,
        dim=settings.embed_dim,
        embeddings=vectors,
    )
