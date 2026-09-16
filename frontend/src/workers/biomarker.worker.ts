/**
 * Voice biomarkers measured cycle-by-cycle on the waveform.
 *
 * Receives PCM directly from audio.worker.ts over a MessagePort, so the main
 * thread never carries audio. Jitter and shimmer require per-glottal-cycle
 * resolution: a frame-level pitch/RMS track averages over roughly eight cycles
 * and destroys the very variation being measured, so this stage marks
 * individual pulses instead. HNR still comes from the upstream YIN
 * periodicity, which is already a whole-waveform measurement.
 */

import type { CyclePacket, CyclePortMessage } from '@/workers/audio.worker';

export interface BiomarkerPayload {
  timestamp: number;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  vocalStrainIndex: number;
}

export type BiomarkerRequest =
  | { type: 'init' }
  | { type: 'connect'; port: MessagePort }
  | { type: 'reset' }
  | { type: 'close' };

export type BiomarkerResponse =
  | { type: 'ready' }
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
const CONFIDENCE_CLAMP = 0.999;
/** Peak search bounds as a fraction of the expected period. */
const SEARCH_LO = 0.7;
const SEARCH_HI = 1.3;
/** Praat's maximum period factor; rejects octave slips and marking errors. */
const MAX_PERIOD_RATIO = 1.3;
/** Midpoint pulse height, relative to marked pulses, that implies period doubling. */
const SUBHARMONIC_RATIO = 0.5;

// Conventional adult sustained-vowel reference values, used only to scale the
// composite index. Not a validated clinical score.
const JITTER_CEILING = 2.0;
const SHIMMER_CEILING = 1.0;
const HNR_HEALTHY_DB = 20;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

class CycleAnalyzer {
  private pcm = new Float64Array(0);
  private hopPitch = new Float64Array(MAX_HOPS);
  private hopConfidence = new Float64Array(MAX_HOPS);
  private hopVoiced = new Uint8Array(MAX_HOPS);

  private hopSize = 0;
  private hopCount = 0;
  private sampleRate = 16000;
  private packetsSeen = 0;
  private lastTimestamp = 0;

  private spanMean = 0;
  private readonly positions: number[] = [];
  private readonly amplitudes: number[] = [];

  reset(): void {
    this.hopCount = 0;
    this.packetsSeen = 0;
    this.lastTimestamp = 0;
  }

  accept(packet: CyclePacket): BiomarkerPayload | null {
    if (packet.hopSize !== this.hopSize) {
      this.hopSize = packet.hopSize;
      this.pcm = new Float64Array(MAX_HOPS * this.hopSize);
      this.hopCount = 0;
    }
    this.sampleRate = packet.sampleRate;
    this.lastTimestamp = packet.timestamp;
    this.packetsSeen++;

    if (this.hopCount === MAX_HOPS) this.compact();

    const offset = this.hopCount * this.hopSize;
    this.pcm.set(packet.hop, offset);
    this.hopPitch[this.hopCount] = packet.pitchHz;
    this.hopConfidence[this.hopCount] = packet.pitchConfidence;
    this.hopVoiced[this.hopCount] =
      packet.voiced && packet.pitchConfidence >= CONFIDENCE_FLOOR ? 1 : 0;
    this.hopCount++;

    if (this.packetsSeen % EMIT_EVERY_HOPS !== 0) return null;
    return this.measure();
  }

  private compact(): void {
    const keep = this.hopCount - COMPACT_HOPS;
    this.pcm.copyWithin(0, COMPACT_HOPS * this.hopSize, this.hopCount * this.hopSize);
    this.hopPitch.copyWithin(0, COMPACT_HOPS, this.hopCount);
    this.hopConfidence.copyWithin(0, COMPACT_HOPS, this.hopCount);
    this.hopVoiced.copyWithin(0, COMPACT_HOPS, this.hopCount);
    this.hopCount = keep;
  }

  private measure(): BiomarkerPayload | null {
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

    let hnrSum = 0;
    let hnrCount = 0;
    for (let h = startHop; h < this.hopCount; h++) {
      const confidence = Math.min(this.hopConfidence[h], CONFIDENCE_CLAMP);
      hnrSum += 10 * Math.log10(confidence / (1 - confidence));
      hnrCount++;
    }

    // Stay silent rather than report a flawless voice we have not measured.
    if (jitterPairs < MIN_CYCLES - 2 || shimmerPairs < MIN_CYCLES - 1 || hnrCount === 0) {
      return null;
    }

    const jitterPercent = (jitterSum / jitterPairs / meanPeriod) * 100;
    const shimmerDb = shimmerSum / shimmerPairs;
    const hnrDb = hnrSum / hnrCount;

    const strain =
      0.35 * clamp01(jitterPercent / JITTER_CEILING) +
      0.35 * clamp01(shimmerDb / SHIMMER_CEILING) +
      0.3 * clamp01((HNR_HEALTHY_DB - hnrDb) / HNR_HEALTHY_DB);

    return {
      timestamp: this.lastTimestamp,
      jitterPercent,
      shimmerDb,
      hnrDb,
      vocalStrainIndex: strain * 100,
    };
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

const analyzer = new CycleAnalyzer();
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
        analyzer.reset();
        emit({ type: 'ready' });
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
