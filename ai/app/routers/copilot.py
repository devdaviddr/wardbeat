from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.answer import answer_from_passages
from app.rerank import rerank
from app.security import require_service_token
from app.settings import get_settings

router = APIRouter(prefix="/copilot", dependencies=[Depends(require_service_token)])


class RerankRequest(BaseModel):
    query: str
    passages: list[str] = Field(default_factory=list)
    top_n: int = 4


class RerankResponse(BaseModel):
    order: list[int]
    reranked: bool


@router.post("/rerank", response_model=RerankResponse)
async def rerank_passages(req: RerankRequest) -> RerankResponse:
    order, reranked = await rerank(
        get_settings(), req.query, req.passages, req.top_n
    )
    return RerankResponse(order=order, reranked=reranked)


class Passage(BaseModel):
    id: str
    text: str
    source: str = ""


class AnswerRequest(BaseModel):
    question: str
    passages: list[Passage] = Field(default_factory=list)


class AnswerResponse(BaseModel):
    answer: str
    citations: list[str]
    grounded: bool


@router.post("/answer", response_model=AnswerResponse)
async def answer(req: AnswerRequest) -> AnswerResponse:
    result = await answer_from_passages(
        get_settings(),
        req.question,
        [p.model_dump() for p in req.passages],
    )
    return AnswerResponse(**result)
