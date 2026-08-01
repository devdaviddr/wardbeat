from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from typing import Any, Optional

from app.forecast import demand_forecast, discharge_forecast
from app.narrate import narrate_briefing
from app.schemas import ProvenanceEnvelope
from app.security import require_service_token
from app.settings import get_settings

# /discharge and /demand carry no provenance: they are closed-form arithmetic
# with no model behind them in either mode, so a `live`/`mock` label would imply
# a choice that is never made. Only /narrate calls a model.
router = APIRouter(prefix="/forecast", dependencies=[Depends(require_service_token)])


class PatientFeatures(BaseModel):
    id: str
    mffd: bool = False
    open_barriers: int = 0
    has_transport: bool = False
    has_social_care: bool = False
    has_review: bool = False
    # None = the caller has no admission timestamp for this patient. The model
    # then applies no over-stay penalty rather than assuming a length of stay.
    days_admitted: Optional[int] = None
    edd_set: bool = False


class DischargeRequest(BaseModel):
    patients: list[PatientFeatures] = Field(default_factory=list)


class DischargeItem(BaseModel):
    id: str
    p_discharge_24h: float
    predicted_days: int


class DischargeResponse(BaseModel):
    forecasts: list[DischargeItem]


@router.post("/discharge", response_model=DischargeResponse)
async def discharge(req: DischargeRequest) -> DischargeResponse:
    out = [
        DischargeItem(id=p.id, **discharge_forecast(p.model_dump()))
        for p in req.patients
    ]
    return DischargeResponse(forecasts=out)


class DemandRequest(BaseModel):
    free_beds: int = 0
    predicted_discharges: int = 0
    # Admissions the caller counted over the trailing 7 days, straight from its
    # own encounter records. None = it could not read the history at all; that
    # is distinct from a genuine count of 0.
    admissions_last_7d: Optional[int] = None
    window_hours: int = 12


class DemandResponse(BaseModel):
    """`expected_admissions` and `net_beds` are `None` whenever the history is
    too thin to project from. They are never defaulted to a number — the whole
    point of the field is that a caller must handle the absence.
    """

    expected_admissions: Optional[float] = None
    net_beds: Optional[float] = None
    insufficient_history: bool = False
    # Plain-English explanation for the UI when the figures are absent.
    reason: Optional[str] = None
    # The basis, echoed back so a caller can show its working.
    admissions_last_7d: Optional[int] = None
    window_hours: int = 12


@router.post("/demand", response_model=DemandResponse)
async def demand(req: DemandRequest) -> DemandResponse:
    return DemandResponse(
        **demand_forecast(
            req.free_beds,
            req.predicted_discharges,
            req.admissions_last_7d,
            req.window_hours,
        )
    )


class NarrateRequest(BaseModel):
    stats: dict[str, Any] = Field(default_factory=dict)
    at_risk: list[dict[str, Any]] = Field(default_factory=list)
    predicted_discharges: list[dict[str, Any]] = Field(default_factory=list)
    # Why the demand figures are missing from `stats`, so the narrator can say
    # so instead of quietly leaving a hole. Length-capped: this string is
    # interpolated into the prompt, and it is the only free text on this route.
    demand_unavailable_reason: Optional[str] = Field(default=None, max_length=200)


class NarrateResponse(ProvenanceEnvelope):
    briefing: str


@router.post("/narrate", response_model=NarrateResponse)
async def narrate(req: NarrateRequest) -> NarrateResponse:
    result = await narrate_briefing(get_settings(), req.model_dump())
    return NarrateResponse(
        **result.value,
        provenance=result.provenance,
        model_used=result.model_used,
    )
