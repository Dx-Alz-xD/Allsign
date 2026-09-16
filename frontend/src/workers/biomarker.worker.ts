/**
 * Voice biomarkers measured cycle-by-cycle on the waveform.
 *
 * Receives PCM directly from audio.worker.ts over a MessagePort, so the main
 * thread never carries audio. Jitter and shimmer require per-glottal-cycle
 * resolution: a frame-level pitch/RMS track averages over roughly eight cycles
 * and destroys the very variation being measured, so this stage marks
 * individual pulses instead. HNR uses Boersma's (1993) normalised
 * autocorrelation on the waveform, the same estimator as Praat's Harmonicity.
 *
 * Definitions follow Praat: jitter (local) = mean|T[i]-T[i-1]| / mean T;
 * shimmer (local, dB) = mean|20 log10(A[i]/A[i-1])|; HNR = 10 log10(r'/(1-r')).
 *
 * The strain index anchors each measure to the MDVP pathology threshold
 * (jitter 1.04%, shimmer 0.35 dB) and a 20 dB healthy HNR, then a slow
 * envelope, hysteresis and a trend decide when the HUD should warn.
 */

import type { CyclePacket, CyclePortMessage } from '@/workers/audio.worker';

export type StrainLevel = 'normal' | 'caution' | 'warning';

export interface BiomarkerConfig {
  /** Jitter (%) that scores 50 on its sub-scale; 2x scores 100. */
  jitterPathologyPercent: number;
  /** Shimmer (dB) that scores 50 on its sub-scale; 2x scores 100. */
  shimmerPathologyDb: number;
  /** HNR at or above this scores 0. */
  hnrHealthyDb: number;
  /** HNR at or below this scores 100. */
  hnrFloorDb: number;
  jitterWeight: number;
  shimmerWeight: number;
  hnrWeight: number;
  /** Time constant of the smoothed index, seconds. */
  smoothingSeconds: number;
  cautionEnter: number;
  cautionExit: number;
  warningEnter: number;
  warningExit: number;
  /** Smoothed index must sit above `warningEnter` this long before warning. */
  warningDwellSeconds: number;
  /** Rising trend (points per minute) that upgrades a sustained caution. */
  trendWarningPerMinute: number;
}

export interface BiomarkerPayload {
  timestamp: number;
  /** False when this emit only carries state, with the last measurement. */
  measured: boolean;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  /** Glottal cycles behind the latest jitter/shimmer figures. */
  cycles: number;
  /** Instantaneous composite, 0..100. */
  vocalStrainIndex: number;
  /** Slow envelope of the index, what the level logic follows. */
  strainSmoothed: number;
  strainLevel: StrainLevel;
  fatigueWarning: boolean;
  /** Seconds the smoothed index has stayed above the caution threshold. */
  sustainedSeconds: number;
  /** Least-squares slope of the smoothed index over the last minute. */
  trendPerMinute: number;
  /** Voiced time since reset; vocal load. */
  phonationSeconds: number;
}

export type BiomarkerRequest =
  | { type: 'init'; config?: Partial<BiomarkerConfig> }
  | { type: 'connect'; port: MessagePort }
  | { type: 'reset' }
  | { type: 'close' };

export type BiomarkerResponse =
  | { type: 'ready'; config: BiomarkerConfig }
  | { type: 'biomarkers'; payload: BiomarkerPayload }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}

const ctx = self as unknown as WorkerScope;

/** 640ms at a 10ms hop: ~80 glottal cycles at 130Hz. */
const MAX_HOPS = 64;
const COMPACT_HOPS = 32;
const EMIT_EVERY_HOPS = 10;
const MIN_CYCLES = 8;
const CONFIDENCE_FLOOR = 0.45;
/** Peak search bounds as a fraction of the expected period. */
const SEARCH_LO = 0.7;
const SEARCH_HI = 1.3;
/** Praat's maximum period factor; rejects octave slips and marking errors. */
const MAX_PERIOD_RATIO = 1.3;
/** Midpoint pulse height, relative to marked pulses, that implies period doubling. */
const SUBHARMONIC_RATIO = 0.5;

