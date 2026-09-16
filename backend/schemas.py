from datetime import datetime, timezone
from typing import Annotated, Dict, List, Literal, Optional, Union

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

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

def as_utc(value: datetime) -> datetime:
    # SQLite drops the offset, so stored timestamps come back naive; they were written in UTC.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

UtcDatetime = Annotated[datetime, AfterValidator(as_utc)]
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]

class GrammarRequestSchema(BaseModel):
    rawSpeechTokens: List[Annotated[str, Field(max_length=MAX_TOKEN_CHARS)]] = Field(
        ..., max_length=MAX_SPEECH_TOKENS, description="Atypical speech tokens extracted from ASR"
    )
    sourceLang: str = "en"
    targetProfile: ProfileMode = "clearvoice"

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

# Mirror ProfilePresetInput / ProfilePreset in shared/types.ts. Ranges follow fluencyProcessor.js.
MAX_DAF_DELAY_MS = 150.0
MAX_FSF_OCTAVE_SHIFT = 0.5
MAX_PRESET_PARAMETERS = 32
PresetName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
PresetParameterKey = Annotated[str, StringConstraints(min_length=1, max_length=64)]
PresetParameter = Union[
    None, bool, int, FiniteFloat, Annotated[str, StringConstraints(max_length=500)]
]

class ProfilePresetInput(BaseModel):
    name: PresetName
    mode: ProfileMode
    dafDelayMs: Annotated[float, Field(ge=0.0, le=MAX_DAF_DELAY_MS)] = 0.0
    fsfOctaveShift: Annotated[float, Field(ge=-MAX_FSF_OCTAVE_SHIFT, le=MAX_FSF_OCTAVE_SHIFT)] = 0.0
    parameters: Annotated[
        Dict[PresetParameterKey, PresetParameter], Field(max_length=MAX_PRESET_PARAMETERS)
    ] = Field(default_factory=dict)

class ProfilePresetOut(ProfilePresetInput):
    model_config = ConfigDict(from_attributes=True)

    id: str
    createdAt: UtcDatetime
    updatedAt: UtcDatetime

# Mirror SessionAnalyticsInput / SessionAnalytics / SessionSummary in shared/types.ts.
class SessionAnalyticsInput(BaseModel):
    profileMode: Optional[ProfileMode] = None
    wpm: Annotated[float, Field(ge=0.0, allow_inf_nan=False)]
    stutterCount: Annotated[int, Field(ge=0)]
    avgBlockDurationMs: Annotated[float, Field(ge=0.0, allow_inf_nan=False)]
    fluencyPercentage: Annotated[float, Field(ge=0.0, le=100.0)]
    sessionDurationSeconds: Annotated[int, Field(ge=0)]

class SessionAnalyticsOut(SessionAnalyticsInput):
    model_config = ConfigDict(from_attributes=True)

    id: str
    recordedAt: UtcDatetime

class SessionSummary(BaseModel):
    profileMode: Optional[ProfileMode] = Field(None, description="The filter applied, null for all sessions")
    sessions: int
    totalSeconds: int
    totalStutters: int
    averageWpm: float = Field(..., description="Weighted by session length")
    averageFluencyPercentage: float = Field(..., description="Weighted by session length")
    averageBlockDurationMs: float = Field(..., description="Weighted by block count")
    firstRecordedAt: Optional[UtcDatetime] = None
    lastRecordedAt: Optional[UtcDatetime] = None

# Mirror PhonemeTargetInput / PhonemeTarget in shared/types.ts. Formants stay below the 8 kHz Nyquist limit.
MAX_FORMANT_HZ = 8000.0
Formant = Annotated[float, Field(gt=0.0, le=MAX_FORMANT_HZ)]

class PhonemeTargetInput(BaseModel):
    phoneme: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16)]
    exampleWord: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]] = None
    f1: Formant
    f2: Formant
    f3: Formant

class PhonemeTargetOut(PhonemeTargetInput):
    model_config = ConfigDict(from_attributes=True)

    id: str
    createdAt: UtcDatetime

# Mirror PhonemeLookupResponse in shared/types.ts.
class PhonemeLookupWord(BaseModel):
    word: str
    arpabet: str
    frequency: Optional[int] = None

class PhonemeLookupBranch(BaseModel):
    phoneme: str
    wordCount: int
    topWord: Optional[str] = None

class PhonemeLookupResponse(BaseModel):
    prefix: List[str] = Field(..., description="Normalised ARPAbet symbols, stress removed")
    found: bool
    wordCount: int
    words: List[PhonemeLookupWord] = Field(..., description="Most frequent first")
    next: List[PhonemeLookupBranch] = Field(..., description="Largest branch first")

# Mirror CaregiverRole and SignalMessage in shared/types.ts. Peers send offer, answer and ice, which the relay
# forwards unchanged; joined, peer-joined, peer-left and error come from the relay itself.
CaregiverRole = Literal["speaker", "caregiver"]
MAX_SDP_CHARS = 32_000
MAX_ICE_CHARS = 2_000

class SignalOffer(BaseModel):
    type: Literal["offer"]
    sdp: Annotated[str, StringConstraints(max_length=MAX_SDP_CHARS)]

class SignalAnswer(BaseModel):
    type: Literal["answer"]
    sdp: Annotated[str, StringConstraints(max_length=MAX_SDP_CHARS)]

class SignalIce(BaseModel):
    type: Literal["ice"]
    candidate: Annotated[str, StringConstraints(max_length=MAX_ICE_CHARS)]
    sdpMid: Optional[Annotated[str, StringConstraints(max_length=64)]] = None
    sdpMLineIndex: Optional[Annotated[int, Field(ge=0, le=1024)]] = None

PeerSignal = Annotated[Union[SignalOffer, SignalAnswer, SignalIce], Field(discriminator="type")]

class SignalJoined(BaseModel):
    type: Literal["joined"] = "joined"
    room: str
    role: CaregiverRole
    peerPresent: bool

class SignalPeerJoined(BaseModel):
    type: Literal["peer-joined"] = "peer-joined"
    role: CaregiverRole

class SignalPeerLeft(BaseModel):
    type: Literal["peer-left"] = "peer-left"
    role: CaregiverRole

class SignalError(BaseModel):
    type: Literal["error"] = "error"
    message: str
