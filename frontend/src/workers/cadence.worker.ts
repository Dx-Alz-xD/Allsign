/**
 * Speech cadence from the CyclePacket stream: speaking rate, vocal blocks and
 * pitch volatility, i.e. the FluencyMetrics the HUD and caregiver link show.
 *
 * Speaking rate counts syllable nuclei: peaks of the smoothed intensity
 * envelope that are voiced, stand `nucleusProminenceDb` above the surrounding
 * dip and sit at least `minNucleusGapMs` apart. Syllables per second over a
 * sliding window convert to words per minute with the English average of
 * ~1.5 syllables per word, so no recognizer is involved.
 *
 * A vocal block is a voicing gap inside an utterance: after voiced speech, no
 * voicing for at least `blockMinMs`. It stays "ongoing" until voicing resumes
 * or `blockMaxMs` passes, at which point the utterance is over. This is a
 * rule on timing alone and will also count some long mid-sentence pauses.
 */

import type { CyclePacket, CyclePortMessage } from '@/workers/audio.worker';

export interface CadenceConfig {
  /** Sliding window for the speaking-rate estimate. */
  rateWindowMs: number;
  syllablesPerWord: number;
  /** Envelope smoothing, in hops. */
  envelopeSmoothingHops: number;
  nucleusProminenceDb: number;
  minNucleusGapMs: number;
  /** Envelope must be this far above the silence floor to host a nucleus. */
  nucleusFloorDb: number;
  silenceFloorDb: number;
  blockMinMs: number;
  blockMaxMs: number;
  /** Voicing this long before a gap makes the gap part of an utterance. */
  utteranceMinVoicedMs: number;
  pitchWindowMs: number;
  emitEveryHops: number;
  /** One-pole smoothing of the reported rate, 0..1 (0 = none). */
  rateSmoothing: number;
}

export interface CadencePayload {
  timestamp: number;
  wpm: number;
  syllablesPerSecond: number;
  vocalBlockDetected: boolean;
  /** Duration of the ongoing block, or of the last one once it ended. */
  blockDurationMs: number;
  blockCount: number;
  /** Time spent in blocks since reset. */
  blockedMs: number;
  /** Voiced time since reset. */
  speakingMs: number;
  pitchVolatilityHz: number;
  /** True while voiced speech happened within the utterance timeout. */
  utteranceActive: boolean;
}

export type CadenceRequest =
  | { type: 'init'; config?: Partial<CadenceConfig> }
  | { type: 'connect'; port: MessagePort }
  | { type: 'reset' }
  | { type: 'close' };

export type CadenceResponse =
  | { type: 'ready'; config: CadenceConfig }
  | { type: 'cadence'; payload: CadencePayload }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}

const ctx = self as unknown as WorkerScope;

const DEFAULT_CONFIG: CadenceConfig = {
  rateWindowMs: 3000,
  syllablesPerWord: 1.5,
  envelopeSmoothingHops: 3,
  nucleusProminenceDb: 2,
  minNucleusGapMs: 120,
  nucleusFloorDb: 6,
  silenceFloorDb: -55,
  blockMinMs: 400,
  blockMaxMs: 4000,
  utteranceMinVoicedMs: 300,
  pitchWindowMs: 1000,
  emitEveryHops: 10,
  rateSmoothing: 0.6,
};

const SILENT_DB = -120;
const MAX_HOPS = 1024;

class CadenceAnalyzer {
  private config: CadenceConfig;

  private hopMs = 10;
  private hopCount = 0;
  private packetsSeen = 0;
  private lastTimestamp = 0;

  // Ring of per-hop features.
  private readonly levelDb = new Float64Array(MAX_HOPS);
  private readonly envelope = new Float64Array(MAX_HOPS);
  private readonly voiced = new Uint8Array(MAX_HOPS);
  private readonly pitch = new Float64Array(MAX_HOPS);
  private readonly nucleus = new Uint8Array(MAX_HOPS);

  private lastNucleusHop = -1;
  private wpmSmoothed = 0;

  // Utterance / block state, in hop indices.
  private voicedRunHops = 0;
  private lastVoicedHop = -1;
  private utteranceVoicedMs = 0;
  private blockStartHop = -1;
  private blockOngoing = false;
  private lastBlockMs = 0;
  private blockCount = 0;
  private blockedMs = 0;
  private speakingMs = 0;