/** Praat's default for Harmonicity (ac): reliable to ~37 dB. */
const HNR_PERIODS_PER_WINDOW = 4.5;
const HNR_MIN_WINDOW_MS = 20;
const HNR_MAX_WINDOW_MS = 80;
/** Lag search around the upstream period. */
const HNR_LAG_LO = 0.85;
const HNR_LAG_HI = 1.15;
const HNR_MIN_DB = -10;
const HNR_MAX_DB = 40;
/** Trend window: one sample per second. */
const TREND_SAMPLES = 60;

// Anchors are the MDVP pathology thresholds quoted in Praat's voice manual and
// a conventional 20 dB healthy sustained-vowel HNR. The composite is a
// heuristic risk indicator, not a validated clinical score.
const DEFAULT_CONFIG: BiomarkerConfig = {
  jitterPathologyPercent: 1.04,
  shimmerPathologyDb: 0.35,
  hnrHealthyDb: 20,
  hnrFloorDb: 5,
  jitterWeight: 0.35,
  shimmerWeight: 0.35,
  hnrWeight: 0.3,
  smoothingSeconds: 3,
  cautionEnter: 35,
  cautionExit: 30,
  warningEnter: 55,
  warningExit: 48,
  warningDwellSeconds: 2,
  trendWarningPerMinute: 10,
};

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

class CycleAnalyzer {
  private config: BiomarkerConfig;

  private pcm = new Float64Array(0);
  private hopPitch = new Float64Array(MAX_HOPS);
  private hopConfidence = new Float64Array(MAX_HOPS);
  private hopVoiced = new Uint8Array(MAX_HOPS);
  /** Per-hop HNR in dB; NaN until the window around the hop has arrived. */
  private hopHnr = new Float64Array(MAX_HOPS);
  private hnrEvaluated = 0;
  private hnrScratch = new Float64Array(0);

  private hopSize = 0;
  private hopCount = 0;
  private sampleRate = 16000;
  private packetsSeen = 0;
  private lastTimestamp = 0;

  private spanMean = 0;
  private readonly positions: number[] = [];
  private readonly amplitudes: number[] = [];

  // Last measurement, re-sent with state-only emits.
  private hasMeasurement = false;
  private lastJitter = 0;
  private lastShimmer = 0;
  private lastHnr = 0;
  private lastCycles = 0;
  private lastStrain = 0;

  // Fatigue state.
  private strainSmoothed = 0;
  private strainLevel: StrainLevel = 'normal';
  private aboveCautionSince = -1;
  private phonationSeconds = 0;
  private elapsedSeconds = 0;
  private lastMeasureSeconds = -1;
  private trendValues = new Float64Array(TREND_SAMPLES);
  private trendCount = 0;
  private trendNext = 0;
  private nextTrendSampleAt = 0;

