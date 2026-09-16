/**
 * Deterministic stand-in for the DSP worker so the HUD can be developed and demoed before the
 * audio engine lands. Pure formula synthesis: no randomness, no models, no microphone access.
 */
import type { GrammarResponse } from '@shared/types';
import { SPECTRAL_BIN_COUNT } from '@/lib/hud/store';
import type { HudFrame, PeerLinkState, TelemetryStore } from '@/lib/hud/types';

const SAMPLE_RATE = 16_000;
const NYQUIST_HZ = SAMPLE_RATE / 2;
const BIN_HZ = NYQUIST_HZ / SPECTRAL_BIN_COUNT;
const WAVEFORM_SIZE = 512;
const FRAME_INTERVAL_MS = 1000 / 60;
const SYLLABLES_PER_SECOND = 4.2;
const BLOCK_DETECT_DELAY_MS = 250;

type SegmentKind = 'speech' | 'pause' | 'block';

const TIMELINE: ReadonlyArray<{ kind: SegmentKind; ms: number }> = [
  { kind: 'speech', ms: 2600 },
  { kind: 'pause', ms: 700 },
  { kind: 'speech', ms: 3100 },
  { kind: 'pause', ms: 600 },
  { kind: 'block', ms: 1500 },
  { kind: 'speech', ms: 2800 },
  { kind: 'pause', ms: 900 },
];
const TIMELINE_MS = TIMELINE.reduce((total, segment) => total + segment.ms, 0);

// Peterson & Barney (1952) average adult formants F1-F3 in Hz for /a/, /i/, /u/, /ɛ/, /ɔ/.
const VOWEL_FORMANTS: ReadonlyArray<readonly [number, number, number]> = [
  [730, 1090, 2440],
  [270, 2290, 3010],
  [300, 870, 2240],
  [530, 1840, 2480],
  [570, 840, 2410],
];
const FORMANT_BANDWIDTHS_HZ = [90, 110, 170] as const;

