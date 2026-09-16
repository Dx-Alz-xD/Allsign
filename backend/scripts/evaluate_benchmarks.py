"""Evaluation harness for the Laptop 3 backend; writes EVALUATION_REPORT.md.

Suites:
  grammar   AST CFG transduction accuracy and latency on tests/test_grammar.py::CASES.
  acoustic  FFT peak matching (acoustic_matcher.py) accuracy and latency on a seeded synthetic set of AAC
            trigger sounds, rendered through the audio worker's 128-bin spectrum.
  database  SQLite query latency on a temporary database (triggers, sessions, phonetic tables) and
            in-process API round trips. The app's own omnivoice.db is never opened.

Run from backend/ (needs requirements-dev.txt):
    venv/Scripts/python.exe scripts/evaluate_benchmarks.py           # full run, about two minutes
    venv/Scripts/python.exe scripts/evaluate_benchmarks.py --quick   # small samples, same report layout

Exits 1 when a grammar case regresses, matching accuracy falls below its floor, or any gated p95 reaches 15 ms.
"""

import argparse
import gc
import itertools
import math
import platform
import random
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from operator import add
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import fastapi  # noqa: E402
import nltk  # noqa: E402
import sqlalchemy  # noqa: E402
from sqlalchemy import func, insert, select  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

import acoustic_matcher as am  # noqa: E402
import grammar_engine  # noqa: E402
from database import create_database_engine, get_db, init_db  # noqa: E402
from models import (  # noqa: E402
    AcousticTrigger,
    PhonemeTargetWord,
    PhonemeTrieNode,
    Pronunciation,
    SessionAnalytics,
    User,
)
from scripts import kaggle_sync  # noqa: E402
from tests.test_grammar import CASES  # noqa: E402

PIPELINE_TARGET_MS = 15.0
ENGINE_BUDGET_MS = grammar_engine.LATENCY_BUDGET_MS
MATCH_ACCURACY_FLOOR = 0.80
ACOUSTIC_SEED = 2026
DATABASE_SEED = 7
WARMUP_CALLS = 3


@dataclass(frozen=True)
class Scale:
    label: str
    grammar_runs: int
    takes_per_condition: int
    negatives_per_sound: int
    timing_queries: int
    db_repeats: int
    lexicon_words: int
    trigger_library: int
    session_rows: int


FULL = Scale("full", 50, 20, 30, 200, 200, 20_000, 500, 5_000)
QUICK = Scale("quick", 5, 2, 3, 20, 20, 1_500, 40, 200)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Timing:
    samples: int
    mean_ms: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float

    @classmethod
    def of(cls, samples_ms: Iterable[float]) -> "Timing":
        values = sorted(samples_ms)

        def pick(fraction: float) -> float:
            return values[min(len(values) - 1, round(fraction * (len(values) - 1)))]

        return cls(len(values), statistics.fmean(values), pick(0.5), pick(0.95), pick(0.99), values[-1])


def time_calls(call: Callable[[], object], repeats: int) -> Timing:
    for _ in range(WARMUP_CALLS):
        call()
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        call()
        samples.append((time.perf_counter() - start) * 1000)
    return Timing.of(samples)


def settle_gc(freeze: bool) -> None:
    # Same heap treatment as main.py's startup, so timings reflect the served process.
    gc.collect()
    if freeze:
        gc.freeze()


def status(value_ms: float, budget_ms: float = PIPELINE_TARGET_MS) -> str:
    return "PASS" if value_ms < budget_ms else "FAIL"


def fmt_ms(value: float) -> str:
    return f"{value:.2f}"


def fmt_pct(value: float) -> str:
    return f"{value:.1%}"


def timing_cells(timing: Timing) -> str:
    return f"{fmt_ms(timing.p50_ms)} | {fmt_ms(timing.p95_ms)} | {fmt_ms(timing.p99_ms)} | {fmt_ms(timing.max_ms)}"


# ---------------------------------------------------------------------------
# 1. AST CFG grammar
# ---------------------------------------------------------------------------
@dataclass
class GrammarResult:
    rows: list[dict]
    runs: int
    timing: Timing

    @property
    def passed(self) -> int:
        return sum(row["passed"] for row in self.rows)

    @property
    def unexpected(self) -> list[dict]:
        return [row for row in self.rows if not row["passed"] and not row["case"].known_gap]

    @property
    def slowest(self) -> dict:
        return max(self.rows, key=lambda row: row["median_ms"])


def run_grammar(runs: int, freeze_gc: bool) -> GrammarResult:
    for _ in range(WARMUP_CALLS):
        for case in CASES:
            grammar_engine.translate(case.tokens)
    settle_gc(freeze_gc)

    outputs: list[set[str]] = [set() for _ in CASES]
    latencies: list[list[float]] = [[] for _ in CASES]
    # Cases are interleaved across runs so machine noise spreads evenly instead of hitting one case.
    for _ in range(runs):
        for index, case in enumerate(CASES):
            result = grammar_engine.translate(case.tokens)
            outputs[index].add(result.formatted_text)
            latencies[index].append(result.latency_ms)

    rows = []
    for case, seen, samples in zip(CASES, outputs, latencies):
        output = next(iter(seen))
        rows.append({
            "case": case,
            "output": output,
            "passed": len(seen) == 1 and output == case.expected,
            "deterministic": len(seen) == 1,
            "median_ms": statistics.median(samples),
            "max_ms": max(samples),
        })
    return GrammarResult(rows, runs, Timing.of(sample for samples in latencies for sample in samples))


# ---------------------------------------------------------------------------
# 2. FFT peak matching on synthetic AAC sounds
# ---------------------------------------------------------------------------
HOP_SIZE = 320
QUERY_FRAMES = 4
TAKE_SAMPLES = am.FRAME_SIZE + HOP_SIZE * (QUERY_FRAMES - 1)
TIME_AXIS = [2 * math.pi * n / am.SAMPLE_RATE for n in range(TAKE_SAMPLES)]
SNR_CONDITIONS_DB = (40, 20, 10, 5)
ENROLLMENT_TAKES = 3
ENROLLMENT_SNR_DB = 30
ENROLLMENT_LEVEL_DB = -28.0
LEVEL_RANGE_DB = (-40.0, -16.0)
JITTER = 0.05
THRESHOLD_SWEEP = (0.75, 0.80, 0.85, 0.90)


def rms(samples: list[float]) -> float:
    return math.sqrt(math.fsum(value * value for value in samples) / len(samples))


def scale_to(samples: list[float], level_db: float) -> list[float]:
    gain = 10 ** (level_db / 20) / (rms(samples) or 1.0)
    return [value * gain for value in samples]