  constructor(config: Partial<BiomarkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  get currentConfig(): BiomarkerConfig {
    return { ...this.config };
  }

  reset(): void {
    this.hopCount = 0;
    this.packetsSeen = 0;
    this.lastTimestamp = 0;
    this.hopHnr.fill(Number.NaN);
    this.hnrEvaluated = 0;

    this.hasMeasurement = false;
    this.lastJitter = 0;
    this.lastShimmer = 0;
    this.lastHnr = 0;
    this.lastCycles = 0;
    this.lastStrain = 0;

    this.strainSmoothed = 0;
    this.strainLevel = 'normal';
    this.aboveCautionSince = -1;
    this.phonationSeconds = 0;
    this.elapsedSeconds = 0;
    this.lastMeasureSeconds = -1;
    this.trendCount = 0;
    this.trendNext = 0;
    this.nextTrendSampleAt = 1;
  }

  accept(packet: CyclePacket): BiomarkerPayload | null {
    if (packet.hopSize !== this.hopSize) {
      this.hopSize = packet.hopSize;
      this.pcm = new Float64Array(MAX_HOPS * this.hopSize);
      this.hopCount = 0;
      this.hnrEvaluated = 0;
    }
    this.sampleRate = packet.sampleRate;
    this.lastTimestamp = packet.timestamp;
    this.packetsSeen++;

    if (this.hopCount === MAX_HOPS) this.compact();

    const offset = this.hopCount * this.hopSize;
    this.pcm.set(packet.hop, offset);
    this.hopPitch[this.hopCount] = packet.pitchHz;
    this.hopConfidence[this.hopCount] = packet.pitchConfidence;
    const voiced = packet.voiced && packet.pitchConfidence >= CONFIDENCE_FLOOR ? 1 : 0;
    this.hopVoiced[this.hopCount] = voiced;
    this.hopHnr[this.hopCount] = Number.NaN;
    this.hopCount++;

    const hopSeconds = this.hopSize / this.sampleRate;
    this.elapsedSeconds += hopSeconds;
    if (voiced) this.phonationSeconds += hopSeconds;

    this.evaluateHnr();

    if (this.packetsSeen % EMIT_EVERY_HOPS !== 0) return null;

    const measured = this.measure();
    if (!measured && !this.hasMeasurement) return null;
    return this.composite(measured);
  }

  private compact(): void {
    const keep = this.hopCount - COMPACT_HOPS;
    this.pcm.copyWithin(0, COMPACT_HOPS * this.hopSize, this.hopCount * this.hopSize);
    this.hopPitch.copyWithin(0, COMPACT_HOPS, this.hopCount);
    this.hopConfidence.copyWithin(0, COMPACT_HOPS, this.hopCount);
    this.hopVoiced.copyWithin(0, COMPACT_HOPS, this.hopCount);
    this.hopHnr.copyWithin(0, COMPACT_HOPS, this.hopCount);
    this.hopCount = keep;
    this.hnrEvaluated = Math.max(0, this.hnrEvaluated - COMPACT_HOPS);
  }

  /**
   * Boersma (1993): the normalised autocorrelation of a Hann-windowed segment,
   * divided by the window's own autocorrelation, peaks at r' = harmonic energy
   * fraction; HNR = 10 log10(r' / (1 - r')). Evaluated for each voiced hop
   * once the samples on both sides of it have arrived.
   */
  private evaluateHnr(): void {
    const { sampleRate, hopSize } = this;
    const end = this.hopCount * hopSize;

    for (; this.hnrEvaluated < this.hopCount; this.hnrEvaluated++) {
      const hop = this.hnrEvaluated;
      if (this.hopVoiced[hop] === 0) continue;

      const pitch = this.hopPitch[hop];
      if (!(pitch > 0)) continue;
      const period = sampleRate / pitch;

      let length = Math.round(period * HNR_PERIODS_PER_WINDOW);
      length = Math.max((HNR_MIN_WINDOW_MS / 1000) * sampleRate, length);
      length = Math.min((HNR_MAX_WINDOW_MS / 1000) * sampleRate, length);
      length = Math.round(length);

      const centre = hop * hopSize + hopSize / 2;
      const from = Math.round(centre - length / 2);
      const to = from + length;
      if (from < 0) continue;
      // Not enough lookahead yet; retry when the next packet lands.
      if (to > end) break;

      this.hopHnr[hop] = this.hnrOfSegment(from, length, period);
    }
  }

  private hnrOfSegment(from: number, length: number, period: number): number {
    if (this.hnrScratch.length < length) this.hnrScratch = new Float64Array(length);
    const buf = this.hnrScratch;
    const pcm = this.pcm;

    let mean = 0;
    for (let i = 0; i < length; i++) mean += pcm[from + i];
    mean /= length;

    let energy = 0;
    const scale = (2 * Math.PI) / length;
    for (let i = 0; i < length; i++) {
      const w = 0.5 - 0.5 * Math.cos(scale * i);
      const v = (pcm[from + i] - mean) * w;
      buf[i] = v;
      energy += v * v;
    }
    if (energy <= 0) return HNR_MIN_DB;

    const lo = Math.max(1, Math.floor(period * HNR_LAG_LO));
    const hi = Math.min(length - 2, Math.ceil(period * HNR_LAG_HI));
    if (lo >= hi) return HNR_MIN_DB;

    let bestLag = -1;
    let best = -Infinity;
    let prev = 0;
    let bestPrev = 0;
    let bestNext = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let sum = 0;
      for (let i = 0, n = length - lag; i < n; i++) sum += buf[i] * buf[i + lag];
      // Hann window autocorrelation, closed form.
      const x = lag / length;
      const windowCorr =
        (1 - x) * (2 / 3 + (1 / 3) * Math.cos(2 * Math.PI * x)) +
        Math.sin(2 * Math.PI * x) / (2 * Math.PI);
      const r = sum / energy / windowCorr;
      if (r > best) {
        bestPrev = prev;
        best = r;
        bestLag = lag;
        bestNext = r;
      } else if (lag === bestLag + 1) {
        bestNext = r;
      }
      prev = r;
    }
    if (bestLag < 0) return HNR_MIN_DB;

    // Parabolic refinement of the peak height between neighbouring lags.
    let peak = best;
    if (bestLag > lo && bestLag < hi) {
      const denominator = bestPrev - 2 * best + bestNext;
      if (denominator < 0) {
        peak = best - ((bestPrev - bestNext) * (bestPrev - bestNext)) / (8 * denominator);
      }
    }

    if (!(peak > 0)) return HNR_MIN_DB;
    if (peak >= 1) return HNR_MAX_DB;
    const hnr = 10 * Math.log10(peak / (1 - peak));
    return hnr < HNR_MIN_DB ? HNR_MIN_DB : hnr > HNR_MAX_DB ? HNR_MAX_DB : hnr;
  }

