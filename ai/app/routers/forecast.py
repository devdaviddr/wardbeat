from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.forecast import demand_forecast, discharge_forecast
from app.security import require_service_token

router = APIRouter(prefix="/forecast", dependencies=[Depends(require_service_token)])


class PatientFeatures(BaseModel):
    id: str
    mffd: bool = False
    open_barriers: int = 0
    has_transport: bool = False
    has_social_care: bool = False
    has_review: bool = False
    days_admitted: int = 0
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
    window_hours: int = 12


class DemandResponse(BaseModel):
    expected_admissions: int
    net_beds: int


@router.post("/demand", response_model=DemandResponse)
async def demand(req: DemandRequest) -> DemandResponse:
    return DemandResponse(
        **demand_forecast(req.free_beds, req.predicted_discharges, req.window_hours)
    )
