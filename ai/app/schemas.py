from typing import Literal, Optional

from pydantic import BaseModel, Field

BarrierType = Literal["tto", "transport", "social_care", "review", "other"]
BarrierStatus = Literal["pending", "in_progress", "cleared"]


class ExtractRequest(BaseModel):
    note_id: str
    encounter_id: Optional[str] = None
    text: str = Field(min_length=1)


class SourceSpan(BaseModel):
    """Provenance: where in the note this barrier was found."""

    start: Optional[int] = None
    end: Optional[int] = None
    quote: str


class BarrierOut(BaseModel):
    type: BarrierType
    status: BarrierStatus = "pending"
    source: SourceSpan
    confidence: int = Field(ge=0, le=100, default=80)


class ExtractionResult(BaseModel):
    note_id: str
    model: str
    edd: Optional[str] = None  # ISO date (YYYY-MM-DD)
    mffd_flag: bool = False
    barriers: list[BarrierOut] = Field(default_factory=list)
    escalations: list[str] = Field(default_factory=list)
    # False if the model returned barriers we could not ground back to the note
    # text; ungrounded barriers are dropped before this result is returned.
    grounded: bool = True