  private measure(): { jitter: number; shimmer: number; hnr: number; cycles: number } | null {
    let startHop = this.hopCount;
    while (startHop > 0 && this.hopVoiced[startHop - 1] === 1) startHop--;
    if (startHop === this.hopCount) return null;

    const start = startHop * this.hopSize;
    const end = this.hopCount * this.hopSize;
    this.markCycles(start, end);

    const marks = this.positions.length;
    if (marks < MIN_CYCLES) return null;

    let periodSum = 0;
    let periodCount = 0;
    for (let i = 1; i < marks; i++) {
      periodSum += this.positions[i] - this.positions[i - 1];
      periodCount++;
    }
    const meanPeriod = periodSum / periodCount;

    let jitterSum = 0;
    let jitterPairs = 0;
    for (let i = 2; i < marks; i++) {
      const current = this.positions[i] - this.positions[i - 1];
      const prior = this.positions[i - 1] - this.positions[i - 2];
      const ratio = current > prior ? current / prior : prior / current;
      if (ratio > MAX_PERIOD_RATIO) continue;
      jitterSum += Math.abs(current - prior);
      jitterPairs++;
    }

    let shimmerSum = 0;
    let shimmerPairs = 0;
    for (let i = 1; i < marks; i++) {
      const current = this.amplitudes[i];
      const prior = this.amplitudes[i - 1];
      if (current <= 0 || prior <= 0) continue;
      shimmerSum += Math.abs(20 * Math.log10(current / prior));
      shimmerPairs++;
    }

    // Praat's mean harmonicity: average of the per-frame dB values.
    let hnrSum = 0;
    let hnrCount = 0;
    for (let h = startHop; h < this.hopCount; h++) {
      const value = this.hopHnr[h];
      if (Number.isNaN(value)) continue;
      hnrSum += value;
      hnrCount++;
    }

    // Stay silent rather than report a flawless voice we have not measured.
    if (jitterPairs < MIN_CYCLES - 2 || shimmerPairs < MIN_CYCLES - 1 || hnrCount === 0) {
      return null;
    }

    return {
      jitter: (jitterSum / jitterPairs / meanPeriod) * 100,
      shimmer: shimmerSum / shimmerPairs,
      hnr: hnrSum / hnrCount,
      cycles: marks,
    };
  }

  private strainOf(jitter: number, shimmer: number, hnr: number): number {
    const c = this.config;
    const jitterScore = clamp01(jitter / (2 * c.jitterPathologyPercent));
    const shimmerScore = clamp01(shimmer / (2 * c.shimmerPathologyDb));
    const hnrScore = clamp01((c.hnrHealthyDb - hnr) / (c.hnrHealthyDb - c.hnrFloorDb));
    const total = c.jitterWeight + c.shimmerWeight + c.hnrWeight;
    const weighted =
      c.jitterWeight * jitterScore + c.shimmerWeight * shimmerScore + c.hnrWeight * hnrScore;
    return (100 * weighted) / total;
  }

