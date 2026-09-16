import cmath
import math
import random

import pytest

import acoustic_matcher as am

N = am.FRAME_SIZE


def tone(frequency: float, amplitude: float = 0.5, phase: float = 0.0) -> list[float]:
    return [amplitude * math.sin(2 * math.pi * frequency * n / am.SAMPLE_RATE + phase) for n in range(N)]


def vowel(f0: float, formants: list[tuple[float, float]], amplitude: float = 0.3) -> list[float]:
    frame = [0.0] * N
    for k in range(1, int(7600 / f0)):
        gain = 0.03 + sum(1 / (1 + ((k * f0 - centre) / width) ** 2) for centre, width in formants)
        for n in range(N):
            frame[n] += amplitude * gain * k**-0.3 * math.sin(2 * math.pi * k * f0 * n / am.SAMPLE_RATE + k)
    return frame


def test_power_spectrum_matches_a_direct_fourier_sum() -> None:
    rng = random.Random(3)
    frame = [rng.uniform(-1, 1) for _ in range(N)]
    hann = [0.5 - 0.5 * math.cos(2 * math.pi * i / N) for i in range(N)]
    scale = 1 / (N * math.fsum(w * w for w in hann))
    windowed = [sample * weight for sample, weight in zip(frame, hann)]

    def fft_power(k: int) -> float:
        value = sum(windowed[n] * cmath.exp(-2j * math.pi * k * n / N) for n in range(N))
        return abs(value) ** 2 * scale * (2 if k else 1)

    spectrum = am.power_spectrum(frame)
    for bin_index in range(12):
        expected = sum(fft_power(k) for k in range(bin_index * am.BIN_GROUP, (bin_index + 1) * am.BIN_GROUP))
        assert spectrum[bin_index] == pytest.approx(expected, rel=1e-9)


def test_tone_lands_in_its_bin_and_bins_sum_to_mean_square() -> None:
    bins = am.power_spectrum(tone(1000, amplitude=0.5))
    assert len(bins) == 128
    assert max(range(128), key=bins.__getitem__) == int(1000 // am.BIN_HZ)
    assert math.fsum(bins) == pytest.approx(0.5**2 / 2, rel=1e-3)


@pytest.mark.parametrize("call", [lambda: am.power_spectrum([0.0] * 512), lambda: am.spectral_profile([1.0] * 127)])
def test_wrong_sizes_are_rejected(call) -> None:
    with pytest.raises(ValueError):
        call()


def test_a_spectrum_matches_itself_perfectly_at_any_gain() -> None:
    bins = am.power_spectrum(vowel(130, [(730, 90), (1090, 110), (2440, 170)]))
    profile = am.spectral_profile(bins)
    louder = am.spectral_profile([power * 100 for power in bins])
    assert profile.peaks
    assert am.similarity(profile, profile) == pytest.approx(1.0)
    assert am.similarity(louder, profile) == pytest.approx(1.0)
    assert louder.level_db == pytest.approx(profile.level_db + 20)


def test_match_picks_the_closest_trigger_and_honours_its_threshold() -> None:
    templates = [
        am.TriggerTemplate.from_fingerprint("whistle", am.power_spectrum(tone(1600))),
        am.TriggerTemplate.from_fingerprint("high whistle", am.power_spectrum(tone(2600))),
        am.TriggerTemplate.from_fingerprint("vowel i", am.power_spectrum(vowel(130, [(270, 60), (2290, 100)]))),
    ]
    query = am.power_spectrum(tone(1610, amplitude=0.1, phase=1.0))

    result = am.match(query, templates)
    assert result.trigger_id == "whistle"
    assert result.score >= am.DEFAULT_THRESHOLD

    strict = [am.TriggerTemplate(template.trigger_id, template.profile, threshold=1.01) for template in templates]
    missed = am.match(query, strict)
    assert missed.trigger_id is None
    assert missed.score == pytest.approx(result.score)


def test_unrelated_noise_does_not_fire() -> None:
    rng = random.Random(5)
    templates = [am.TriggerTemplate.from_fingerprint("whistle", am.power_spectrum(tone(1600)))]
    noise = am.power_spectrum([rng.gauss(0, 0.1) for _ in range(N)])
    assert am.match(noise, templates).trigger_id is None


def test_frames_below_the_silence_floor_never_match() -> None:
    whistle = am.power_spectrum(tone(1600))
    templates = [am.TriggerTemplate.from_fingerprint("whistle", whistle, threshold=0.0)]
    quiet = am.power_spectrum(tone(1600, amplitude=1e-4))
    assert am.spectral_profile(quiet).level_db < am.SILENCE_FLOOR_DB
    assert am.match(quiet, templates) == am.MatchResult(None, 0.0)
    assert am.match(whistle, []) == am.MatchResult(None, 0.0)


def test_average_fingerprint_is_the_mean_power_per_bin() -> None:
    assert am.average_fingerprint([[1.0, 2.0], [3.0, 6.0]]) == [2.0, 4.0]
    with pytest.raises(ValueError):
        am.average_fingerprint([])


# Same spectra and values as the parity suite in frontend/src/workers/__tests__/dsp.test.ts, which checks the
# trigger.worker.ts port. Change both files together, or the browser and the API will score triggers differently.
PARITY_SEEDS = (0.3, 1.7, 2.9)
PARITY_REFERENCE = {
    "levelDb": [-29.305556, -29.7297, -30.255119],
    "peaks": [(0, 13, 53, 93), (4, 44, 84, 124), (0, 37, 76, 116)],
    "bandRatio": [0.98015393, 0.97534332, 0.95146228],
    "similarity": [
        [1.0, 0.09353773, 0.0577851],
        [0.10969429, 1.0, 0.09364652],
        [0.05387606, 0.11446804, 1.0],
    ],
}


def parity_spectrum(seed: float) -> list[float]:
    return [
        10 ** ((math.sin(i / 7 + seed) * 20 + math.cos(i / 3 + seed * 2) * 8 - 60 - i / 8) / 10)
        for i in range(am.FINGERPRINT_BINS)
    ]


def test_profiles_match_the_frontend_parity_reference() -> None:
    for index, seed in enumerate(PARITY_SEEDS):
        profile = am.spectral_profile(parity_spectrum(seed))
        assert profile.level_db == pytest.approx(PARITY_REFERENCE["levelDb"][index], abs=5e-6)
        assert profile.peaks == PARITY_REFERENCE["peaks"][index]
        assert profile.band_ratio == pytest.approx(PARITY_REFERENCE["bandRatio"][index], abs=5e-8)


def test_similarity_matches_the_frontend_parity_reference() -> None:
    profiles = [am.spectral_profile(parity_spectrum(seed)) for seed in PARITY_SEEDS]
    for q, query in enumerate(profiles):
        for t, template in enumerate(profiles):
            expected = PARITY_REFERENCE["similarity"][q][t]
            assert am.similarity(query, template) == pytest.approx(expected, abs=5e-8)