def sines(rng: random.Random, partials: Iterable[tuple[float, float]]) -> list[float]:
    total = [0.0] * TAKE_SAMPLES
    for frequency, amplitude in partials:
        if 0 < frequency < am.SAMPLE_RATE / 2 - 200 and amplitude > 0:
            phase = rng.uniform(0, 2 * math.pi)
            total = list(map(add, total, [amplitude * math.sin(frequency * t + phase) for t in TIME_AXIS]))
    return total


def voiced(rng: random.Random, f0: float, formants: list[tuple[float, float]]) -> list[float]:
    """Harmonic source shaped by resonances (centre Hz, bandwidth Hz), with per-take pitch/formant jitter."""
    f0 *= rng.uniform(1 - JITTER, 1 + JITTER)
    shifted = [(centre * rng.uniform(1 - JITTER / 2, 1 + JITTER / 2), width) for centre, width in formants]

    def envelope(frequency: float) -> float:
        return 0.03 + math.fsum(1 / (1 + ((frequency - centre) / width) ** 2) for centre, width in shifted)

    return sines(rng, ((k * f0, envelope(k * f0) * k**-0.3) for k in range(1, int(7600 / f0))))


def tone(rng: random.Random, frequency: float) -> list[float]:
    frequency *= rng.uniform(1 - JITTER / 3, 1 + JITTER / 3)
    return sines(rng, [(frequency, 1.0), (2 * frequency, 0.06)])


def burst(rng: random.Random, components: list[tuple[float, float, float]]) -> list[float]:
    """Damped resonances (Hz, decay per second, amplitude) starting at a random onset."""
    onset = rng.randint(0, 600)
    total = [0.0] * TAKE_SAMPLES
    for frequency, decay, amplitude in components:
        frequency *= rng.uniform(1 - JITTER / 2, 1 + JITTER / 2)
        phase = rng.uniform(0, 2 * math.pi)
        for n in range(onset, TAKE_SAMPLES):
            seconds = (n - onset) / am.SAMPLE_RATE
            total[n] += amplitude * math.exp(-decay * seconds) * math.sin(2 * math.pi * frequency * seconds + phase)
    return total


def band_noise(rng: random.Random, low: float, high: float, tilt: float = 0.0) -> list[float]:
    """Random-phase, Rayleigh-amplitude partials on the FFT grid between low and high Hz."""
    partials = []
    frequency = low
    while frequency < high:
        partials.append((frequency, math.sqrt(-2 * math.log(1 - rng.random())) * (low / frequency) ** tilt))
        frequency += am.SAMPLE_RATE / am.FRAME_SIZE
    return sines(rng, partials)


def white(rng: random.Random) -> list[float]:
    return [rng.gauss(0, 1) for _ in range(TAKE_SAMPLES)]


@dataclass(frozen=True)
class SyntheticSound:
    name: str
    description: str
    render: Callable[[random.Random], list[float]] = field(repr=False)
    near_miss: bool = False
    fixed_level_db: float | None = None


ENROLLED_SOUNDS = (
    SyntheticSound("lip_trill", "voiced buzz, f0 45 Hz, broad 1.2 kHz resonance",
                   lambda rng: voiced(rng, 45, [(1200, 500)])),
    SyntheticSound("vowel_a", "sustained vowel, f0 130 Hz, resonances 730/1090/2440 Hz",
                   lambda rng: voiced(rng, 130, [(730, 90), (1090, 110), (2440, 170)])),
    SyntheticSound("vowel_i", "sustained vowel, f0 130 Hz, resonances 270/2290/3010 Hz",
                   lambda rng: voiced(rng, 130, [(270, 60), (2290, 100), (3010, 150)])),
    SyntheticSound("vowel_u", "sustained vowel, f0 130 Hz, resonances 300/870/2240 Hz",
                   lambda rng: voiced(rng, 130, [(300, 60), (870, 90), (2240, 150)])),
    SyntheticSound("whistle", "1.6 kHz whistle", lambda rng: tone(rng, 1600)),
    SyntheticSound("high_whistle", "2.6 kHz whistle", lambda rng: tone(rng, 2600)),
    SyntheticSound("tongue_click", "damped 2.8 + 4.2 kHz transient",
                   lambda rng: burst(rng, [(2800, 300, 1.0), (4200, 400, 0.5)])),
    SyntheticSound("lip_pop", "damped 180 + 700 Hz transient",
                   lambda rng: burst(rng, [(180, 60, 1.0), (700, 120, 0.4)])),
    SyntheticSound("hiss_s", "fricative noise, 4.5-7.5 kHz", lambda rng: band_noise(rng, 4500, 7500)),
    SyntheticSound("hush_sh", "fricative noise, 2-4.5 kHz", lambda rng: band_noise(rng, 2000, 4500)),
)
NEGATIVE_SOUNDS = (
    SyntheticSound("silence", "room noise at -75 dBFS (below the silence gate)", white, fixed_level_db=-75.0),
    SyntheticSound("white_noise", "broadband noise", white),
    SyntheticSound("chord", "C major triad with harmonics",
                   lambda rng: sines(rng, [(f * k, 1 / k) for f in (262, 330, 392) for k in (1, 2, 3)])),
    SyntheticSound("tone_900", "900 Hz tone", lambda rng: tone(rng, 900)),
    SyntheticSound("high_hum", "voiced hum, f0 240 Hz, neutral resonances",
                   lambda rng: voiced(rng, 240, [(500, 100), (1500, 150), (2500, 200)])),
    SyntheticSound("fan", "low-frequency 1/f noise, 60-1500 Hz", lambda rng: band_noise(rng, 60, 1500, tilt=0.5)),
    SyntheticSound("vowel_o", "sustained vowel, resonances 570/840/2410 Hz (near-miss for vowel_a)",
                   lambda rng: voiced(rng, 130, [(570, 80), (840, 90), (2410, 170)]), near_miss=True),
)


def render_take(rng: random.Random, sound: SyntheticSound, snr_db: float, level_db: float | None = None) -> list[float]:
    if level_db is None:
        level_db = sound.fixed_level_db if sound.fixed_level_db is not None else rng.uniform(*LEVEL_RANGE_DB)
    signal = scale_to(sound.render(rng), level_db)
    noise = scale_to(white(rng), level_db - snr_db)
    return list(map(add, signal, noise))


def query_spectrum(samples: list[float]) -> list[float]:
    """Mean power of the 4 overlapping worker frames in a take (about 124 ms of audio)."""
    frames = [samples[i * HOP_SIZE : i * HOP_SIZE + am.FRAME_SIZE] for i in range(QUERY_FRAMES)]
    return am.average_fingerprint([am.power_spectrum(frame) for frame in frames])


