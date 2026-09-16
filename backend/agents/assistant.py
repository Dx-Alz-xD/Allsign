"""The Voicematics Onboarding Assistant behind the website's chat widget.

Two tools, both plain arithmetic and lookup tables, so the numbers the assistant quotes are the same ones
the desktop app is built on:

- simulate_dsp_delay(sample_rate)      the capture -> analysis latency budget for a given microphone rate
- recommend_settings(disfluency_type)  starting DAF delay and pitch shift per disfluency type
"""

import math
import os
from typing import Literal, Optional

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart
from pydantic_ai.models import Model

from agents.llm import agent_model

SYSTEM_PROMPT = (
    "You are the Voicematics Onboarding Assistant. Help users configure local acoustic settings and understand "
    "zero-cloud DSP privacy."
)
GUARDRAILS = """
Facts you may rely on:
- Voicematics analyzes the voice on the user's computer (Web Audio worklets, FFT, LPC formant tracking). Audio is
  never recorded or uploaded, and no speech or language model is in the speech path. Recognized words go to the
  Voicematics server, where a rule-based NLTK context-free grammar rebuilds them into sentences; they are not saved.
- Voicematics runs with a Voicematics account. Free: ClearVoice, Aphasia Mode, the Sensory HUD and one acoustic
  trigger. Pro (monthly or annual) and Lifetime add the Fluency Coach (DAF / FSF), Therapy Mode, unlimited
  triggers, sharing over the Caregiver Link, session analytics and clinical reports. The account keeps the
  triggers, presets, session summaries and therapy targets the user saves; a paid licence works on one computer
  at a time.
- Language models are used only on request: you, on this website, and the clinical report, whose summary is
  written from a session's voice measurements (never audio). You never hear the microphone.
- Delayed auditory feedback (DAF) supports 30-150 ms; frequency-shifted feedback (FSF) supports -6 to +6
  semitones (half an octave each way). Settings apply live from the control panel.
- The analysis budget is under 15 ms per frame; use simulate_dsp_delay for the actual numbers.
Rules:
- Use recommend_settings for DAF / pitch-shift starting points and say they are starting points, not
  prescriptions; suggest working with a speech-language pathologist for clinical decisions.
- Keep answers short and concrete. If you do not know, say so. Do not claim features the facts above do not list.
"""

DisfluencyType = Literal["stuttering", "dysarthria", "aphasia"]

TARGET_RATE_HZ = 16_000
WORKLET_QUANTUM_FRAMES = 128
PASSBAND_HZ = 7_000
STOPBAND_HZ = 8_000
MIN_TAPS = 31
MAX_TAPS = 1_023
ANALYSIS_HOP_FRAMES = 160
# Per-hop worker time measured by the vitest suite on a laptop (audio + biomarker + formant chain); the HUD
# shows the live figure.
PROCESSING_MS_PER_HOP = 0.6
LATENCY_BUDGET_MS = 15.0

SETTINGS_BY_TYPE: dict[str, dict[str, object]] = {
    "stuttering": {
        "dafDelayMs": 60,
        "pitchShiftSemitones": -6,
        "rationale": (
            "Most people who stutter respond to 50-75 ms of delay; a half-octave downward shift adds the "
            "chorus effect. Raise the delay in 25 ms steps if blocks continue."
        ),
    },
    "dysarthria": {
        "dafDelayMs": 100,
        "pitchShiftSemitones": 0,
        "rationale": (
            "Longer delays (100-150 ms) slow speech rate and help articulation; pitch shift adds nothing for "
            "dysarthria, so it stays off."
        ),
    },
    "aphasia": {
        "dafDelayMs": 0,
        "pitchShiftSemitones": 0,
        "rationale": (
            "Auditory feedback does not address word-finding or word order. Use ClearVoice grammar "
            "reconstruction and the phoneme word finder instead; feedback stays off."
        ),
    },
}


class DspDelayEstimate(BaseModel):
    sampleRate: int
    captureQuantumMs: float = Field(description="One AudioWorklet block of 128 frames at the microphone rate")
    antiAliasTaps: int
    antiAliasGroupDelayMs: float = Field(description="Half the FIR length: the resampler's own delay (0 when no resampling)")
    resampleRatio: float
    analysisHopMs: float = Field(description="Results update every 160 samples at 16 kHz")
    processingMsPerHop: float
    endToEndMs: float = Field(description="Sound in -> analysis out: quantum + filter delay + processing")
    averageMs: float = Field(description="endToEndMs plus half a hop: what a sound waits on average for its frame")
    worstCaseMs: float = Field(description="endToEndMs plus a full hop, when the sound lands just after a frame boundary")
    budgetMs: float
    withinBudget: bool


