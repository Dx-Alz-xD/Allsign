from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Annotated, List, Literal, Optional

FINGERPRINT_BINS = 128
MAX_SPEECH_TOKENS = 256
MAX_TOKEN_CHARS = 64

# Mirror ProfileMode and AcousticTriggerProfile['targetAction'] in shared/types.ts.
ProfileMode = Literal["clearvoice", "fluency", "vocal_assist", "therapy", "aphasia", "sensory", "pitch_demo"]
TriggerAction = Literal["DIRECT_PASTE", "TTS_SPOKEN", "WEBRTC_ALERT", "OS_HOTKEY"]

# Fingerprints are 128-bin power spectra (audio.worker.ts spectralBins), so bins are >= 0. JSON has no
# NaN/Infinity either, and a stored non-finite bin would make every later read fail to serialize.
SpectralBin = Annotated[float, Field(ge=0.0, allow_inf_nan=False)]
SpectralFingerprint = Annotated[List[SpectralBin], Field(min_length=FINGERPRINT_BINS, max_length=FINGERPRINT_BINS)]
TriggerName = Annotated[str, Field(min_length=1, max_length=100)]
TriggerPhrase = Annotated[str, Field(min_length=1, max_length=500)]
TriggerThreshold = Annotated[float, Field(ge=0.0, le=1.0)]

class GrammarRequestSchema(BaseModel):
    rawSpeechTokens: List[Annotated[str, Field(max_length=MAX_TOKEN_CHARS)]] = Field(
        ..., max_length=MAX_SPEECH_TOKENS, description="Atypical speech tokens extracted from ASR"
    )
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

class AcousticMatchRequest(BaseModel):
    spectralFingerprint: SpectralFingerprint
    topK: int = Field(3, ge=1, le=20, description="How many ranked candidates to return")

class AcousticMatchCandidate(BaseModel):
    triggerId: str
    name: str
    mappedPhrase: str
    targetAction: TriggerAction
    threshold: float
    score: float = Field(..., description="Similarity, 0-1")
    distance: float = Field(..., description="1 - score")

class AcousticMatchResponse(BaseModel):
    matched: bool
    trigger: Optional[AcousticMatchCandidate] = Field(
        None, description="The best candidate, present only when it clears its own threshold"
    )
    candidates: List[AcousticMatchCandidate] = Field(..., description="Best first")
    levelDb: float
    silent: bool = Field(..., description="Below the silence floor, so nothing can match")
    executionLatencyMs: float

class SessionAnalyticsSchema(BaseModel):
    wpm: float
    stutterCount: int
    avgBlockDurationMs: float
    fluencyPercentage: float
    sessionDurationSeconds: int