/** Hash-based value noise in [-1, 1]; same input always gives the same output. */
function hashNoise(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function segmentAt(ms: number) {
  let t = ms % TIMELINE_MS;
  for (let index = 0; index < TIMELINE.length; index += 1) {
    const segment = TIMELINE[index];
    if (t < segment.ms) return { ...segment, index, offsetMs: t };
    t -= segment.ms;
  }
  return { ...TIMELINE[0], index: 0, offsetMs: 0 };
}

function formantGain(freq: number, formants: readonly [number, number, number]): number {
  let gain = 0;
  for (let j = 0; j < 3; j += 1) {
    const distance = (freq - formants[j]) / FORMANT_BANDWIDTHS_HZ[j];
    gain += 1 / (1 + distance * distance);
  }
  return gain / (1 + freq / 900);
}

function edgeRamp(offsetMs: number, lengthMs: number, rampMs = 60): number {
  return Math.min(1, offsetMs / rampMs, (lengthMs - offsetMs) / rampMs);
}

function synthesizeFrame(elapsedMs: number, frameIndex: number, state: { wpm: number }): HudFrame {
  const t = elapsedMs / 1000;
  const segment = segmentAt(elapsedMs);
  const segmentSec = segment.offsetMs / 1000;
  const voiced = segment.kind === 'speech';

  const syllable = Math.floor(segmentSec * SYLLABLES_PER_SECOND);
  const formants = VOWEL_FORMANTS[(syllable + segment.index * 2) % VOWEL_FORMANTS.length];
  const syllableEnvelope = 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * SYLLABLES_PER_SECOND * segmentSec));

  const amplitude = voiced ? 0.85 * syllableEnvelope * edgeRamp(segment.offsetMs, segment.ms) : 0;
  const noiseLevel = segment.kind === 'block' ? 0.02 : voiced ? 0.012 : 0.004;
  const pitchHz = voiced
    ? 122 + 12 * Math.sin(2 * Math.PI * 0.4 * t) - 10 * (segment.offsetMs / segment.ms) + 0.6 * hashNoise(frameIndex)
    : 0;

  // Oscilloscope window, phase-locked to the pitch period so the trace stays steady.
  const waveform = new Float32Array(WAVEFORM_SIZE);
  if (voiced) {
    const harmonics = Math.min(20, Math.floor(3500 / pitchHz));
    const gains = new Float32Array(harmonics + 1);
    let gainSum = 0;
    for (let k = 1; k <= harmonics; k += 1) {
      gains[k] = formantGain(k * pitchHz, formants);
      gainSum += gains[k];
    }
    const windowStart = Math.floor(t * pitchHz) / pitchHz;
    for (let n = 0; n < WAVEFORM_SIZE; n += 1) {
      const ts = windowStart + n / SAMPLE_RATE;
      let sample = 0;
      for (let k = 1; k <= harmonics; k += 1) sample += gains[k] * Math.sin(2 * Math.PI * k * pitchHz * ts);
      waveform[n] = (amplitude * 1.6 * sample) / gainSum;
    }
  }
  let energy = 0;
  for (let n = 0; n < WAVEFORM_SIZE; n += 1) {
    waveform[n] = Math.max(-1, Math.min(1, waveform[n] + noiseLevel * hashNoise(frameIndex * 1024 + n)));
    energy += waveform[n] * waveform[n];
  }
  const volumeDb = Math.max(-60, 20 * Math.log10(Math.sqrt(energy / WAVEFORM_SIZE) + 1e-9));

  const bins = new Array<number>(SPECTRAL_BIN_COUNT).fill(0);
  if (voiced) {
    for (let k = 1; k * pitchHz < NYQUIST_HZ; k += 1) {
      const position = (k * pitchHz) / BIN_HZ;
      const bin = Math.floor(position);
      const fraction = position - bin;
      const level = formantGain(k * pitchHz, formants) * amplitude;
      if (bin < SPECTRAL_BIN_COUNT) bins[bin] += level * (1 - fraction);
      if (bin + 1 < SPECTRAL_BIN_COUNT) bins[bin + 1] += level * fraction;
    }
  }
  for (let i = 0; i < SPECTRAL_BIN_COUNT; i += 1) {
    const floor = (noiseLevel * (0.35 + 0.15 * hashNoise(frameIndex * 7 + i))) / (1 + i / 40);
    const db = 20 * Math.log10(bins[i] + floor + 1e-6);
    bins[i] = Math.max(0, Math.min(1, (db + 62) / 62));
  }

  const blockDetected = segment.kind === 'block' && segment.offsetMs >= BLOCK_DETECT_DELAY_MS;
  const wpmTarget = segment.kind === 'block' ? 88 : voiced ? 132 + 8 * Math.sin(t * 0.2) : state.wpm;
  state.wpm += (wpmTarget - state.wpm) * 0.02;

  return {
    telemetry: {
      timestamp: Date.now(),
      volumeDb,
      pitchHz,
      spectralBins: bins,
      jitterPercent: voiced ? 0.55 + 0.25 * Math.sin(t * 0.9) : 0,
      shimmerDb: voiced ? 0.32 + 0.1 * Math.sin(t * 1.3) : 0,
      hnrDb: voiced ? 19 + 2 * Math.sin(t * 0.5) : 0,
      vocalStrainIndex:
        segment.kind === 'block' ? 22 + Math.min(58, (segment.offsetMs / segment.ms) * 70) : 20 + 6 * Math.sin(t * 0.3),
    },
    fluency: {
      wpm: state.wpm,
      vocalBlockDetected: blockDetected,
      blockDurationMs: blockDetected ? segment.offsetMs : 0,
      pitchVolatilityHz: voiced ? 12 + 3 * Math.sin(t * 0.6) : 0,
      dafDelayMs: 0,
      fsfOctaveShift: 0,
    },
    waveform,
    spectrumMaxHz: NYQUIST_HZ,
    latencyMs: 8.2 + 2.4 * Math.sin(t * 0.7) + 0.6 * hashNoise(frameIndex + 0.5),
  };
}