@dataclass
class AcousticDataset:
    templates: list[tuple[str, list[float]]]
    positives: list[tuple[str, int, list[float]]]
    negatives: list[tuple[SyntheticSound, int, list[float]]]
    build_seconds: float


def build_acoustic_dataset(scale: Scale, seed: int = ACOUSTIC_SEED) -> AcousticDataset:
    start = time.perf_counter()
    rng = random.Random(seed)
    templates = [
        (sound.name, am.average_fingerprint([
            query_spectrum(render_take(rng, sound, ENROLLMENT_SNR_DB, ENROLLMENT_LEVEL_DB))
            for _ in range(ENROLLMENT_TAKES)
        ]))
        for sound in ENROLLED_SOUNDS
    ]
    positives = [
        (sound.name, snr, query_spectrum(render_take(rng, sound, snr)))
        for sound in ENROLLED_SOUNDS
        for snr in SNR_CONDITIONS_DB
        for _ in range(scale.takes_per_condition)
    ]
    negatives = []
    for sound in NEGATIVE_SOUNDS:
        for _ in range(scale.negatives_per_sound):
            snr = rng.choice(SNR_CONDITIONS_DB)
            negatives.append((sound, snr, query_spectrum(render_take(rng, sound, snr))))
    return AcousticDataset(templates, positives, negatives, time.perf_counter() - start)


@dataclass
class OperatingPoint:
    threshold: float
    correct: int
    wrong: int
    missed: int
    false_accepts: Counter
    positives: int
    negatives: int
    near_miss_negatives: int
    by_snr: dict[int, float]
    by_sound: dict[str, float]

    @property
    def unrelated_negatives(self) -> int:
        return self.negatives - self.near_miss_negatives

    @property
    def unrelated_false_accepts(self) -> int:
        return sum(count for name, count in self.false_accepts.items() if not NEGATIVE_BY_NAME[name].near_miss)

    @property
    def near_miss_false_accepts(self) -> int:
        return sum(count for name, count in self.false_accepts.items() if NEGATIVE_BY_NAME[name].near_miss)

    @property
    def accuracy(self) -> float:
        correct_rejections = self.negatives - sum(self.false_accepts.values())
        return (self.correct + correct_rejections) / (self.positives + self.negatives)

    @property
    def identification(self) -> float:
        return self.correct / self.positives


NEGATIVE_BY_NAME = {sound.name: sound for sound in NEGATIVE_SOUNDS}


@dataclass
class AcousticResult:
    dataset: AcousticDataset
    sweep: list[OperatingPoint]
    default: OperatingPoint
    match_enrolled: Timing
    match_library: Timing
    library_size: int
    profile: Timing
    extraction: Timing


def operating_point(
    threshold: float,
    positive_results: list[tuple[str, int, am.MatchResult]],
    negative_results: list[tuple[SyntheticSound, am.MatchResult]],
) -> OperatingPoint:
    def fired(result: am.MatchResult) -> str | None:
        return result.trigger_id if result.trigger_id is not None and result.score >= threshold else None

    correct = wrong = missed = 0
    snr_hits: Counter = Counter()
    snr_totals: Counter = Counter()
    sound_hits: Counter = Counter()
    sound_totals: Counter = Counter()
    for name, snr, result in positive_results:
        outcome = fired(result)
        snr_totals[snr] += 1
        sound_totals[name] += 1
        if outcome == name:
            correct += 1
            snr_hits[snr] += 1
            sound_hits[name] += 1
        elif outcome is None:
            missed += 1
        else:
            wrong += 1
    false_accepts = Counter(sound.name for sound, result in negative_results if fired(result) is not None)
    return OperatingPoint(
        threshold=threshold,
        correct=correct,
        wrong=wrong,
        missed=missed,
        false_accepts=false_accepts,
        positives=len(positive_results),
        negatives=len(negative_results),
        near_miss_negatives=sum(1 for sound, _ in negative_results if sound.near_miss),
        by_snr={snr: snr_hits[snr] / snr_totals[snr] for snr in SNR_CONDITIONS_DB},
        by_sound={sound.name: sound_hits[sound.name] / sound_totals[sound.name] for sound in ENROLLED_SOUNDS},
    )