  /** Folds a measurement (or none) into the fatigue state and builds the payload. */
  private composite(
    measured: { jitter: number; shimmer: number; hnr: number; cycles: number } | null,
  ): BiomarkerPayload {
    const c = this.config;
    const now = this.elapsedSeconds;

    if (measured) {
      this.hasMeasurement = true;
      this.lastJitter = measured.jitter;
      this.lastShimmer = measured.shimmer;
      this.lastHnr = measured.hnr;
      this.lastCycles = measured.cycles;
      this.lastStrain = this.strainOf(measured.jitter, measured.shimmer, measured.hnr);

      // The envelope only advances on voiced time: silence neither recovers
      // nor accrues strain, it just pauses the clock.
      if (this.lastMeasureSeconds < 0) {
        this.strainSmoothed = this.lastStrain;
      } else {
        const dt = Math.max(0, now - this.lastMeasureSeconds);
        const alpha = 1 - Math.exp(-dt / c.smoothingSeconds);
        this.strainSmoothed += (this.lastStrain - this.strainSmoothed) * alpha;
      }
      this.lastMeasureSeconds = now;

      if (now >= this.nextTrendSampleAt) {
        this.trendValues[this.trendNext] = this.strainSmoothed;
        this.trendNext = (this.trendNext + 1) % TREND_SAMPLES;
        if (this.trendCount < TREND_SAMPLES) this.trendCount++;
        this.nextTrendSampleAt = now + 1;
      }
    }

    const smoothed = this.strainSmoothed;

    if (smoothed >= c.cautionEnter) {
      if (this.aboveCautionSince < 0) this.aboveCautionSince = now;
    } else if (smoothed < c.cautionExit) {
      this.aboveCautionSince = -1;
    }
    const sustainedSeconds = this.aboveCautionSince < 0 ? 0 : now - this.aboveCautionSince;

    // Hysteresis plus dwell: a single rough phrase never trips a warning.
    switch (this.strainLevel) {
      case 'normal':
        if (smoothed >= c.cautionEnter) this.strainLevel = 'caution';
        break;
      case 'caution':
        if (smoothed < c.cautionExit) this.strainLevel = 'normal';
        else if (smoothed >= c.warningEnter && sustainedSeconds >= c.warningDwellSeconds) {
          this.strainLevel = 'warning';
        }
        break;
      case 'warning':
        if (smoothed < c.warningExit) this.strainLevel = 'caution';
        break;
    }

    const trendPerMinute = this.trend();
    const fatigueWarning =
      this.strainLevel === 'warning' ||
      (this.strainLevel === 'caution' &&
        trendPerMinute >= c.trendWarningPerMinute &&
        sustainedSeconds >= c.warningDwellSeconds);

    return {
      timestamp: this.lastTimestamp,
      measured: measured !== null,
      jitterPercent: this.lastJitter,
      shimmerDb: this.lastShimmer,
      hnrDb: this.lastHnr,
      cycles: this.lastCycles,
      vocalStrainIndex: this.lastStrain,
      strainSmoothed: smoothed,
      strainLevel: this.strainLevel,
      fatigueWarning,
      sustainedSeconds,
      trendPerMinute,
      phonationSeconds: this.phonationSeconds,
    };
  }

