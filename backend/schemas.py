from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional

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
    name: str
    spectralFingerprint: List[float] = Field(..., min_length=128, max_length=128)
    mappedPhrase: str
    targetAction: str = "DIRECT_PASTE"
    threshold: float = 0.85

class AcousticTriggerCreate(AcousticTriggerBase):
    pass

class AcousticTriggerOut(AcousticTriggerBase):
    model_config = ConfigDict(from_attributes=True)

    id: str

class SessionAnalyticsSchema(BaseModel):
    wpm: float
    stutterCount: int
    avgBlockDurationMs: float
    fluencyPercentage: float
    sessionDurationSeconds: int