/** Pushes simulated frames at 60 Hz until the returned stop function is called. */
export function startSimulatedAudio(store: TelemetryStore): () => void {
  const startedAt = performance.now();
  const state = { wpm: 120 };
  let frameIndex = 0;
  const timer = window.setInterval(() => {
    frameIndex += 1;
    store.push(synthesizeFrame(performance.now() - startedAt, frameIndex, state));
  }, FRAME_INTERVAL_MS);
  return () => window.clearInterval(timer);
}

// Exactly what backend/grammar_engine.py returns for these tokens (latencies measured on a laptop), so the
// offline fallback shows the same sentences and tree format as the live demo.
const SIMULATED_GRAMMAR: readonly GrammarResponse[] = [
  {
    originalTokens: ['um', 'me', 'w-w-water', 'want'],
    formattedText: 'I want water.',
    parsedTree: '(ROOT (S (NP (PRON I)) (VP (V want) (NP (N water)))))',
    executionLatencyMs: 1.2,
  },
  {
    originalTokens: ['I', 'I', 'w-want', 'to', 'go', 'to', 'the', 'store'],
    formattedText: 'I want to go to the store.',
    parsedTree: '(ROOT (S (NP (PRON I)) (VP (V want) (VP (TO to) (V go) (PP (P to) (NP (DET the) (N store)))))))',
    executionLatencyMs: 1.8,
  },
  {
    originalTokens: ['can', 'can', 'you', 'c-call', 'my', 'mom'],
    formattedText: 'Can you call my mom?',
    parsedTree: '(ROOT (SQ (AUX can) (NP (PRON you)) (VP (V call) (NP (DET my) (N mom)))))',
    executionLatencyMs: 1.4,
  },
  {
    originalTokens: ['where', 'my', 'shoes', 'are'],
    formattedText: 'Where are my shoes?',
    parsedTree: '(ROOT (SBARQ (WH where) (SQ (COP are) (NP (DET my) (N shoes)))))',
    executionLatencyMs: 1.0,
  },
  {
    originalTokens: ['cold', 'water', 'please', 'I', 'want'],
    formattedText: 'I want cold water please.',
    parsedTree: '(ROOT (S (NP (PRON I)) (VP (V want) (NP (ADJ cold) (N water))) (ADVP (ADV please))))',
    executionLatencyMs: 2.6,
  },
  {
    originalTokens: ['i', 'i', 'need', 'uh', 'my', 'm-m-medicine'],
    formattedText: 'I need my medicine.',
    parsedTree: '(ROOT (S (NP (PRON I)) (VP (V need) (NP (DET my) (N medicine)))))',
    executionLatencyMs: 1.1,
  },
];

const GRAMMAR_ROTATION_SECONDS = 8;

/** Raw token sequences Pitch Mode replays through speech.worker and the real grammar engine. */
export const DEMO_TOKEN_SCRIPT: readonly (readonly string[])[] = SIMULATED_GRAMMAR.map((grammar) => grammar.originalTokens);

export function simulatedGrammarAt(elapsedSeconds: number): GrammarResponse {
  return SIMULATED_GRAMMAR[Math.floor(elapsedSeconds / GRAMMAR_ROTATION_SECONDS) % SIMULATED_GRAMMAR.length];
}

export function simulatedPeerAt(elapsedSeconds: number): PeerLinkState {
  if (elapsedSeconds < 2) return { status: 'connecting', peerLabel: 'Caregiver tablet', roundTripMs: null };
  return {
    status: 'connected',
    peerLabel: 'Caregiver tablet',
    roundTripMs: Math.round(34 + 6 * Math.sin(elapsedSeconds * 0.8)),
  };
}