  constructor(config: Partial<CadenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  get currentConfig(): CadenceConfig {
    return { ...this.config };
  }

  reset(): void {
    this.hopCount = 0;
    this.packetsSeen = 0;
    this.lastTimestamp = 0;
    this.levelDb.fill(SILENT_DB);
    this.envelope.fill(SILENT_DB);
    this.voiced.fill(0);
    this.pitch.fill(0);
    this.nucleus.fill(0);
    this.lastNucleusHop = -1;
    this.wpmSmoothed = 0;
    this.voicedRunHops = 0;
    this.lastVoicedHop = -1;
    this.utteranceVoicedMs = 0;
    this.blockStartHop = -1;
    this.blockOngoing = false;
    this.lastBlockMs = 0;
    this.blockCount = 0;
    this.blockedMs = 0;
    this.speakingMs = 0;
  }

  accept(packet: CyclePacket): CadencePayload | null {
    this.hopMs = (packet.hopSize / packet.sampleRate) * 1000;
    this.lastTimestamp = packet.timestamp;
    this.packetsSeen++;

    const index = this.hopCount % MAX_HOPS;
    const db = packet.rms > 0 ? Math.max(SILENT_DB, 20 * Math.log10(packet.rms)) : SILENT_DB;
    this.levelDb[index] = db;
    this.voiced[index] = packet.voiced ? 1 : 0;
    this.pitch[index] = packet.voiced ? packet.pitchHz : 0;
    this.nucleus[index] = 0;
    this.hopCount++;

    this.smoothEnvelope();
    this.detectNucleus();
    this.trackBlocks(packet.voiced);

    if (this.packetsSeen % this.config.emitEveryHops !== 0) return null;
    return this.payload();
  }

  private at(array: Float64Array | Uint8Array, hop: number): number {
    return array[((hop % MAX_HOPS) + MAX_HOPS) % MAX_HOPS];
  }

  /** Moving average of the level over the last `envelopeSmoothingHops` hops. */
  private smoothEnvelope(): void {
    const n = Math.max(1, this.config.envelopeSmoothingHops);
    const latest = this.hopCount - 1;
    let sum = 0;
    let count = 0;
    for (let hop = latest; hop > latest - n && hop >= 0; hop--) {
      sum += this.at(this.levelDb, hop);
      count++;
    }
    this.envelope[latest % MAX_HOPS] = sum / count;
  }

  /**
   * A nucleus is confirmed one hop late: the previous hop is a local maximum
   * of the envelope, voiced, above the floor, prominent over the dip within
   * `minNucleusGapMs` before it, and far enough from the previous nucleus.
   */
  private detectNucleus(): void {
    const { nucleusProminenceDb, minNucleusGapMs, nucleusFloorDb, silenceFloorDb } = this.config;
    const candidate = this.hopCount - 2;
    if (candidate < 1) return;

    const value = this.at(this.envelope, candidate);
    if (this.at(this.voiced, candidate) === 0) return;
    if (value < silenceFloorDb + nucleusFloorDb) return;
    if (value < this.at(this.envelope, candidate - 1) || value <= this.at(this.envelope, candidate + 1)) return;

    const gapHops = Math.max(1, Math.round(minNucleusGapMs / this.hopMs));
    if (this.lastNucleusHop >= 0 && candidate - this.lastNucleusHop < gapHops) return;

    let dip = value;
    for (let hop = candidate - 1; hop >= Math.max(0, candidate - gapHops); hop--) {
      dip = Math.min(dip, this.at(this.envelope, hop));
    }
    if (value - dip < nucleusProminenceDb) return;

    this.nucleus[candidate % MAX_HOPS] = 1;
    this.lastNucleusHop = candidate;
  }

  private trackBlocks(voiced: boolean): void {
    const { blockMinMs, blockMaxMs, utteranceMinVoicedMs } = this.config;
    const hop = this.hopCount - 1;
    const hopMs = this.hopMs;

    if (voiced) {
      this.speakingMs += hopMs;
      this.voicedRunHops++;
      this.utteranceVoicedMs += hopMs;
      if (this.blockOngoing) {
        this.blockOngoing = false;
        this.lastBlockMs = (hop - this.blockStartHop) * hopMs;
      }
      this.blockStartHop = -1;
      this.lastVoicedHop = hop;
      return;
    }

    this.voicedRunHops = 0;
    if (this.lastVoicedHop < 0) return;

    const gapMs = (hop - this.lastVoicedHop) * hopMs;
    if (gapMs > blockMaxMs) {
      // The utterance is over; whatever gap this was, it is a pause now.
      if (this.blockOngoing) {
        this.blockOngoing = false;
        this.lastBlockMs = blockMaxMs;
      }
      this.utteranceVoicedMs = 0;
      return;
    }

    if (this.utteranceVoicedMs < utteranceMinVoicedMs) return;

    if (!this.blockOngoing && gapMs >= blockMinMs) {
      this.blockOngoing = true;
      this.blockStartHop = this.lastVoicedHop + 1;
      this.blockCount++;
      // The first blockMinMs already elapsed inside this gap.
      this.blockedMs += gapMs - hopMs;
    }
    if (this.blockOngoing) this.blockedMs += hopMs;
  }

  private payload(): CadencePayload {
    const { rateWindowMs, syllablesPerWord, pitchWindowMs, rateSmoothing, blockMaxMs } = this.config;
    const latest = this.hopCount - 1;
    const hopMs = this.hopMs;

    const windowHops = Math.max(1, Math.round(rateWindowMs / hopMs));
    let syllables = 0;
    for (let hop = latest; hop > latest - windowHops && hop >= 0; hop--) syllables += this.at(this.nucleus, hop);
    const spannedMs = Math.min(this.hopCount, windowHops) * hopMs;
    const syllablesPerSecond = spannedMs > 0 ? (syllables * 1000) / spannedMs : 0;
    const wpm = (syllablesPerSecond * 60) / syllablesPerWord;
    this.wpmSmoothed += (wpm - this.wpmSmoothed) * (1 - Math.max(0, Math.min(0.99, rateSmoothing)));

    const pitchHops = Math.max(1, Math.round(pitchWindowMs / hopMs));
    let count = 0;
    let sum = 0;
    let sumSquares = 0;
    for (let hop = latest; hop > latest - pitchHops && hop >= 0; hop--) {
      const value = this.at(this.pitch, hop);
      if (value <= 0) continue;
      count++;
      sum += value;
      sumSquares += value * value;
    }
    let pitchVolatilityHz = 0;
    if (count >= 5) {
      const mean = sum / count;
      pitchVolatilityHz = Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
    }

    const sinceVoicedMs = this.lastVoicedHop >= 0 ? (latest - this.lastVoicedHop) * hopMs : Infinity;
    const blockDurationMs = this.blockOngoing ? (latest - this.blockStartHop + 1) * hopMs : this.lastBlockMs;

    return {
      timestamp: this.lastTimestamp,
      wpm: this.wpmSmoothed,
      syllablesPerSecond,
      vocalBlockDetected: this.blockOngoing,
      blockDurationMs,
      blockCount: this.blockCount,
      blockedMs: this.blockedMs,
      speakingMs: this.speakingMs,
      pitchVolatilityHz,
      utteranceActive: sinceVoicedMs <= blockMaxMs,
    };
  }
}

let analyzer = new CadenceAnalyzer();
let port: MessagePort | null = null;

function emit(response: CadenceResponse): void {
  ctx.postMessage(response);
}

function attach(next: MessagePort): void {
  port?.close();
  port = next;
  next.onmessage = (event: MessageEvent<CyclePacket>) => {
    const packet = event.data;
    if (!packet || !(packet.hop instanceof Float32Array)) return;
    try {
      const payload = analyzer.accept(packet);
      if (payload) emit({ type: 'cadence', payload });
    } catch (error) {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      const recycle: CyclePortMessage = { type: 'recycle', buffer: packet.hop.buffer as ArrayBuffer };
      next.postMessage(recycle, [recycle.buffer]);
    }
  };
}

ctx.onmessage = (event: MessageEvent) => {
  const request = event.data as CadenceRequest;

  try {
    switch (request.type) {
      case 'init': {
        analyzer = new CadenceAnalyzer(request.config);
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
        emit({ type: 'error', message: `Unknown request: ${String((request as { type?: unknown }).type)}` });
      }
    }
  } catch (error) {
    emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