class SettingsRecommendation(BaseModel):
    disfluencyType: DisfluencyType
    dafDelayMs: int
    pitchShiftSemitones: int
    rationale: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class ToolCallRecord(BaseModel):
    name: str
    args: dict
    result: object


class ChatResponse(BaseModel):
    reply: str
    toolCalls: list[ToolCallRecord]
    modelName: str


def simulate_dsp_delay(sample_rate: int) -> DspDelayEstimate:
    """Expected capture-to-analysis latency for a microphone sample rate in Hz (e.g. 48000 or 44100).

    Reproduces the desktop app's arithmetic: a 128-frame worklet block, the Hamming-windowed anti-alias FIR
    the capture worklet designs for that rate, a 10 ms analysis hop at 16 kHz, and the measured per-hop
    worker time. Shows whether the total stays under the 15 ms budget.
    """
    rate = max(8_000, min(384_000, int(sample_rate)))
    quantum_ms = WORKLET_QUANTUM_FRAMES / rate * 1000
    if rate > TARGET_RATE_HZ:
        transition = (STOPBAND_HZ - PASSBAND_HZ) / rate
        taps = math.ceil(3.3 / transition)
        if taps % 2 == 0:
            taps += 1
        taps = min(MAX_TAPS, max(MIN_TAPS, taps))
        group_delay_ms = (taps - 1) / 2 / rate * 1000
    else:
        taps, group_delay_ms = 1, 0.0
    hop_ms = ANALYSIS_HOP_FRAMES / TARGET_RATE_HZ * 1000
    end_to_end = quantum_ms + group_delay_ms + PROCESSING_MS_PER_HOP
    average = end_to_end + hop_ms / 2
    worst = end_to_end + hop_ms
    return DspDelayEstimate(
        sampleRate=rate,
        captureQuantumMs=round(quantum_ms, 2),
        antiAliasTaps=taps,
        antiAliasGroupDelayMs=round(group_delay_ms, 2),
        resampleRatio=round(rate / TARGET_RATE_HZ, 4),
        analysisHopMs=hop_ms,
        processingMsPerHop=PROCESSING_MS_PER_HOP,
        endToEndMs=round(end_to_end, 2),
        averageMs=round(average, 2),
        worstCaseMs=round(worst, 2),
        budgetMs=LATENCY_BUDGET_MS,
        withinBudget=worst < LATENCY_BUDGET_MS,
    )


def recommend_settings(disfluency_type: DisfluencyType) -> SettingsRecommendation:
    """Starting DAF delay (ms) and pitch shift (semitones) for stuttering, dysarthria or aphasia."""
    entry = SETTINGS_BY_TYPE[disfluency_type]
    return SettingsRecommendation(
        disfluencyType=disfluency_type,
        dafDelayMs=int(entry["dafDelayMs"]),
        pitchShiftSemitones=int(entry["pitchShiftSemitones"]),
        rationale=str(entry["rationale"]),
    )


assistant = Agent(
    instructions=SYSTEM_PROMPT + "\n" + GUARDRAILS,
    retries=2,
    name="onboarding_assistant",
)
assistant.tool_plain(simulate_dsp_delay)
assistant.tool_plain(recommend_settings)


def to_message_history(messages: list[ChatMessage]) -> list[ModelMessage]:
    history: list[ModelMessage] = []
    for message in messages:
        if message.role == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=message.content)]))
        else:
            history.append(ModelResponse(parts=[TextPart(content=message.content)]))
    return history


def _tool_calls(messages: list[ModelMessage]) -> list[ToolCallRecord]:
    calls: dict[str, ToolCallRecord] = {}
    for message in messages:
        for part in message.parts:
            if isinstance(part, ToolCallPart):
                calls[part.tool_call_id] = ToolCallRecord(name=part.tool_name, args=part.args_as_dict(), result=None)
            elif isinstance(part, ToolReturnPart) and part.tool_call_id in calls:
                content = part.content
                calls[part.tool_call_id].result = content.model_dump() if isinstance(content, BaseModel) else content
    return list(calls.values())


def chat(request: ChatRequest, *, model: Optional[Model] = None) -> ChatResponse:
    """Answers the last user message with the earlier turns as history."""
    if request.messages[-1].role != "user":
        raise ValueError("The last message must be from the user.")
    history = to_message_history(request.messages[:-1])
    result = assistant.run_sync(request.messages[-1].content, message_history=history, model=model or agent_model())
    return ChatResponse(
        reply=result.output,
        toolCalls=_tool_calls(result.new_messages()),
        modelName=result.response.model_name or "unknown",
    )
