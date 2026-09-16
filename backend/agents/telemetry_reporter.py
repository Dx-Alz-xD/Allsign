"""Turns a session log into a ClinicalReport.

The numbers in the report (duration, stuttering reduction, fatigue flag, DAF recommendation) are computed
here from the biomarker samples and feedback events with fixed rules. The language model only writes the
two-to-three sentence summary for the speech-language pathologist; whatever it puts in the numeric fields
is replaced by the computed values before the report leaves this module.
"""

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models import Model

from agents.llm import agent_model

# MDVP thresholds, the same ones biomarker.worker uses for its strain index.
JITTER_THRESHOLD_PERCENT = 1.04
SHIMMER_THRESHOLD_DB = 0.35
STRAIN_FATIGUE_INDEX = 60.0
STRAIN_PEAK_INDEX = 75.0
STRAIN_WINDOW_MS = 30_000
MIN_SAMPLES_PER_WINDOW = 5
# DAF delays the fluency worklet supports; 50 - 75 ms is where most people who stutter respond.
DAF_MIN_MS = 30
DAF_MAX_MS = 150
DAF_DEFAULT_MS = 60
DAF_STEP_MS = 25
REDUCTION_KEEP_THRESHOLD = 0.2
BLOCKS_PER_MINUTE_FOR_DAF = 2.0

FeedbackKind = Literal["daf", "fsf", "block"]


class StrainSample(BaseModel):
    """One biomarker reading. Timestamps are milliseconds since the session started."""

    timestamp: float = Field(ge=0)
    jitterPercent: float = Field(ge=0, le=100)
    shimmerDb: float = Field(ge=0, le=60)
    hnrDb: float = Field(ge=-20, le=60)
    strainIndex: float = Field(ge=0, le=100)
    pitchHz: Optional[float] = Field(default=None, ge=0, le=2000)


class FeedbackEvent(BaseModel):
    """daf/fsf: feedback switched on or changed (value = delay in ms / shift in octaves). block: a vocal block (value = ms)."""

    timestamp: float = Field(ge=0)
    kind: FeedbackKind
    value: float = 0


class SessionLog(BaseModel):
    sessionId: Optional[str] = None
    startedAt: Optional[datetime] = None
    profileMode: Optional[str] = None
    samples: list[StrainSample] = Field(default_factory=list, max_length=20_000)
    events: list[FeedbackEvent] = Field(default_factory=list, max_length=5_000)
    dafDelayMs: float = Field(default=0, ge=0, le=1000)
    fsfOctaveShift: float = Field(default=0, ge=-1, le=1)
    speakingMs: Optional[float] = Field(default=None, ge=0)


class ClinicalReport(BaseModel):
    session_duration_minutes: float = Field(ge=0)
    stuttering_reduction_index: float = Field(ge=-1, le=1, description="1 = blocks stopped once feedback was on, 0 = no change or no baseline")
    vocal_fatigue_alert: bool
    slp_summary_paragraph: str = Field(min_length=1, max_length=1200, description="2-3 sentences on pitch stability and vocal fatigue trends")
    recommended_daf_delay_ms: int = Field(ge=0, le=1000)


@dataclass
class SessionMetrics:
    duration_minutes: float
    blocks_total: int
    blocks_before_feedback: int
    blocks_with_feedback: int
    minutes_before_feedback: float
    minutes_with_feedback: float
    reduction_index: float
    fatigue_alert: bool
    fatigue_reason: str
    mean_jitter: float
    mean_shimmer: float
    mean_hnr: float
    mean_strain: float
    strain_trend: float
    jitter_trend: float
    pitch_sd_hz: float
    daf_activations: int
    fsf_activations: int
    recommended_daf_ms: int


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    centre = _mean(values)
    return (sum((value - centre) ** 2 for value in values) / (len(values) - 1)) ** 0.5


