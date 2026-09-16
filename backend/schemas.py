from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Annotated, List, Literal, Optional

FINGERPRINT_BINS = 128

# Mirror ProfileMode and AcousticTriggerProfile['targetAction'] in shared/types.ts.
ProfileMode = Literal["clearvoice", "fluency", "vocal_assist", "therapy", "aphasia", "sensory", "pitch_demo"]
TriggerAction = Literal["DIRECT_PASTE", "TTS_SPOKEN", "WEBRTC_ALERT", "OS_HOTKEY"]

# JSON has no NaN/Infinity, so a stored non-finite bin would make every later read fail to serialize.
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
SpectralFingerprint = Annotated[List[FiniteFloat], Field(min_length=FINGERPRINT_BINS, max_length=FINGERPRINT_BINS)]
TriggerName = Annotated[str, Field(min_length=1, max_length=100)]
TriggerPhrase = Annotated[str, Field(min_length=1, max_length=500)]
TriggerThreshold = Annotated[float, Field(ge=0.0, le=1.0)]

class GrammarRequestSchema(BaseModel):
    rawSpeechTokens: List[str] = Field(..., description="Atypical speech tokens extracted from ASR")
    sourceLang: str = "en"
    targetProfile: str = "clearvoice"

class GrammarResponseSchema(BaseModel):
    formattedText: str
    parsedTree: str
    originalTokens: List[str]
    executionLatencyMs: float

class AcousticTriggerBase(BaseModel):
    name: TriggerName
    spectralFingerprint: SpectralFingerprint
    mappedPhrase: TriggerPhrase
    targetAction: TriggerAction = "DIRECT_PASTE"
    threshold: TriggerThreshold = 0.85

class AcousticTriggerCreate(AcousticTriggerBase):
    pass

class AcousticTriggerUpdate(BaseModel):
    """Partial update: omitted fields keep their stored value; explicit nulls are rejected."""

    name: Optional[TriggerName] = None
    spectralFingerprint: Optional[SpectralFingerprint] = None
    mappedPhrase: Optional[TriggerPhrase] = None
    targetAction: Optional[TriggerAction] = None
    threshold: Optional[TriggerThreshold] = None

    @model_validator(mode="after")
    def reject_nulls(self) -> "AcousticTriggerUpdate":
        nulls = sorted(name for name in self.model_fields_set if getattr(self, name) is None)
        if nulls:
            raise ValueError(f"fields cannot be null: {', '.join(nulls)}")
        return self

class AcousticTriggerOut(AcousticTriggerBase):
    model_config = ConfigDict(from_attributes=True)

    id: str

class SessionAnalyticsSchema(BaseModel):
    wpm: float
    stutterCount: int
    avgBlockDurationMs: float
    fluencyPercentage: float
    sessionDurationSeconds: int