  /** Least-squares slope of the one-per-second samples, in points per minute. */
  private trend(): number {
    const n = this.trendCount;
    if (n < 5) return 0;
    const first = (this.trendNext - n + TREND_SAMPLES) % TREND_SAMPLES;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
      const y = this.trendValues[(first + i) % TREND_SAMPLES];
      sumX += i;
      sumY += y;
      sumXY += i * y;
      sumXX += i * i;
    }
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return 0;
    return ((n * sumXY - sumX * sumY) / denominator) * 60;
  }

  /** Marks glottal pulse instants, refined to sub-sample precision. */
  private markCycles(start: number, end: number): void {
    this.positions.length = 0;
    this.amplitudes.length = 0;

    let sum = 0;
    for (let i = start; i < end; i++) sum += this.pcm[i];
    this.spanMean = sum / (end - start);

    let maximum = -Infinity;
    let minimum = Infinity;
    for (let i = start; i < end; i++) {
      const value = this.sampleAt(i);
      if (value > maximum) maximum = value;
      if (value < minimum) minimum = value;
    }
    if (!(maximum > 0) && !(minimum < 0)) return;
    const polarity = maximum >= -minimum ? 1 : -1;

    this.markWithScale(start, end, polarity, 1);
    // Strict long/short alternation reads as period doubling upstream. Marking
    // every other pulse would report a diplophonic voice as perfectly steady.
    if (this.hasSubharmonic(end, polarity)) {
      this.markWithScale(start, end, polarity, 0.5);
    }
  }

  private markWithScale(start: number, end: number, polarity: number, scale: number): void {
    this.positions.length = 0;
    this.amplitudes.length = 0;

    const seedPeriod = this.periodAt(start) * scale;
    if (seedPeriod <= 0) return;

    let peak = this.argExtremum(start, start + Math.ceil(seedPeriod * 1.2), end, polarity);
    if (peak < 0) return;
    this.record(peak, polarity);

    for (;;) {
      const period = this.periodAt(peak) * scale;
      if (period <= 0) break;
      const lo = Math.round(peak + period * SEARCH_LO);
      const hi = Math.round(peak + period * SEARCH_HI);
      if (hi >= end - 1) break;
      const next = this.argExtremum(lo, hi, end, polarity);
      if (next < 0 || next <= peak) break;
      this.record(next, polarity);
      peak = next;
    }
  }

  /** True when a comparable pulse sits midway between every marked pair. */
  private hasSubharmonic(end: number, polarity: number): boolean {
    const marks = this.positions.length;
    if (marks < 4) return false;

    let midSum = 0;
    let markSum = 0;
    let count = 0;
    for (let i = 1; i < marks; i++) {
      const previous = this.positions[i - 1];
      const span = this.positions[i] - previous;
      const lo = Math.round(previous + span * 0.35);
      const hi = Math.round(previous + span * 0.65);
      const index = this.argExtremum(lo, hi, end, polarity);
      if (index < 0) continue;
      midSum += polarity * this.sampleAt(index);
      markSum += this.amplitudes[i];
      count++;
    }
    if (count === 0) return false;
    return midSum / count > SUBHARMONIC_RATIO * (markSum / count);
  }

  /** Span-mean DC removal: zero-phase, so it cannot smear adjacent cycles. */
  private sampleAt(index: number): number {
    return this.pcm[index] - this.spanMean;
  }

  private periodAt(sample: number): number {
    const hop = Math.min(Math.max(Math.floor(sample / this.hopSize), 0), this.hopCount - 1);
    const pitch = this.hopPitch[hop];
    return pitch > 0 ? this.sampleRate / pitch : 0;
  }

  private argExtremum(lo: number, hi: number, end: number, polarity: number): number {
    const from = Math.max(lo, 1);
    const to = Math.min(hi, end - 2);
    if (from > to) return -1;

    let best = -1;
    let bestValue = -Infinity;
    for (let i = from; i <= to; i++) {
      const value = polarity * this.sampleAt(i);
      if (value > bestValue) {
        bestValue = value;
        best = i;
      }
    }
    return best;
  }

  /** Parabolic vertex: integer peaks would quantise jitter at ~0.8% at 16kHz. */
  private record(index: number, polarity: number): void {
    const left = polarity * this.sampleAt(index - 1);
    const centre = polarity * this.sampleAt(index);
    const right = polarity * this.sampleAt(index + 1);

    const denominator = left - 2 * centre + right;
    let delta = denominator !== 0 ? (0.5 * (left - right)) / denominator : 0;
    if (!Number.isFinite(delta) || Math.abs(delta) > 1) delta = 0;

    this.positions.push(index + delta);
    this.amplitudes.push(centre - 0.25 * (left - right) * delta);
  }
}

let analyzer = new CycleAnalyzer();
let port: MessagePort | null = null;

function emit(response: BiomarkerResponse): void {
  ctx.postMessage(response);
}

function attach(next: MessagePort): void {
  port?.close();
  port = next;
  next.onmessage = (event: MessageEvent<CyclePacket>) => {
    const packet = event.data;
    try {
      const payload = analyzer.accept(packet);
      const recycle: CyclePortMessage = {
        type: 'recycle',
        buffer: packet.hop.buffer as ArrayBuffer,
      };
      next.postMessage(recycle, [recycle.buffer]);
      if (payload) emit({ type: 'biomarkers', payload });
    } catch (error) {
      emit({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

ctx.onmessage = (event: MessageEvent) => {
  const request = event.data as BiomarkerRequest;

  try {
    switch (request.type) {
      case 'init': {
        analyzer = new CycleAnalyzer(request.config);
        emit({ type: 'ready', config: analyzer.currentConfig });
        break;
      }

      case 'connect': {
        attach(request.port);
        break;
      }

      case 'reset': {
        analyzer.reset();
        break;
      }

      case 'close': {
        port?.close();
        port = null;
        ctx.close();
        break;
      }

      default: {
        emit({
          type: 'error',
          message: `Unknown request: ${String((request as { type?: unknown }).type)}`,
        });
      }
    }
  } catch (error) {
    emit({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