def _trend(samples: list[StrainSample], pick) -> float:
    """Last third minus first third of the session, so a rising value comes out positive."""
    if len(samples) < 6:
        return 0.0
    third = len(samples) // 3
    return _mean([pick(sample) for sample in samples[-third:]]) - _mean([pick(sample) for sample in samples[:third]])


def _fatigue(samples: list[StrainSample]) -> tuple[bool, str]:
    if not samples:
        return False, "no biomarker samples"
    third = max(1, len(samples) // 3)
    late_strain = _mean([sample.strainIndex for sample in samples[-third:]])
    if late_strain >= STRAIN_FATIGUE_INDEX:
        return True, f"mean strain index {late_strain:.0f} over the last third of the session"
    # Any 30 s window with a high mean strain.
    start = 0
    for end, sample in enumerate(samples):
        while sample.timestamp - samples[start].timestamp > STRAIN_WINDOW_MS:
            start += 1
        window = samples[start : end + 1]
        if len(window) >= MIN_SAMPLES_PER_WINDOW and _mean([item.strainIndex for item in window]) >= STRAIN_PEAK_INDEX:
            return True, f"a 30 s window with mean strain index above {STRAIN_PEAK_INDEX:.0f}"
    late = samples[-third:]
    if _mean([s.jitterPercent for s in late]) > JITTER_THRESHOLD_PERCENT and _mean([s.shimmerDb for s in late]) > SHIMMER_THRESHOLD_DB:
        return True, "jitter and shimmer both above the MDVP thresholds in the last third of the session"
    return False, "strain stayed below the fatigue thresholds"


def _recommend_daf(log: SessionLog, blocks_per_minute: float, reduction: float, feedback_on: bool) -> int:
    current = int(round(log.dafDelayMs))
    if feedback_on and current > 0:
        if reduction >= REDUCTION_KEEP_THRESHOLD:
            return max(DAF_MIN_MS, min(DAF_MAX_MS, current))
        return max(DAF_MIN_MS, min(DAF_MAX_MS, current + DAF_STEP_MS))
    if blocks_per_minute >= BLOCKS_PER_MINUTE_FOR_DAF:
        return DAF_DEFAULT_MS
    return 0


def compute_metrics(log: SessionLog) -> SessionMetrics:
    samples = sorted(log.samples, key=lambda sample: sample.timestamp)
    events = sorted(log.events, key=lambda event: event.timestamp)
    last_ms = max([sample.timestamp for sample in samples] + [event.timestamp for event in events] + [0.0])
    duration_minutes = last_ms / 60_000

    feedback_events = [event for event in events if event.kind in ("daf", "fsf")]
    feedback_start = feedback_events[0].timestamp if feedback_events else None
    blocks = [event for event in events if event.kind == "block"]
    before = [event for event in blocks if feedback_start is None or event.timestamp < feedback_start]
    after = [event for event in blocks if feedback_start is not None and event.timestamp >= feedback_start]
    minutes_before = (feedback_start if feedback_start is not None else last_ms) / 60_000
    minutes_after = (last_ms - feedback_start) / 60_000 if feedback_start is not None else 0.0

    reduction = 0.0
    if feedback_start is not None and minutes_before > 0 and minutes_after > 0 and before:
        rate_before = len(before) / minutes_before
        rate_after = len(after) / minutes_after
        reduction = max(-1.0, min(1.0, 1 - rate_after / rate_before))

    blocks_per_minute = len(blocks) / duration_minutes if duration_minutes > 0 else 0.0
    fatigue, reason = _fatigue(samples)
    pitches = [sample.pitchHz for sample in samples if sample.pitchHz]

    return SessionMetrics(
        duration_minutes=round(duration_minutes, 2),
        blocks_total=len(blocks),
        blocks_before_feedback=len(before),
        blocks_with_feedback=len(after),
        minutes_before_feedback=round(minutes_before, 2),
        minutes_with_feedback=round(minutes_after, 2),
        reduction_index=round(reduction, 3),
        fatigue_alert=fatigue,
        fatigue_reason=reason,
        mean_jitter=round(_mean([s.jitterPercent for s in samples]), 3),
        mean_shimmer=round(_mean([s.shimmerDb for s in samples]), 3),
        mean_hnr=round(_mean([s.hnrDb for s in samples]), 2),
        mean_strain=round(_mean([s.strainIndex for s in samples]), 1),
        strain_trend=round(_trend(samples, lambda s: s.strainIndex), 1),
        jitter_trend=round(_trend(samples, lambda s: s.jitterPercent), 3),
        pitch_sd_hz=round(_stdev(pitches), 1),
        daf_activations=sum(1 for event in events if event.kind == "daf"),
        fsf_activations=sum(1 for event in events if event.kind == "fsf"),
        recommended_daf_ms=_recommend_daf(log, blocks_per_minute, reduction, feedback_start is not None),
    )


INSTRUCTIONS = """You write the summary paragraph of a vocal-health report for a speech-language pathologist.
The measurements come from on-device signal processing (jitter, shimmer, harmonics-to-noise ratio, a 0-100
vocal strain index, vocal blocks, and delayed / frequency-shifted auditory feedback events). They are given to
you already computed. Copy every number into the matching field exactly as given; do not invent, round or
estimate any value.

slp_summary_paragraph: two or three plain sentences. Cover (1) pitch stability, from jitter, its trend and the
pitch standard deviation, and (2) vocal fatigue, from the strain index trend and the fatigue flag. Mention the
feedback result when feedback was used. No diagnosis, no treatment claims, no greeting."""

reporter = Agent(
    output_type=ClinicalReport,
    instructions=INSTRUCTIONS,
    retries=2,
    name="telemetry_reporter",
)


def metrics_prompt(metrics: SessionMetrics, log: SessionLog) -> str:
    lines = [
        f"session_duration_minutes: {metrics.duration_minutes}",
        f"stuttering_reduction_index: {metrics.reduction_index}",
        f"vocal_fatigue_alert: {'true' if metrics.fatigue_alert else 'false'} ({metrics.fatigue_reason})",
        f"recommended_daf_delay_ms: {metrics.recommended_daf_ms}",
        "",
        f"samples: {len(log.samples)}; mean jitter {metrics.mean_jitter} % (MDVP threshold {JITTER_THRESHOLD_PERCENT}), "
        f"jitter trend {metrics.jitter_trend:+} %; mean shimmer {metrics.mean_shimmer} dB (threshold {SHIMMER_THRESHOLD_DB}); "
        f"mean HNR {metrics.mean_hnr} dB; pitch standard deviation {metrics.pitch_sd_hz} Hz",
        f"strain index: mean {metrics.mean_strain}, trend {metrics.strain_trend:+} (last third minus first third)",
        f"vocal blocks: {metrics.blocks_total} total, {metrics.blocks_before_feedback} in {metrics.minutes_before_feedback} min "
        f"before feedback, {metrics.blocks_with_feedback} in {metrics.minutes_with_feedback} min with feedback",
        f"feedback: DAF {log.dafDelayMs} ms switched on {metrics.daf_activations} time(s); "
        f"FSF {log.fsfOctaveShift:+} octave switched on {metrics.fsf_activations} time(s)",
    ]
    return "\n".join(lines)


def generate_report(log: SessionLog, *, model: Model | None = None) -> ClinicalReport:
    metrics = compute_metrics(log)
    result = reporter.run_sync(metrics_prompt(metrics, log), model=model or agent_model())
    summary = " ".join(result.output.slp_summary_paragraph.split())
    return ClinicalReport(
        session_duration_minutes=metrics.duration_minutes,
        stuttering_reduction_index=metrics.reduction_index,
        vocal_fatigue_alert=metrics.fatigue_alert,
        slp_summary_paragraph=summary,
        recommended_daf_delay_ms=metrics.recommended_daf_ms,
    )
