from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.embeddings import embed
from app.schemas import ProvenanceEnvelope
from app.security import require_service_token
from app.settings import get_settings

router = APIRouter()


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)
    input_type: Literal["query", "passage"] = "passage"


class EmbedResponse(ProvenanceEnvelope):
    model: str
    dim: int
    embeddings: list[list[float]]


@router.post(
    "/embed",
    response_model=EmbedResponse,
    dependencies=[Depends(require_service_token)],
)
async def embed_texts(req: EmbedRequest) -> EmbedResponse:
    """Embeddings carry provenance like every other model output.

    The mock path is an md5 hashing trick, not a semantic embedding, so a caller
    that cannot tell the two apart can store hash vectors and query with real
    ones — same dimensionality, no error, garbage retrieval. That is exactly the
    drift `policy_chunks.embedding_model` guards against; provenance is the
    per-response half of the same protection.
    """
    settings = get_settings()
    vectors = await embed(settings, req.texts, req.input_type)
    model = "mock" if settings.use_mock else settings.nim_embed_model
    return EmbedResponse(
        model=model,
        dim=settings.embed_dim,
        embeddings=vectors,
        provenance="mock" if settings.use_mock else "live",
        model_used=None if settings.use_mock else model,
    )
