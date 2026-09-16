"""Deterministic FFT peak matching for micro-acoustic AAC triggers.

Fingerprints use the spectral layout of frontend/src/workers/audio.worker.ts: 16 kHz audio, 1024-sample
Hann-windowed frames, Parseval-scaled power, FFT bins summed in groups of 4 (128 bins, 62.5 Hz each).
power_spectrum() reproduces that computation so backend fixtures and benchmarks match the live worker.

A query (one frame, or the mean power of a few consecutive frames) matches a stored trigger when
similarity >= the trigger's threshold. Similarity blends three gain-independent views of the dB envelope
(3-bin smoothed, floored 30 dB below its maximum):
  - shape (60%): correlation of the mean-removed envelopes,
  - band (20%): share of the query's power inside the template's strongest band, relative to the template's,
  - peaks (20%): overlap of the prominent envelope peaks within two bins, averaged over both directions.
Frames quieter than the worker's silence floor never match.
"""

import cmath
import heapq
import math
from collections.abc import Sequence
from dataclasses import dataclass
from operator import mul

from schemas import FINGERPRINT_BINS

SAMPLE_RATE = 16_000
FRAME_SIZE = 1024
BIN_GROUP = FRAME_SIZE // 2 // FINGERPRINT_BINS
BIN_HZ = SAMPLE_RATE / FRAME_SIZE * BIN_GROUP
SILENT_DB = -120.0
SILENCE_FLOOR_DB = -60.0
DEFAULT_THRESHOLD = 0.85

SMOOTHING_BINS = 3
DYNAMIC_RANGE_DB = 30.0
SUPPORT_RANGE_DB = 15.0
SHAPE_WEIGHT = 0.6
BAND_WEIGHT = 0.2
PEAK_WEIGHT = 0.2
MAX_PEAKS = 6
PEAK_PROMINENCE_DB = 6.0
PEAK_TOLERANCE_BINS = 2