def run_acoustic(dataset: AcousticDataset, scale: Scale, freeze_gc: bool) -> AcousticResult:
    # Threshold 0 exposes every best score, so one scoring pass serves the whole sweep.
    scoring = [am.TriggerTemplate.from_fingerprint(name, fingerprint, 0.0) for name, fingerprint in dataset.templates]
    positive_results = [(name, snr, am.match(bins, scoring)) for name, snr, bins in dataset.positives]
    negative_results = [(sound, am.match(bins, scoring)) for sound, _, bins in dataset.negatives]
    sweep = [operating_point(threshold, positive_results, negative_results) for threshold in THRESHOLD_SWEEP]
    default = next(point for point in sweep if point.threshold == am.DEFAULT_THRESHOLD)

    enrolled = [am.TriggerTemplate.from_fingerprint(name, fingerprint) for name, fingerprint in dataset.templates]
    spectra = [bins for _, _, bins in dataset.positives] + [bins for _, _, bins in dataset.negatives]
    decoys = [
        am.TriggerTemplate.from_fingerprint(f"decoy-{index}", bins)
        for index, bins in zip(range(scale.trigger_library - len(enrolled)), itertools.cycle(spectra))
    ]
    library = enrolled + decoys
    settle_gc(freeze_gc)

    queries = itertools.cycle([bins for _, _, bins in dataset.positives])
    match_enrolled = time_calls(lambda: am.match(next(queries), enrolled), scale.timing_queries)
    match_library = time_calls(lambda: am.match(next(queries), library), scale.timing_queries)
    profile = time_calls(lambda: am.spectral_profile(next(queries)), scale.timing_queries)
    frame_rng = random.Random(ACOUSTIC_SEED + 1)
    frames = itertools.cycle([
        render_take(frame_rng, ENROLLED_SOUNDS[index % len(ENROLLED_SOUNDS)], 20)[: am.FRAME_SIZE]
        for index in range(20)
    ])
    extraction = time_calls(lambda: am.power_spectrum(next(frames)), max(20, scale.timing_queries // 4))
    return AcousticResult(dataset, sweep, default, match_enrolled, match_library, len(library), profile, extraction)


# ---------------------------------------------------------------------------
# 3. Database queries and API round trips
# ---------------------------------------------------------------------------
ARPABET_CLASSES = {
    "AA": "vowel", "AE": "vowel", "AH": "vowel", "AO": "vowel", "AW": "vowel", "AY": "vowel", "EH": "vowel",
    "ER": "vowel", "EY": "vowel", "IH": "vowel", "IY": "vowel", "OW": "vowel", "OY": "vowel", "UH": "vowel",
    "UW": "vowel", "B": "stop", "D": "stop", "G": "stop", "K": "stop", "P": "stop", "T": "stop",
    "CH": "affricate", "JH": "affricate", "DH": "fricative", "F": "fricative", "S": "fricative",
    "SH": "fricative", "TH": "fricative", "V": "fricative", "Z": "fricative", "ZH": "fricative",
    "HH": "aspirate", "L": "liquid", "R": "liquid", "M": "nasal", "N": "nasal", "NG": "nasal",
    "W": "semivowel", "Y": "semivowel",
}
TRIGGER_ACTIONS = ("DIRECT_PASTE", "TTS_SPOKEN", "WEBRTC_ALERT", "OS_HOTKEY")
PROFILE_MODES = ("clearvoice", "fluency", "vocal_assist", "therapy", "aphasia", "sensory", "pitch_demo")
BENCHMARK_USERS = 20


def synthetic_lexicon(rng: random.Random, size: int):
    """CMUdict-shaped entries (pseudo-words, ARPAbet, ~7% alternate pronunciations) with Zipf frequencies."""
    vowels = [symbol for symbol, kind in ARPABET_CLASSES.items() if kind == "vowel"]
    consonants = [symbol for symbol, kind in ARPABET_CLASSES.items() if kind != "vowel"]
    letters = "abcdefghijklmnopqrstuvwxyz"

    def pronunciation() -> tuple[str, ...]:
        length = rng.randint(2, 9)
        return tuple(
            f"{rng.choice(vowels)}{rng.randint(0, 2)}" if index % 2 else rng.choice(consonants)
            for index in range(length)
        )

    words: set[str] = set()
    while len(words) < size:
        words.add("".join(rng.choice(letters) for _ in range(rng.randint(2, 10))))
    ordered = sorted(words)
    rng.shuffle(ordered)
    entries = []
    for word in ordered:
        entries.append(kaggle_sync.DictionaryEntry(word, 1, pronunciation()))
        if rng.random() < 0.07:
            entries.append(kaggle_sync.DictionaryEntry(word, 2, pronunciation()))
    frequencies = {word: 10**9 // (rank + 1) for rank, word in enumerate(ordered)}
    return entries, dict(ARPABET_CLASSES), frequencies


@dataclass(frozen=True)
class QueryTiming:
    name: str
    detail: str
    timing: Timing


@dataclass
class DatabaseResult:
    lexicon_source: str
    seed_summary: kaggle_sync.SeedSummary
    triggers: int
    sessions: int
    seed_seconds: float
    queries: list[QueryTiming]
    api: list[QueryTiming]

    @property
    def slowest_query(self) -> QueryTiming:
        return max(self.queries, key=lambda query: query.timing.p95_ms)

    @property
    def slowest_api(self) -> QueryTiming:
        return max(self.api, key=lambda query: query.timing.p95_ms)


def seed_benchmark_database(engine, dataset: AcousticDataset, scale: Scale, rng: random.Random):
    raw_dir = kaggle_sync.DEFAULT_RAW_DIR
    lexicon_datasets = (kaggle_sync.CMUDICT, kaggle_sync.WORD_FREQUENCY)
    if not any(kaggle_sync.missing_files(spec, raw_dir) for spec in lexicon_datasets):
        summary = kaggle_sync.seed_from_raw(raw_dir, engine, trie_vocabulary=scale.lexicon_words)
        source = (
            "CMUdict + web word frequencies from `backend/data/raw` (Kaggle), "
            f"trie over the top {scale.lexicon_words:,} words"
        )
    else:
        entries, classes, frequencies = synthetic_lexicon(rng, scale.lexicon_words)
        summary = kaggle_sync.seed_database(engine, entries, classes, frequencies, trie_vocabulary=scale.lexicon_words)
        source = (
            f"synthetic CMUdict-shaped lexicon ({scale.lexicon_words:,} pseudo-words), because "
            "`backend/data/raw` has not been synced from Kaggle yet"
        )

    spectra = [bins for _, _, bins in dataset.positives] + [bins for _, _, bins in dataset.negatives]
    fingerprints = itertools.cycle(spectra)
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with Session(engine) as session, session.begin():
        users = [User(displayName=f"Benchmark user {index}") for index in range(BENCHMARK_USERS)]
        session.add_all(users)
        session.flush()
        session.add_all(
            AcousticTrigger(
                userId=users[index % BENCHMARK_USERS].id,
                name=f"Trigger {index}",
                spectralFingerprint=next(fingerprints),
                mappedPhrase=f"Mapped phrase {index}",
                targetAction=TRIGGER_ACTIONS[index % len(TRIGGER_ACTIONS)],
            )
            for index in range(scale.trigger_library)
        )
        session.execute(
            insert(SessionAnalytics),
            [
                {
                    "userId": users[index % BENCHMARK_USERS].id,
                    "profileMode": PROFILE_MODES[index % len(PROFILE_MODES)],
                    "wpm": rng.uniform(40, 160),
                    "stutterCount": rng.randint(0, 30),
                    "avgBlockDurationMs": rng.uniform(0, 900),
                    "fluencyPercentage": rng.uniform(50, 100),
                    "sessionDurationSeconds": rng.randint(60, 3600),
                    "recordedAt": started + timedelta(minutes=index),
                }
                for index in range(scale.session_rows)
            ],
        )
    return summary, source


def run_database(dataset: AcousticDataset, scale: Scale, freeze_gc: bool) -> DatabaseResult:
    rng = random.Random(DATABASE_SEED)
    with tempfile.TemporaryDirectory(prefix="omnivoice-bench-", ignore_cleanup_errors=True) as tmp:
        engine = create_database_engine(f"sqlite:///{Path(tmp) / 'benchmark.db'}")
        try:
            init_db(engine)
            seed_start = time.perf_counter()
            summary, source = seed_benchmark_database(engine, dataset, scale, rng)
            seed_seconds = time.perf_counter() - seed_start
            queries = time_database_queries(engine, scale, rng, freeze_gc)
            api = time_api_round_trips(engine, scale, freeze_gc)
        finally:
            engine.dispose()
    return DatabaseResult(source, summary, scale.trigger_library, scale.session_rows, seed_seconds, queries, api)


def time_database_queries(engine, scale: Scale, rng: random.Random, freeze_gc: bool) -> list[QueryTiming]:
    with Session(engine) as session:
        trigger_ids = list(session.scalars(select(AcousticTrigger.id)))
        user_ids = list(session.scalars(select(User.id)))
        nodes = list(session.execute(
            select(PhonemeTrieNode.id, PhonemeTrieNode.path).where(PhonemeTrieNode.depth.between(1, 3))
        ))
        slots = list(session.execute(select(PhonemeTargetWord.phoneme, PhonemeTargetWord.position).distinct()))
        words = list(session.scalars(select(Pronunciation.word).where(Pronunciation.trieNodeId.is_not(None))))
    for population in (trigger_ids, nodes, slots, words):
        rng.shuffle(population)

    trigger_cycle = itertools.cycle(trigger_ids)
    user_cycle = itertools.cycle(user_ids)
    node_cycle = itertools.cycle(nodes)
    path_cycle = itertools.cycle([path for _, path in nodes])
    slot_cycle = itertools.cycle(slots)
    word_cycle = itertools.cycle(words[:500])
    action_cycle = itertools.cycle(TRIGGER_ACTIONS)
    write_rng = random.Random(DATABASE_SEED + 1)

    def trigger_by_id():
        with Session(engine) as session:
            session.get(AcousticTrigger, next(trigger_cycle))

    def trigger_page():
        with Session(engine) as session:
            query = (
                select(AcousticTrigger)
                .where(AcousticTrigger.targetAction == next(action_cycle))
                .order_by(AcousticTrigger.createdAt, AcousticTrigger.id)
                .limit(100)
            )
            list(session.scalars(query))

    def load_user_fingerprints():
        with Session(engine) as session:
            session.execute(
                select(AcousticTrigger.id, AcousticTrigger.spectralFingerprint, AcousticTrigger.threshold)
                .where(AcousticTrigger.userId == next(user_cycle))
            ).all()

    def insert_session():
        with Session(engine) as session, session.begin():
            session.add(SessionAnalytics(
                userId=next(user_cycle),
                profileMode="fluency",
                wpm=write_rng.uniform(40, 160),
                stutterCount=write_rng.randint(0, 30),
                avgBlockDurationMs=write_rng.uniform(0, 900),
                fluencyPercentage=write_rng.uniform(50, 100),
                sessionDurationSeconds=write_rng.randint(60, 3600),
            ))

    def fluency_summary():
        with Session(engine) as session:
            recent = (
                select(
                    SessionAnalytics.wpm.label("wpm"),
                    SessionAnalytics.fluencyPercentage.label("fluency"),
                    SessionAnalytics.stutterCount.label("stutters"),
                )
                .where(SessionAnalytics.userId == next(user_cycle))
                .order_by(SessionAnalytics.recordedAt.desc())
                .limit(50)
                .subquery()
            )
            session.execute(
                select(func.avg(recent.c.wpm), func.avg(recent.c.fluency), func.sum(recent.c.stutters))
            ).one()

    def trie_node_by_path():
        with Session(engine) as session:
            session.scalars(select(PhonemeTrieNode).where(PhonemeTrieNode.path == next(path_cycle))).one()

    def next_sound_cues():
        node_id, _ = next(node_cycle)
        with Session(engine) as session:
            list(session.execute(
                select(PhonemeTrieNode.phoneme, PhonemeTrieNode.topWord, PhonemeTrieNode.wordCount)
                .where(PhonemeTrieNode.parentId == node_id)
                .order_by(PhonemeTrieNode.wordCount.desc())
                .limit(10)
            ))

    def words_for_prefix():
        prefix = next(path_cycle)
        with Session(engine) as session:
            list(session.scalars(
                select(Pronunciation.word)
                .where(Pronunciation.trieNodeId.is_not(None))
                .where((Pronunciation.phonemes == prefix) | Pronunciation.phonemes.between(prefix + " ", prefix + "!"))
                .order_by(Pronunciation.frequency.desc())
                .limit(10)
            ))

    def target_words():
        phoneme, position = next(slot_cycle)
        with Session(engine) as session:
            list(session.scalars(
                select(PhonemeTargetWord.word)
                .where(PhonemeTargetWord.phoneme == phoneme, PhonemeTargetWord.position == position)
                .order_by(PhonemeTargetWord.rank)
            ))

    def pronunciation_lookup():
        with Session(engine) as session:
            list(session.scalars(select(Pronunciation).where(Pronunciation.word == next(word_cycle))))

    per_user = scale.trigger_library // BENCHMARK_USERS
    specs = [
        ("Trigger by id", "primary-key lookup (`GET /api/triggers/{id}`)", trigger_by_id),
        ("Trigger page", "100 rows filtered by action, ordered (`GET /api/triggers`)", trigger_page),
        ("Load a user's fingerprints", f"{per_user} triggers with 128-bin blobs decoded", load_user_fingerprints),
        ("Record a session", "insert one `session_analytics` row and commit (fsync)", insert_session),
        ("Fluency summary", "averages over a user's last 50 sessions", fluency_summary),
        ("Trie node by prefix", "unique-index lookup on `phoneme_trie_nodes.path`", trie_node_by_path),
        ("Next-sound cues", "top 10 child nodes by word count", next_sound_cues),
        ("Words under a prefix", "top 10 words by frequency via the phoneme index range", words_for_prefix),
        ("Practice words", "ranked target words for one phoneme and position", target_words),
        ("Pronunciation lookup", "all pronunciations of one word", pronunciation_lookup),
    ]
    settle_gc(freeze_gc)
    return [QueryTiming(name, detail, time_calls(call, scale.db_repeats)) for name, detail, call in specs]


def time_api_round_trips(engine, scale: Scale, freeze_gc: bool) -> list[QueryTiming]:
    from fastapi.testclient import TestClient

    import main

    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def benchmark_db():
        with sessions() as session:
            yield session

    with Session(engine) as session:
        trigger_ids = itertools.cycle(list(session.scalars(select(AcousticTrigger.id).limit(200))))
        fingerprint = session.scalars(select(AcousticTrigger.spectralFingerprint).limit(1)).one()

    original_init_db = main.init_db
    main.app.dependency_overrides[get_db] = benchmark_db
    # The lifespan would otherwise create tables in the app's real database.
    main.init_db = lambda: init_db(engine)
    try:
        with TestClient(main.app) as client:
            specs = [
                ("POST /api/grammar/translate", "garbled SOV phrase through the AST engine",
                 lambda: client.post("/api/grammar/translate", json={"rawSpeechTokens": ["um", "me", "water", "want"]})),
                ("GET /api/triggers/{id}", "one trigger with its 128-bin fingerprint",
                 lambda: client.get(f"/api/triggers/{next(trigger_ids)}")),
                ("GET /api/triggers?limit=100", "100 triggers, fingerprints included",
                 lambda: client.get("/api/triggers", params={"limit": 100})),
                ("POST /api/triggers", "validate 128 finite floats, insert, commit",
                 lambda: client.post("/api/triggers", json={
                     "name": "Benchmark trigger", "spectralFingerprint": fingerprint, "mappedPhrase": "Benchmark phrase",
                 })),
            ]
            for _, _, call in specs:
                response = call()
                if response.status_code >= 400:
                    raise RuntimeError(f"API benchmark request failed: {response.status_code} {response.text[:200]}")
            settle_gc(freeze_gc)
            return [QueryTiming(name, detail, time_calls(call, scale.db_repeats)) for name, detail, call in specs]
    finally:
        main.init_db = original_init_db
        main.app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# Gates and report
# ---------------------------------------------------------------------------
@dataclass
class Evaluation:
    scale: Scale
    grammar: GrammarResult
    acoustic: AcousticResult
    database: DatabaseResult
    duration_seconds: float

    def gated_timings(self) -> list[tuple[str, Timing]]:
        return (
            [("AST grammar transduction", self.grammar.timing),
             ("FFT match, enrolled triggers", self.acoustic.match_enrolled),
             (f"FFT match, {self.acoustic.library_size}-trigger library", self.acoustic.match_library)]
            + [(f"SQLite: {query.name}", query.timing) for query in self.database.queries]
            + [(f"API: {query.name}", query.timing) for query in self.database.api]
        )

    def failures(self) -> list[str]:
        problems = [f"grammar case regressed: {' '.join(row['case'].tokens)!r}" for row in self.grammar.unexpected]
        if self.acoustic.default.accuracy < MATCH_ACCURACY_FLOOR:
            problems.append(
                f"FFT matching accuracy {fmt_pct(self.acoustic.default.accuracy)} is below the "
                f"{fmt_pct(MATCH_ACCURACY_FLOOR)} floor"
            )
        problems += [
            f"{name} p95 {fmt_ms(timing.p95_ms)} ms reaches the {PIPELINE_TARGET_MS:g} ms target"
            for name, timing in self.gated_timings()
            if timing.p95_ms >= PIPELINE_TARGET_MS
        ]
        return problems


def git_revision() -> str:
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=BACKEND_DIR, capture_output=True, text=True, check=True
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--", "."], cwd=BACKEND_DIR, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown revision"
    return f"`{revision}`" + (" plus uncommitted backend changes" if dirty else "")


def fmt_tokens(tokens: list[str]) -> str:
    return f"`{' '.join(tokens)}`" if tokens else "*(empty)*"


def fmt_text(text: str) -> str:
    return text if text else '*""*'


def render_report(evaluation: Evaluation) -> str:
    grammar, acoustic, database = evaluation.grammar, evaluation.acoustic, evaluation.database
    point = acoustic.default
    failures = evaluation.failures()
    gated = evaluation.gated_timings()
    worst_name, worst_timing = max(gated, key=lambda item: item[1].p95_ms)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    slowest_query = database.slowest_query
    slowest_api = database.slowest_api
    grammar_timing = grammar.timing

    lines = [
        "# OmniVoice OS Backend: Evaluation Report",
        "",
        f"Generated by `scripts/evaluate_benchmarks.py` ({evaluation.scale.label} run, "
        f"{evaluation.duration_seconds:.0f} s) on {generated} for the Laptop 3 backend at {git_revision()}.",
        "",
        "## Headline results",
        "",
        "| Area | Metric | Result | Target | Status |",
        "|---|---|---|---|---|",
        f"| AST CFG grammar | Sentence transformation accuracy | {grammar.passed} / {len(grammar.rows)} "
        f"({fmt_pct(grammar.passed / len(grammar.rows))}) | no regressions | "
        f"{'PASS' if not grammar.unexpected else 'FAIL'} |",
        f"| AST CFG grammar | Latency p50 / p95 / max | {fmt_ms(grammar_timing.p50_ms)} / "
        f"{fmt_ms(grammar_timing.p95_ms)} / {fmt_ms(grammar_timing.max_ms)} ms | < {ENGINE_BUDGET_MS:g} ms engine budget "
        f"| {status(grammar_timing.p95_ms, ENGINE_BUDGET_MS)} |",
        f"| FFT peak matching | Accuracy at the default threshold {am.DEFAULT_THRESHOLD:g} | {fmt_pct(point.accuracy)} "
        f"| >= {fmt_pct(MATCH_ACCURACY_FLOOR)} | {'PASS' if point.accuracy >= MATCH_ACCURACY_FLOOR else 'FAIL'} |",
        f"| FFT peak matching | Enrolled sounds identified (all noise levels) | {fmt_pct(point.identification)} | - | - |",
        f"| FFT peak matching | Wrong trigger fired | {point.wrong} of {point.positives} | - | - |",
        f"| FFT peak matching | False accepts, unrelated sounds | {point.unrelated_false_accepts} of "
        f"{point.unrelated_negatives} | - | - |",
        f"| FFT peak matching | Match latency p95 ({len(acoustic.dataset.templates)} / {acoustic.library_size} triggers) "
        f"| {fmt_ms(acoustic.match_enrolled.p95_ms)} / {fmt_ms(acoustic.match_library.p95_ms)} ms "
        f"| < {PIPELINE_TARGET_MS:g} ms | {status(max(acoustic.match_enrolled.p95_ms, acoustic.match_library.p95_ms))} |",
        f"| SQLite | Slowest query p95 ({slowest_query.name}) | {fmt_ms(slowest_query.timing.p95_ms)} ms "
        f"| < {PIPELINE_TARGET_MS:g} ms | {status(slowest_query.timing.p95_ms)} |",
        f"| API | Slowest round trip p95 ({slowest_api.name}) | {fmt_ms(slowest_api.timing.p95_ms)} ms "
        f"| < {PIPELINE_TARGET_MS:g} ms | {status(slowest_api.timing.p95_ms)} |",
        "",
    ]
    if failures:
        lines += ["**Overall: FAIL**", ""] + [f"- {problem}" for problem in failures] + [""]
    else:
        lines += [
            f"**Overall: PASS.** All {len(gated)} gated operations have p95 latency under "
            f"{PIPELINE_TARGET_MS:g} ms; the slowest is {worst_name} at {fmt_ms(worst_timing.p95_ms)} ms.",
            "",
        ]
    lines += [
        "Scope and caveats:",
        "",
        "- All figures are single-process timings on the machine listed under Environment, after warm-up, with "
        "the heap frozen as the server does at startup. The p99 and max columns show occasional OS scheduling spikes.",
        "- The AST engine is rule-based (NLTK CFG); no generative, predictive or vision model is called on any path.",
        "- FFT matching accuracy is measured on **synthetic** sounds generated from a fixed seed, not on recordings. "
        "The matcher is the Python reference (`acoustic_matcher.py`); the browser worker's own timings are not "
        "measured here. Its parameters were chosen on a different seed from the one evaluated.",
        "- Database timings use a fresh SQLite file (WAL journal, full sync) in the system temp folder. The app's "
        "`omnivoice.db` sits in a OneDrive-synced folder, where sync activity can add occasional stalls.",
        "",
    ]

    # --- 1. Grammar -----------------------------------------------------------
    lines += [
        "## 1. AST CFG grammar transduction",
        "",
        f"The {len(grammar.rows)} cases in `tests/test_grammar.py` cover SOV/OSV/VSO reordering, fillers, stutters, "
        "repetitions, contractions, pronoun case, agreement, do-support, zero copula, questions and fragments. "
        f"Each case ran {grammar.runs} times, interleaved ({grammar_timing.samples:,} timed calls). Latency is the full "
        "engine call as returned in `executionLatencyMs`: normalization, lexing, CFG chart parsing, parse "
        "ranking, canonical AST rebuild and rendering.",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Accuracy | {grammar.passed} / {len(grammar.rows)} ({fmt_pct(grammar.passed / len(grammar.rows))}) |",
        f"| Identical output on every run | {'yes' if all(row['deterministic'] for row in grammar.rows) else 'NO'} |",
        f"| Mean latency | {fmt_ms(grammar_timing.mean_ms)} ms |",
        f"| p50 / p95 / p99 / max | {fmt_ms(grammar_timing.p50_ms)} / {fmt_ms(grammar_timing.p95_ms)} / "
        f"{fmt_ms(grammar_timing.p99_ms)} / {fmt_ms(grammar_timing.max_ms)} ms |",
        f"| Slowest case (median) | {fmt_ms(grammar.slowest['median_ms'])} ms, {fmt_tokens(grammar.slowest['case'].tokens)} |",
        "",
    ]
    gaps = [row for row in grammar.rows if row["case"].known_gap]
    if gaps:
        lines += ["Known gaps (tracked as expected failures in the test suite):", ""]
        lines += [
            f"- {fmt_tokens(row['case'].tokens)}: expected \"{row['case'].expected}\", got \"{row['output']}\" "
            f"({row['case'].known_gap})."
            for row in gaps
        ]
        lines.append("")
    if grammar.unexpected:
        lines += ["Unexpected failures:", ""]
        lines += [
            f"- {fmt_tokens(row['case'].tokens)}: expected \"{row['case'].expected}\", got \"{row['output']}\"."
            for row in grammar.unexpected
        ]
        lines.append("")

    # --- 2. Acoustic ----------------------------------------------------------
    dataset = acoustic.dataset
    lines += [
        "## 2. FFT peak matching",
        "",
        "### Method",
        "",
        f"- **Spectrum**: 16 kHz audio, {am.FRAME_SIZE}-sample Hann frames, Parseval-scaled power summed into "
        f"{len(dataset.templates[0][1])} bins of {am.BIN_HZ:g} Hz, exactly as `frontend/src/workers/audio.worker.ts` "
        f"computes `spectralBins`. A query is the mean power of {QUERY_FRAMES} frames at a {HOP_SIZE}-sample hop "
        f"({TAKE_SAMPLES / am.SAMPLE_RATE * 1000:.0f} ms of audio).",
        f"- **Matching** (`acoustic_matcher.py`): score = {am.SHAPE_WEIGHT:g} x envelope-shape correlation + "
        f"{am.BAND_WEIGHT:g} x in-band energy agreement + {am.PEAK_WEIGHT:g} x prominent-peak overlap "
        f"(+/-{am.PEAK_TOLERANCE_BINS} bins). The best trigger fires when its score reaches the trigger threshold "
        f"(default {am.DEFAULT_THRESHOLD:g}). Frames below {am.SILENCE_FLOOR_DB:g} dB never fire.",
        f"- **Enrollment**: each trigger averages {ENROLLMENT_TAKES} takes at {ENROLLMENT_SNR_DB} dB SNR.",
        f"- **Test takes**: {len(dataset.positives):,} takes of the enrolled sounds ({len(SNR_CONDITIONS_DB)} white-noise "
        f"levels x {len(dataset.positives) // (len(ENROLLED_SOUNDS) * len(SNR_CONDITIONS_DB))} takes each) and "
        f"{len(dataset.negatives):,} takes of sounds that were never enrolled. Every take varies level "
        f"({LEVEL_RANGE_DB[0]:g} to {LEVEL_RANGE_DB[1]:g} dBFS), pitch and resonances (+/-{JITTER:.0%}), phase and onset. "
        f"Seed {ACOUSTIC_SEED}; building the set took {dataset.build_seconds:.1f} s.",
        "",
        "| Enrolled sound | Description | Identified at threshold "
        f"{am.DEFAULT_THRESHOLD:g} |",
        "|---|---|---:|",
    ]
    lines += [f"| {sound.name} | {sound.description} | {fmt_pct(point.by_sound[sound.name])} |" for sound in ENROLLED_SOUNDS]
    lines += [
        "",
        f"### Results at the default threshold ({am.DEFAULT_THRESHOLD:g})",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Overall accuracy (correct trigger or correct rejection) | {fmt_pct(point.accuracy)} |",
        f"| Enrolled sounds identified | {point.correct} / {point.positives} ({fmt_pct(point.identification)}) |",
        f"| Missed (no trigger fired) | {point.missed} |",
        f"| Wrong trigger fired | {point.wrong} |",
        f"| False accepts, unrelated sounds | {point.unrelated_false_accepts} / {point.unrelated_negatives} "
        f"({fmt_pct(point.unrelated_false_accepts / max(point.unrelated_negatives, 1))}) |",
        f"| False accepts, near-miss vowel | {point.near_miss_false_accepts} / {point.near_miss_negatives} "
        f"({fmt_pct(point.near_miss_false_accepts / max(point.near_miss_negatives, 1))}) |",
        "",
        "| Noise level (SNR) | " + " | ".join(f"{snr} dB" for snr in SNR_CONDITIONS_DB) + " |",
        "|---|" + "---:|" * len(SNR_CONDITIONS_DB),
        "| Enrolled sounds identified | " + " | ".join(fmt_pct(point.by_snr[snr]) for snr in SNR_CONDITIONS_DB) + " |",
        "",
        "| Never-enrolled sound | Description | False accepts |",
        "|---|---|---:|",
    ]
    per_negative = len(dataset.negatives) // len(NEGATIVE_SOUNDS)
    lines += [
        f"| {sound.name} | {sound.description} | {point.false_accepts.get(sound.name, 0)} / {per_negative} |"
        for sound in NEGATIVE_SOUNDS
    ]
    lines += [
        "",
        "### Threshold sweep",
        "",
        "The trigger threshold trades misses against false accepts. Each trigger stores its own threshold, so it "
        "can be tuned per user.",
        "",
        "| Threshold | Accuracy | Identified | Missed | Wrong trigger | False accepts (unrelated) | False accepts (near-miss) |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    lines += [
        f"| {sweep.threshold:.2f} | {fmt_pct(sweep.accuracy)} | {fmt_pct(sweep.identification)} | {sweep.missed} | "
        f"{sweep.wrong} | {sweep.unrelated_false_accepts} | {sweep.near_miss_false_accepts} |"
        for sweep in acoustic.sweep
    ]
    lines += [
        "",
        "### Latency",
        "",
        "| Operation | p50 ms | p95 ms | p99 ms | max ms | Gated |",
        "|---|---:|---:|---:|---:|---|",
        f"| Match one query against {len(dataset.templates)} enrolled triggers | {timing_cells(acoustic.match_enrolled)} | "
        f"{status(acoustic.match_enrolled.p95_ms)} |",
        f"| Match one query against a {acoustic.library_size}-trigger library | {timing_cells(acoustic.match_library)} | "
        f"{status(acoustic.match_library.p95_ms)} |",
        f"| Profile one stored fingerprint (once per trigger when the library loads) | "
        f"{timing_cells(acoustic.profile)} | no |",
        f"| Compute one 128-bin spectrum in Python (reference only; the app does this in the audio worker) | "
        f"{timing_cells(acoustic.extraction)} | no |",
        "",
    ]

    # --- 3. Database ----------------------------------------------------------
    seed = database.seed_summary
    lines += [
        "## 3. Database queries and API round trips",
        "",
        f"A fresh SQLite database was seeded in {database.seed_seconds:.1f} s with {BENCHMARK_USERS} users, "
        f"{database.triggers:,} acoustic triggers (fingerprints taken from the acoustic set above), "
        f"{database.sessions:,} session analytics rows and the phonetic tables built by `scripts/kaggle_sync.py` from "
        f"a {database.lexicon_source}: {seed.pronunciations:,} pronunciations, {seed.trie_nodes:,} trie nodes over "
        f"{seed.trie_words:,} words and {seed.target_words:,} practice words. Each query opens its own session, "
        f"as an API request does, and ran {evaluation.scale.db_repeats} times with rotating parameters.",
        "",
        "| Query | What it does | p50 ms | p95 ms | p99 ms | max ms | Status |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    lines += [
        f"| {query.name} | {query.detail} | {timing_cells(query.timing)} | {status(query.timing.p95_ms)} |"
        for query in database.queries
    ]
    lines += [
        "",
        "API round trips run in-process through FastAPI's test client (routing, validation, serialization and the "
        "database, without network sockets).",
        "",
        "| Request | What it does | p50 ms | p95 ms | p99 ms | max ms | Status |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    lines += [
        f"| `{query.name}` | {query.detail} | {timing_cells(query.timing)} | {status(query.timing.p95_ms)} |"
        for query in database.api
    ]

    # --- Environment and appendix ----------------------------------------------
    lines += [
        "",
        "## Environment",
        "",
        f"- Python {platform.python_version()} ({platform.python_implementation()}) on {platform.platform()}",
        f"- CPU: {platform.processor() or 'unknown'}",
        f"- NLTK {nltk.__version__}, FastAPI {fastapi.__version__}, SQLAlchemy {sqlalchemy.__version__}, "
        f"SQLite {sqlite3.sqlite_version}",
        f"- Grammar: {len(grammar_engine.GRAMMAR.productions())} CFG productions, "
        f"`{type(grammar_engine.PARSER).__name__}`, chart edge budget {grammar_engine.MAX_CHART_EDGES}",
        "",
        "## Reproduce",
        "",
        "```bash",
        "cd backend",
        "venv/Scripts/python.exe -m pip install -r requirements-dev.txt",
        "venv/Scripts/python.exe scripts/evaluate_benchmarks.py",
        "```",
        "",
        "## Appendix: grammar results per case",
        "",
        "<details>",
        f"<summary>All {len(grammar.rows)} cases</summary>",
        "",
        "| # | Input tokens | Expected | Output | Median ms | Max ms | Result |",
        "|---:|---|---|---|---:|---:|---|",
    ]
    for number, row in enumerate(grammar.rows, start=1):
        result = "pass" if row["passed"] else ("known gap" if row["case"].known_gap else "FAIL")
        lines.append(
            f"| {number} | {fmt_tokens(row['case'].tokens)} | {fmt_text(row['case'].expected)} | "
            f"{fmt_text(row['output'])} | {fmt_ms(row['median_ms'])} | {fmt_ms(row['max_ms'])} | {result} |"
        )
    lines += ["", "</details>"]
    return "\n".join(lines) + "\n"


def evaluate(scale: Scale, *, freeze_gc: bool = True, log: Callable[[str], None] = print) -> Evaluation:
    started = time.perf_counter()
    log(f"[1/3] AST grammar: {len(CASES)} cases x {scale.grammar_runs} runs")
    grammar = run_grammar(scale.grammar_runs, freeze_gc)
    log("[2/3] FFT peak matching: building the synthetic sound set")
    dataset = build_acoustic_dataset(scale)
    acoustic = run_acoustic(dataset, scale, freeze_gc)
    log("[3/3] Database queries and API round trips")
    database = run_database(dataset, scale, freeze_gc)
    return Evaluation(scale, grammar, acoustic, database, time.perf_counter() - started)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--quick", action="store_true", help="small samples for a fast check (same report layout)")
    parser.add_argument("--runs", type=int, help="grammar passes over the case suite (default: 50, quick: 5)")
    parser.add_argument("--output", type=Path, default=BACKEND_DIR / "EVALUATION_REPORT.md")
    args = parser.parse_args(argv)
    scale = QUICK if args.quick else FULL
    if args.runs is not None:
        if args.runs < 1:
            parser.error("--runs must be at least 1")
        scale = replace(scale, grammar_runs=args.runs)

    evaluation = evaluate(scale)
    args.output.write_text(render_report(evaluation), encoding="utf-8")

    point = evaluation.acoustic.default
    print(
        f"grammar {evaluation.grammar.passed}/{len(evaluation.grammar.rows)}, p95 "
        f"{fmt_ms(evaluation.grammar.timing.p95_ms)} ms | FFT matching accuracy {fmt_pct(point.accuracy)}, "
        f"library match p95 {fmt_ms(evaluation.acoustic.match_library.p95_ms)} ms | slowest SQLite p95 "
        f"{fmt_ms(evaluation.database.slowest_query.timing.p95_ms)} ms | slowest API p95 "
        f"{fmt_ms(evaluation.database.slowest_api.timing.p95_ms)} ms"
    )
    failures = evaluation.failures()
    for problem in failures:
        print(f"FAIL: {problem}")
    print(f"report written to {args.output} ({evaluation.duration_seconds:.0f} s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
