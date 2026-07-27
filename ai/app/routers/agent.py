from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.recommend import recommend_actions
from app.security import require_service_token
from app.settings import get_settings

router = APIRouter(prefix="/agent", dependencies=[Depends(require_service_token)])


class RecBarrier(BaseModel):
    id: str
    type: str
    quote: str = ""


class RecPolicy(BaseModel):
    text: str
    source: str = ""


class RecommendRequest(BaseModel):
    patient_label: str
    barriers: list[RecBarrier] = Field(default_factory=list)
    policy: list[RecPolicy] = Field(default_factory=list)


class RecommendationItem(BaseModel):
    barrier_id: str
    action_type: str
    title: str
    rationale: str
    priority: int
    citations: list[int]
    grounded: bool


class RecommendResponse(BaseModel):
    recommendations: list[RecommendationItem]


@router.post("/recommend", response_model=RecommendResponse)
async def recommend(req: RecommendRequest) -> RecommendResponse:
    recs = await recommend_actions(
        get_settings(),
        req.patient_label,
        [b.model_dump() for b in req.barriers],
        [p.model_dump() for p in req.policy],
    )
    return RecommendResponse(recommendations=[RecommendationItem(**r) for r in recs])