_HANN = [0.5 - 0.5 * math.cos(2 * math.pi * i / FRAME_SIZE) for i in range(FRAME_SIZE)]
_POWER_SCALE = 1 / (FRAME_SIZE * math.fsum(w * w for w in _HANN))
_BIT_REVERSED = [int(format(i, f"0{FRAME_SIZE.bit_length() - 1}b")[::-1], 2) for i in range(FRAME_SIZE)]
_LEVEL_ROOTS = []
_size = 2
while _size <= FRAME_SIZE:
    _LEVEL_ROOTS.append((_size, [cmath.exp(-2j * math.pi * k / _size) for k in range(_size // 2)]))
    _size *= 2


def power_spectrum(frame: Sequence[float]) -> list[float]:
    """128-bin power spectrum of one 1024-sample frame, as audio.worker.ts computeSpectrum() produces it."""
    if len(frame) != FRAME_SIZE:
        raise ValueError(f"expected {FRAME_SIZE} samples, got {len(frame)}")
    data = [complex(frame[i] * _HANN[i]) for i in _BIT_REVERSED]
    for size, roots in _LEVEL_ROOTS:
        half = size // 2
        for start in range(0, FRAME_SIZE, size):
            for k, root in enumerate(roots):
                low, high = start + k, start + k + half
                rotated = data[high] * root
                data[high] = data[low] - rotated
                data[low] += rotated

    bins = []
    for bin_index in range(FINGERPRINT_BINS):
        start = bin_index * BIN_GROUP
        energy = 0.0
        for k in range(start, start + BIN_GROUP):
            value = data[k]
            power = (value.real * value.real + value.imag * value.imag) * _POWER_SCALE
            energy += power * 2 if k > 0 else power
        bins.append(energy)
    return bins


def to_db(power: float) -> float:
    return max(SILENT_DB, 10 * math.log10(power)) if power > 0 else SILENT_DB


@dataclass(frozen=True)
class SpectralProfile:
    level_db: float
    shape: tuple[float, ...]
    peaks: tuple[int, ...]
    support: tuple[int, ...]
    band_ratio: float
    powers: tuple[float, ...]
    total_power: float


def _smooth(values: list[float]) -> list[float]:
    reach = SMOOTHING_BINS // 2
    smoothed = []
    for index in range(len(values)):
        window = values[max(0, index - reach) : index + reach + 1]
        smoothed.append(math.fsum(window) / len(window))
    return smoothed


def spectral_profile(bins: Sequence[float]) -> SpectralProfile:
    if len(bins) != FINGERPRINT_BINS:
        raise ValueError(f"expected {FINGERPRINT_BINS} bins, got {len(bins)}")
    # Bin 0 is DC and mains hum territory; it carries no trigger identity.
    powers = tuple(bins[1:])
    total_power = math.fsum(powers)
    envelope = _smooth([to_db(power) for power in powers])
    top = max(envelope)

    floored = [max(value, top - DYNAMIC_RANGE_DB) for value in envelope]
    mean = math.fsum(floored) / len(floored)
    centered = [value - mean for value in floored]
    norm = math.sqrt(math.fsum(value * value for value in centered))
    shape = tuple(value / norm for value in centered) if norm > 0 else tuple(0.0 for _ in centered)

    support = tuple(index for index, value in enumerate(envelope) if value >= top - SUPPORT_RANGE_DB)
    band_ratio = math.fsum(powers[index] for index in support) / total_power if total_power > 0 else 0.0
    return SpectralProfile(
        level_db=to_db(math.fsum(bins)),
        shape=shape,
        peaks=_prominent_peaks(envelope),
        support=support,
        band_ratio=band_ratio,
        powers=powers,
        total_power=total_power,
    )


def _prominent_peaks(envelope: list[float]) -> tuple[int, ...]:
    median = sorted(envelope)[len(envelope) // 2]
    last = len(envelope) - 1
    candidates = [
        index
        for index, value in enumerate(envelope)
        if value - median >= PEAK_PROMINENCE_DB
        and (index == 0 or value >= envelope[index - 1])
        and (index == last or value > envelope[index + 1])
    ]
    strongest = sorted(candidates, key=lambda index: (-envelope[index], index))[:MAX_PEAKS]
    return tuple(sorted(strongest))


def _peak_recall(reference: tuple[int, ...], other: tuple[int, ...]) -> float:
    hits = sum(1 for peak in reference if any(abs(peak - candidate) <= PEAK_TOLERANCE_BINS for candidate in other))
    return hits / len(reference)


def _shape_score(query: SpectralProfile, template: SpectralProfile) -> float:
    return max(0.0, math.fsum(map(mul, query.shape, template.shape)))


def similarity(query: SpectralProfile, template: SpectralProfile) -> float:
    return _combined_score(query, template, _shape_score(query, template))


def _combined_score(query: SpectralProfile, template: SpectralProfile, shape: float) -> float:
    if query.total_power > 0 and template.band_ratio > 0:
        in_band = math.fsum(query.powers[index] for index in template.support) / query.total_power
        band = min(1.0, in_band / template.band_ratio)
    else:
        band = 0.0
    if query.peaks and template.peaks:
        peaks = (_peak_recall(template.peaks, query.peaks) + _peak_recall(query.peaks, template.peaks)) / 2
    else:
        peaks = 0.0 if query.peaks or template.peaks else 1.0
    return SHAPE_WEIGHT * shape + BAND_WEIGHT * band + PEAK_WEIGHT * peaks


@dataclass(frozen=True)
class TriggerTemplate:
    trigger_id: str
    profile: SpectralProfile
    threshold: float = DEFAULT_THRESHOLD

    @classmethod
    def from_fingerprint(
        cls, trigger_id: str, fingerprint: Sequence[float], threshold: float = DEFAULT_THRESHOLD
    ) -> "TriggerTemplate":
        return cls(trigger_id, spectral_profile(fingerprint), threshold)


@dataclass(frozen=True)
class MatchResult:
    trigger_id: str | None
    score: float


@dataclass(frozen=True)
class RankedTrigger:
    template: TriggerTemplate
    score: float


def rank(
    bins: Sequence[float], templates: Sequence[TriggerTemplate], limit: int = 1
) -> tuple[SpectralProfile, list[RankedTrigger]]:
    """The query's profile and its `limit` best triggers, best first; ties keep template order.

    Frames below the silence floor rank nothing.
    """
    if limit < 1:
        raise ValueError("limit must be at least 1")
    query = spectral_profile(bins)
    if query.level_db < SILENCE_FLOOR_DB:
        return query, []
    # Min-heap of (score, -position, template): the weakest kept candidate sits on top.
    kept: list[tuple[float, int, TriggerTemplate]] = []
    for position, template in enumerate(templates):
        shape = _shape_score(query, template.profile)
        # Band and peak terms add at most BAND_WEIGHT + PEAK_WEIGHT, so this template cannot displace
        # the weakest kept candidate; skipping it leaves the result unchanged.
        if len(kept) == limit and SHAPE_WEIGHT * shape + BAND_WEIGHT + PEAK_WEIGHT <= kept[0][0]:
            continue
        entry = (_combined_score(query, template.profile, shape), -position, template)
        if len(kept) < limit:
            heapq.heappush(kept, entry)
        elif entry[:2] > kept[0][:2]:
            heapq.heapreplace(kept, entry)
    kept.sort(key=lambda item: (-item[0], -item[1]))
    return query, [RankedTrigger(template, score) for score, _, template in kept]


def match(bins: Sequence[float], templates: Sequence[TriggerTemplate]) -> MatchResult:
    """Best-scoring trigger for a query spectrum; trigger_id is None when it does not clear its threshold."""
    _, ranked = rank(bins, templates)
    if not ranked:
        return MatchResult(None, 0.0)
    best = ranked[0]
    return MatchResult(best.template.trigger_id if best.score >= best.template.threshold else None, best.score)


def average_fingerprint(spectra: Sequence[Sequence[float]]) -> list[float]:
    """Enrollment fingerprint from several takes: the mean power per bin."""
    if not spectra:
        raise ValueError("need at least one spectrum")
    return [math.fsum(values) / len(spectra) for values in zip(*spectra)]
