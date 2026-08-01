from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.answer import answer_from_passages
from app.classify import classify
from app.query_intent import build_query_intent
from app.rerank import rerank
from app.schemas import ProvenanceEnvelope
from app.security import require_service_token
from app.settings import get_settings

router = APIRouter(prefix="/copilot", dependencies=[Depends(require_service_token)])


class RouteRequest(BaseModel):
    question: str


class RouteResponse(ProvenanceEnvelope):
    path: str


@router.post("/route", response_model=RouteResponse)
async def route(req: RouteRequest) -> RouteResponse:
    result = await classify(get_settings(), req.question)
    return RouteResponse(
        path=result.value,
        provenance=result.provenance,
        model_used=result.model_used,
    )


class QueryIntentRequest(BaseModel):
    question: str


class QueryIntentResponse(ProvenanceEnvelope):
    # The filter itself is nested so the envelope can never be mistaken for part
    # of it — the caller validates `intent` against its own allow-list.
    intent: dict[str, Any] = Field(default_factory=dict)


@router.post("/query-intent", response_model=QueryIntentResponse)
async def query_intent(req: QueryIntentRequest) -> QueryIntentResponse:
    result = await build_query_intent(get_settings(), req.question)
    return QueryIntentResponse(
        intent=result.value,
        provenance=result.provenance,
        model_used=result.model_used,
    )


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
    kind: Literal["policy", "ward"] = "policy"


class AnswerResponse(ProvenanceEnvelope):
    answer: str
    citations: list[str]
    grounded: bool


@router.post("/answer", response_model=AnswerResponse)
async def answer(req: AnswerRequest) -> AnswerResponse:
    result = await answer_from_passages(
        get_settings(),
        req.question,
        [p.model_dump() for p in req.passages],
        kind=req.kind,
    )
    return AnswerResponse(
        **result.value,
        provenance=result.provenance,
        model_used=result.model_used,
    )
