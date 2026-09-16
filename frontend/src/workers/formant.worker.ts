/**
 * LPC formant tracking at a fixed frame rate for articulation feedback.
 *
 * Per frame: 50 Hz pre-emphasis, Hamming window, autocorrelation,
 * Levinson-Durbin, polynomial roots (Durand-Kerner, warm-started from the
 * previous frame), then the three lowest well-damped resonances become
 * F1..F3. F1/F2 are placed on a Bark-scaled vowel plane and scored against a
 * reference vowel table by Euclidean distance.
 *
 * PCM arrives either as transferred buffers from the main thread (`process`)
 * or as CyclePackets over a MessagePort from audio.worker.ts (`connect`),
 * which also supplies voicing so unvoiced windows are never analysed.
 */

import type { CyclePacket, CyclePortMessage } from '@/workers/audio.worker';
import type { FormantData } from '@shared/types';

export type SpeakerProfile = 'male' | 'female' | 'child';

export interface VowelTarget {
  /** IPA symbol, also the key used by `setTarget`. */
  symbol: string;
  /** hVd keyword for display. */
  label: string;
  f1: number;
  f2: number;
  f3: number;
}

export interface PlanePoint {
  /** 0 = front (high F2) .. 1 = back. */
  x: number;
  /** 0 = close (low F1) .. 1 = open. */
  y: number;
}

export interface VowelPlaneGeometry {
  f1RangeHz: [number, number];
  f2RangeHz: [number, number];
  quadSlant: number;
  /** Trapezoid outline in quad space, clockwise from the front-close corner. */
  corners: Array<[number, number]>;
  /** Reference vowels in both spaces, in `scores` order. */
  vowels: Array<{ symbol: string; label: string; plane: PlanePoint; quad: PlanePoint }>;
}

export interface FormantWorkerConfig {
  sampleRate: number;
  /** Analysis frames emitted per second. */
  frameRate: number;
  windowMs: number;
  /** 0 selects 2 + sampleRate / 1000. */
  lpcOrder: number;
  preEmphasisHz: number;
  minFormantHz: number;
  maxFormantHz: number;
  /** Roots damped more than this are spectral tilt, not resonances. */
  maxBandwidthHz: number;
  silenceFloorDb: number;
  /** Window must be at least this voiced (0..1) when a voicing port is connected. */
  minVoicedFraction: number;
  /** One-pole factor on the Bark-domain track, 0 = none. */
  smoothing: number;
  /** Unvoiced frames before the smoothed track is dropped. */
  holdFrames: number;
  /** Bark distance at which accuracy reaches 0%. */
  toleranceBark: number;
  /** Weight of the F3 term in the distance; ignored when F3 is missing. */
  f3Weight: number;
  profile: SpeakerProfile;
  f1RangeHz: [number, number];
  f2RangeHz: [number, number];
  /** Horizontal inset of the open-front corner, as a fraction of plane width. */
  quadSlant: number;
  inputFormat: 'f32' | 'i16';
  epochMs: number;
}

export interface FormantFrame {
  timestamp: number;
  rms: number;
  volumeDb: number;
  /** Analysis ran: loud enough and (when known) voiced. */
  voiced: boolean;
  /** Smoothed track in Hz, 0 when unavailable. */
  f1: number;
  f2: number;
  f3: number;
  /** Bandwidths of the raw picks in Hz. */
  b1: number;
  b2: number;
  b3: number;
  raw: { f1: number; f2: number; f3: number };
  plane: PlanePoint;
  quad: PlanePoint;
  target: string | null;
  /** 0..100 against `target`; 0 when no target or unvoiced. */
  accuracy: number;
  nearest: { symbol: string; accuracy: number; distanceBark: number } | null;
  /** Accuracy per reference vowel, in `geometry.vowels` order. */
  scores: number[];
  formant: FormantData;
  processingMs: number;
}

export type FormantWorkerRequest =
  | { type: 'init'; config?: Partial<FormantWorkerConfig> }
  | { type: 'process'; buffer: ArrayBuffer; length?: number }
  | { type: 'connect'; port: MessagePort }
  | { type: 'setTarget'; symbol: string | null }
  | { type: 'setTargets'; targets: VowelTarget[] }
  | { type: 'setProfile'; profile: SpeakerProfile }
  | { type: 'reset' }
  | { type: 'close' };

export type FormantWorkerResponse =
  | { type: 'ready'; config: FormantWorkerConfig; geometry: VowelPlaneGeometry }
  | { type: 'geometry'; geometry: VowelPlaneGeometry }
  | { type: 'formants'; frames: FormantFrame[]; buffer?: ArrayBuffer }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}

const ctx = self as unknown as WorkerScope;

const DEFAULT_CONFIG: FormantWorkerConfig = {
  sampleRate: 16000,
  frameRate: 30,
  windowMs: 25,
  lpcOrder: 0,
  preEmphasisHz: 50,
  minFormantHz: 150,
  maxFormantHz: 5500,
  maxBandwidthHz: 500,
  silenceFloorDb: -50,
  minVoicedFraction: 0.5,
  smoothing: 0.5,
  holdFrames: 8,
  toleranceBark: 3,
  f3Weight: 0.3,
  profile: 'male',
  f1RangeHz: [200, 1000],
  f2RangeHz: [600, 2800],
  quadSlant: 0.4,
  inputFormat: 'f32',
  epochMs: 0,
};

const SILENT_DB = -120;
const MAX_LPC_ORDER = 32;
const MAX_ROOT_ITERATIONS = 120;
const ROOT_TOLERANCE = 1e-9;

/**
 * Steady-state means from Hillenbrand, Getty, Clark & Wheeler (1995),
 * "Acoustic characteristics of American English vowels", JASA 97(5), Table V.
 * Speaker-group averages, so treat as anchors rather than clinical norms;
 * `setTargets` replaces them.
 */
const REFERENCE_VOWELS: Record<SpeakerProfile, VowelTarget[]> = {
  male: [
    { symbol: 'i', label: 'heed', f1: 342, f2: 2322, f3: 3000 },
    { symbol: 'ɪ', label: 'hid', f1: 427, f2: 2034, f3: 2684 },
    { symbol: 'e', label: 'hayed', f1: 476, f2: 2089, f3: 2691 },
    { symbol: 'ɛ', label: 'head', f1: 580, f2: 1799, f3: 2605 },
    { symbol: 'æ', label: 'had', f1: 588, f2: 1952, f3: 2601 },
    { symbol: 'ɑ', label: 'hod', f1: 768, f2: 1333, f3: 2522 },
    { symbol: 'ɔ', label: 'hawed', f1: 652, f2: 997, f3: 2538 },
    { symbol: 'o', label: 'hoed', f1: 497, f2: 910, f3: 2459 },
    { symbol: 'ʊ', label: 'hood', f1: 469, f2: 1122, f3: 2434 },
    { symbol: 'u', label: "who'd", f1: 378, f2: 997, f3: 2343 },
    { symbol: 'ʌ', label: 'hud', f1: 623, f2: 1200, f3: 2550 },
    { symbol: 'ɝ', label: 'heard', f1: 474, f2: 1379, f3: 1710 },
  ],
  female: [
    { symbol: 'i', label: 'heed', f1: 437, f2: 2761, f3: 3372 },
    { symbol: 'ɪ', label: 'hid', f1: 483, f2: 2365, f3: 3053 },
    { symbol: 'e', label: 'hayed', f1: 536, f2: 2530, f3: 3047 },
    { symbol: 'ɛ', label: 'head', f1: 731, f2: 2058, f3: 2979 },
    { symbol: 'æ', label: 'had', f1: 669, f2: 2349, f3: 2972 },
    { symbol: 'ɑ', label: 'hod', f1: 936, f2: 1551, f3: 2815 },
    { symbol: 'ɔ', label: 'hawed', f1: 781, f2: 1136, f3: 2824 },
    { symbol: 'o', label: 'hoed', f1: 555, f2: 1035, f3: 2828 },
    { symbol: 'ʊ', label: 'hood', f1: 519, f2: 1225, f3: 2827 },
    { symbol: 'u', label: "who'd", f1: 459, f2: 1105, f3: 2735 },
    { symbol: 'ʌ', label: 'hud', f1: 753, f2: 1426, f3: 2933 },
    { symbol: 'ɝ', label: 'heard', f1: 523, f2: 1588, f3: 1929 },
  ],
  child: [
    { symbol: 'i', label: 'heed', f1: 452, f2: 3081, f3: 3702 },
    { symbol: 'ɪ', label: 'hid', f1: 511, f2: 2552, f3: 3403 },
    { symbol: 'e', label: 'hayed', f1: 564, f2: 2656, f3: 3323 },
    { symbol: 'ɛ', label: 'head', f1: 749, f2: 2267, f3: 3310 },
    { symbol: 'æ', label: 'had', f1: 717, f2: 2501, f3: 3289 },
    { symbol: 'ɑ', label: 'hod', f1: 1002, f2: 1688, f3: 2950 },
    { symbol: 'ɔ', label: 'hawed', f1: 803, f2: 1210, f3: 2982 },
    { symbol: 'o', label: 'hoed', f1: 597, f2: 1137, f3: 2987 },
    { symbol: 'ʊ', label: 'hood', f1: 568, f2: 1490, f3: 3072 },
    { symbol: 'u', label: "who'd", f1: 494, f2: 1345, f3: 2988 },
    { symbol: 'ʌ', label: 'hud', f1: 749, f2: 1546, f3: 3145 },
    { symbol: 'ɝ', label: 'heard', f1: 586, f2: 1719, f3: 2143 },
  ],
};

/** Traunmüller (1990) critical-band rate. */
export function hzToBark(hz: number): number {
  return (26.81 * hz) / (1960 + hz) - 0.53;
}

export function barkToHz(bark: number): number {
  return (1960 * (bark + 0.53)) / (26.28 - bark);
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

class FormantAnalyzer {
  private config: FormantWorkerConfig;

  private windowSize = 0;
  private order = 0;
  private preEmphasis = 0;
  private samplesPerFrame = 0;
  private nextFrameAt = 0;

  /** Raw PCM plus one extra sample so pre-emphasis has a predecessor. */
  private ring!: Float64Array;
  private voicedRing!: Uint8Array;
  private writeIndex = 0;
  private samplesWritten = 0;

  private hamming!: Float64Array;
  private frame!: Float64Array;
  private autocorr!: Float64Array;
  private lpc!: Float64Array;
  private lpcScratch!: Float64Array;
  private rootsRe!: Float64Array;
  private rootsIm!: Float64Array;
  private haveRoots = false;
  private candidatesHz: number[] = [];
  private candidatesBw: number[] = [];

  private smoothBark = new Float64Array(3);
  private smoothValid = false;
  private unvoicedRun = 0;

  private targets: VowelTarget[] = [];
  private targetBark: Float64Array = new Float64Array(0);
  private targetIndex = -1;

  private readonly ports: MessagePort[] = [];

  constructor(config: Partial<FormantWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setTargets(REFERENCE_VOWELS[this.config.profile]);
    this.allocate();
  }

  get currentConfig(): FormantWorkerConfig {
    return { ...this.config };
  }

  private allocate(): void {
    const {
      sampleRate,
      frameRate,
      windowMs,
      lpcOrder,
      preEmphasisHz,
      minFormantHz,
      maxFormantHz,
      f1RangeHz,
      f2RangeHz,
    } = this.config;

    if (sampleRate < 8000) throw new Error(`sampleRate must be >= 8000, received ${sampleRate}`);
    if (frameRate <= 0 || frameRate > 200) {
      throw new Error(`frameRate must be within 1..200, received ${frameRate}`);
    }
    if (windowMs < 10 || windowMs > 100) {
      throw new Error(`windowMs must be within 10..100, received ${windowMs}`);
    }
    if (minFormantHz <= 0 || maxFormantHz <= minFormantHz || maxFormantHz > sampleRate / 2) {
      throw new Error('Formant range requires 0 < minFormantHz < maxFormantHz <= Nyquist');
    }
    if (f1RangeHz[0] >= f1RangeHz[1] || f2RangeHz[0] >= f2RangeHz[1]) {
      throw new Error('Plane ranges must be ascending');
    }

    this.order = lpcOrder > 0 ? lpcOrder : 2 + Math.round(sampleRate / 1000);
    if (this.order < 4 || this.order > MAX_LPC_ORDER) {
      throw new Error(`lpcOrder must be within 4..${MAX_LPC_ORDER}, received ${this.order}`);
    }

    this.windowSize = Math.round((windowMs / 1000) * sampleRate);
    if (this.windowSize <= this.order * 2) {
      throw new Error('windowMs is too short for the LPC order');
    }
    this.preEmphasis = Math.exp((-2 * Math.PI * preEmphasisHz) / sampleRate);
    this.samplesPerFrame = sampleRate / frameRate;

    const ringSize = this.windowSize + 1;
    this.ring = new Float64Array(ringSize);
    this.voicedRing = new Uint8Array(ringSize);

    this.hamming = new Float64Array(this.windowSize);
    for (let i = 0; i < this.windowSize; i++) {
      this.hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (this.windowSize - 1));
    }

    this.frame = new Float64Array(this.windowSize);
    this.autocorr = new Float64Array(this.order + 1);
    this.lpc = new Float64Array(this.order + 1);
    this.lpcScratch = new Float64Array(this.order + 1);
    this.rootsRe = new Float64Array(this.order);
    this.rootsIm = new Float64Array(this.order);

    this.reset();
  }

  reset(): void {
    this.ring.fill(0);
    this.voicedRing.fill(0);
    this.writeIndex = 0;
    this.samplesWritten = 0;
    this.nextFrameAt = this.windowSize;
    this.haveRoots = false;
    this.smoothValid = false;
    this.unvoicedRun = 0;
  }

  reconfigure(patch: Partial<FormantWorkerConfig>): void {
    this.config = { ...this.config, ...patch };
    this.allocate();
  }

  setTargets(targets: VowelTarget[]): void {
    if (targets.length === 0) throw new Error('At least one target vowel is required');
    const previous = this.targetIndex >= 0 ? this.targets[this.targetIndex].symbol : null;
    this.targets = targets.map((target) => ({ ...target }));
    this.targetBark = new Float64Array(targets.length * 3);
    for (let i = 0; i < targets.length; i++) {
      this.targetBark[i * 3] = hzToBark(targets[i].f1);
      this.targetBark[i * 3 + 1] = hzToBark(targets[i].f2);
      this.targetBark[i * 3 + 2] = hzToBark(targets[i].f3);
    }
    this.targetIndex = previous === null ? -1 : this.targets.findIndex((t) => t.symbol === previous);
  }

  setProfile(profile: SpeakerProfile): void {
    this.config.profile = profile;
    this.setTargets(REFERENCE_VOWELS[profile]);
  }

  setTarget(symbol: string | null): void {
    if (symbol === null) {
      this.targetIndex = -1;
      return;
    }
    const index = this.targets.findIndex((target) => target.symbol === symbol);
    if (index < 0) throw new Error(`Unknown target vowel: ${symbol}`);
    this.targetIndex = index;
  }

  geometry(): VowelPlaneGeometry {
    const { f1RangeHz, f2RangeHz, quadSlant } = this.config;
    return {
      f1RangeHz: [f1RangeHz[0], f1RangeHz[1]],
      f2RangeHz: [f2RangeHz[0], f2RangeHz[1]],
      quadSlant,
      corners: [
        [0, 0],
        [1, 0],
        [1, 1],
        [quadSlant, 1],
      ],
      vowels: this.targets.map((target) => {
        const plane = this.toPlane(hzToBark(target.f1), hzToBark(target.f2));
        return { symbol: target.symbol, label: target.label, plane, quad: this.toQuad(plane) };
      }),
    };
  }

  connect(port: MessagePort): void {
    this.ports.push(port);
    port.onmessage = (event: MessageEvent<CyclePacket>) => {
      const packet = event.data;
      if (!packet || !(packet.hop instanceof Float32Array)) return;

      if (packet.sampleRate !== this.config.sampleRate) {
        this.reconfigure({ sampleRate: packet.sampleRate });
      }

      const frames = this.push(packet.hop, packet.voiced);
      const recycle: CyclePortMessage = { type: 'recycle', buffer: packet.hop.buffer as ArrayBuffer };
      port.postMessage(recycle, [recycle.buffer]);

      if (frames.length > 0) {
        const response: FormantWorkerResponse = { type: 'formants', frames };
        ctx.postMessage(response);
      }
    };
  }

  disconnect(): void {
    for (const port of this.ports) port.close();
    this.ports.length = 0;
  }

  /** Streams a chunk in; `voiced` is the upstream verdict for every sample of it. */
  push(samples: Float32Array | Int16Array, voiced = true): FormantFrame[] {
    const frames: FormantFrame[] = [];
    const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
    const ringSize = this.ring.length;
    const flag = voiced ? 1 : 0;

    for (let i = 0; i < samples.length; i++) {
      this.ring[this.writeIndex] = samples[i] * scale;
      this.voicedRing[this.writeIndex] = flag;
      this.writeIndex = (this.writeIndex + 1) % ringSize;
      this.samplesWritten++;

      if (this.samplesWritten >= this.nextFrameAt) {
        frames.push(this.analyze());
        this.nextFrameAt += this.samplesPerFrame;
      }
    }

    return frames;
  }

  private analyze(): FormantFrame {
    const started = performance.now();
    const { sampleRate, epochMs, silenceFloorDb, minVoicedFraction, holdFrames } = this.config;
    const size = this.windowSize;
    const ringSize = this.ring.length;
    const frame = this.frame;

    // Oldest sample in the ring is the pre-emphasis predecessor of the window.
    let index = (this.writeIndex - size - 1 + ringSize) % ringSize;
    let previous = this.ring[index];
    index = (index + 1) % ringSize;

    let sumSquares = 0;
    let voicedCount = 0;
    for (let i = 0; i < size; i++) {
      const sample = this.ring[index];
      sumSquares += sample * sample;
      voicedCount += this.voicedRing[index];
      frame[i] = (sample - this.preEmphasis * previous) * this.hamming[i];
      previous = sample;
      index = (index + 1) % ringSize;
    }

    const rms = Math.sqrt(sumSquares / size);
    const volumeDb = rms > 0 ? Math.max(SILENT_DB, 20 * Math.log10(rms)) : SILENT_DB;
    const voiced = volumeDb >= silenceFloorDb && voicedCount / size >= minVoicedFraction;
    const timestamp = epochMs + (this.samplesWritten / sampleRate) * 1000;

    let rawF1 = 0;
    let rawF2 = 0;
    let rawF3 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;

    if (voiced && this.computeLpc()) {
      this.findRoots();
      this.collectCandidates();
      const hz = this.candidatesHz;
      const bw = this.candidatesBw;
      if (hz.length > 0) {
        rawF1 = hz[0];
        b1 = bw[0];
      }
      if (hz.length > 1) {
        rawF2 = hz[1];
        b2 = bw[1];
      }
      if (hz.length > 2) {
        rawF3 = hz[2];
        b3 = bw[2];
      }
    }

    // F1 and F2 are required for placement; F3 refines the score when present.
    const measured = rawF1 > 0 && rawF2 > 0;
    if (measured) {
      this.unvoicedRun = 0;
      this.track(rawF1, rawF2, rawF3);
    } else if (++this.unvoicedRun > holdFrames) {
      this.smoothValid = false;
    }

    const smoothed = this.smoothValid;
    const z1 = smoothed ? this.smoothBark[0] : 0;
    const z2 = smoothed ? this.smoothBark[1] : 0;
    const z3 = smoothed ? this.smoothBark[2] : 0;
    const f1 = smoothed ? barkToHz(z1) : 0;
    const f2 = smoothed ? barkToHz(z2) : 0;
    const f3 = smoothed && z3 > 0 ? barkToHz(z3) : 0;

    const plane = smoothed ? this.toPlane(z1, z2) : { x: 0.5, y: 0.5 };
    const quad = this.toQuad(plane);

    const scores = new Array<number>(this.targets.length).fill(0);
    let nearest: FormantFrame['nearest'] = null;
    if (smoothed) {
      let bestIndex = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < this.targets.length; i++) {
        const distance = this.distanceBark(i, z1, z2, z3);
        scores[i] = this.accuracyFromDistance(distance);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0) {
        nearest = {
          symbol: this.targets[bestIndex].symbol,
          accuracy: scores[bestIndex],
          distanceBark: bestDistance,
        };
      }
    }

    const target = this.targetIndex >= 0 ? this.targets[this.targetIndex].symbol : null;
    const accuracy = this.targetIndex >= 0 ? scores[this.targetIndex] : 0;

    return {
      timestamp,
      rms,
      volumeDb,
      voiced,
      f1,
      f2,
      f3,
      b1,
      b2,
      b3,
      raw: { f1: rawF1, f2: rawF2, f3: rawF3 },
      plane,
      quad,
      target,
      accuracy,
      nearest,
      scores,
      formant: { f1, f2, f3, accuracyScore: accuracy },
      processingMs: performance.now() - started,
    };
  }

  /** Autocorrelation method; false when the window carries no energy. */
  private computeLpc(): boolean {
    const frame = this.frame;
    const size = this.windowSize;
    const order = this.order;
    const r = this.autocorr;

    for (let lag = 0; lag <= order; lag++) {
      let sum = 0;
      for (let i = lag; i < size; i++) sum += frame[i] * frame[i - lag];
      r[lag] = sum;
    }
    if (r[0] <= 0) return false;
    // Slight white-noise correction keeps the recursion stable on near-singular frames.
    r[0] *= 1 + 1e-9;

    const a = this.lpc;
    const scratch = this.lpcScratch;
    a.fill(0);
    a[0] = 1;
    let error = r[0];

    for (let i = 1; i <= order; i++) {
      let acc = r[i];
      for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
      const k = -acc / error;

      for (let j = 1; j < i; j++) scratch[j] = a[j] + k * a[i - j];
      for (let j = 1; j < i; j++) a[j] = scratch[j];
      a[i] = k;

      error *= 1 - k * k;
      if (error <= 0) return false;
    }
    return true;
  }

  /**
   * Durand-Kerner on z^p + a1 z^(p-1) + ... + ap. Roots from the previous
   * frame seed the iteration, so steady vowels converge in a handful of steps.
   */
  private findRoots(): void {
    const order = this.order;
    const a = this.lpc;
    const re = this.rootsRe;
    const im = this.rootsIm;

    if (!this.haveRoots) {
      // Classic spiral start: distinct, non-real, inside the unit circle.
      let zr = 1;
      let zi = 0;
      for (let k = 0; k < order; k++) {
        re[k] = zr;
        im[k] = zi;
        const nr = zr * 0.4 - zi * 0.9;
        zi = zr * 0.9 + zi * 0.4;
        zr = nr;
      }
      this.haveRoots = true;
    }

    for (let iteration = 0; iteration < MAX_ROOT_ITERATIONS; iteration++) {
      let maxStep = 0;

      for (let i = 0; i < order; i++) {
        const zr = re[i];
        const zi = im[i];

        // Horner: P(z) with leading coefficient 1.
        let pr = 1;
        let pi = 0;
        for (let k = 1; k <= order; k++) {
          const tr = pr * zr - pi * zi + a[k];
          pi = pr * zi + pi * zr;
          pr = tr;
        }

        let dr = 1;
        let di = 0;
        for (let j = 0; j < order; j++) {
          if (j === i) continue;
          const xr = zr - re[j];
          const xi = zi - im[j];
          const tr = dr * xr - di * xi;
          di = dr * xi + di * xr;
          dr = tr;
        }

        let denom = dr * dr + di * di;
        if (denom < 1e-30) {
          // Two estimates collided; nudge apart and continue.
          re[i] += 1e-6;
          im[i] += 1e-6;
          denom = 1e-30;
        }
        const stepR = (pr * dr + pi * di) / denom;
        const stepI = (pi * dr - pr * di) / denom;
        re[i] = zr - stepR;
        im[i] = zi - stepI;

        const step = stepR * stepR + stepI * stepI;
        if (step > maxStep) maxStep = step;
      }

      if (maxStep < ROOT_TOLERANCE * ROOT_TOLERANCE) break;
    }
  }

  /** Positive-frequency roots inside the search band, sorted ascending. */
  private collectCandidates(): void {
    const { sampleRate, minFormantHz, maxFormantHz, maxBandwidthHz } = this.config;
    const hz = this.candidatesHz;
    const bw = this.candidatesBw;
    hz.length = 0;
    bw.length = 0;

    for (let i = 0; i < this.order; i++) {
      const zr = this.rootsRe[i];
      const zi = this.rootsIm[i];
      if (zi <= 0) continue;

      const frequency = (Math.atan2(zi, zr) * sampleRate) / (2 * Math.PI);
      if (frequency < minFormantHz || frequency > maxFormantHz) continue;

      const magnitude = Math.sqrt(zr * zr + zi * zi);
      if (magnitude >= 1) continue;
      const bandwidth = (-Math.log(magnitude) * sampleRate) / Math.PI;
      if (bandwidth > maxBandwidthHz) continue;

      // Insertion keeps the short list ordered without allocating.
      let position = hz.length;
      while (position > 0 && hz[position - 1] > frequency) position--;
      hz.splice(position, 0, frequency);
      bw.splice(position, 0, bandwidth);
    }
  }

  private track(f1: number, f2: number, f3: number): void {
    const { smoothing } = this.config;
    const z = this.smoothBark;
    const z1 = hzToBark(f1);
    const z2 = hzToBark(f2);
    const z3 = f3 > 0 ? hzToBark(f3) : 0;

    if (!this.smoothValid) {
      z[0] = z1;
      z[1] = z2;
      z[2] = z3;
      this.smoothValid = true;
      return;
    }

    const alpha = 1 - clamp01(smoothing);
    z[0] += (z1 - z[0]) * alpha;
    z[1] += (z2 - z[1]) * alpha;
    // A missing F3 holds the last estimate rather than collapsing to zero.
    if (z3 > 0) z[2] = z[2] > 0 ? z[2] + (z3 - z[2]) * alpha : z3;
  }

  private toPlane(z1: number, z2: number): PlanePoint {
    const { f1RangeHz, f2RangeHz } = this.config;
    const y0 = hzToBark(f1RangeHz[0]);
    const y1 = hzToBark(f1RangeHz[1]);
    const x0 = hzToBark(f2RangeHz[0]);
    const x1 = hzToBark(f2RangeHz[1]);
    return {
      x: 1 - clamp01((z2 - x0) / (x1 - x0)),
      y: clamp01((z1 - y0) / (y1 - y0)),
    };
  }

  /** Skews the rectangle so the open-front corner is inset, as on the IPA chart. */
  private toQuad(plane: PlanePoint): PlanePoint {
    const slant = this.config.quadSlant;
    return { x: slant * plane.y + plane.x * (1 - slant * plane.y), y: plane.y };
  }

  private distanceBark(index: number, z1: number, z2: number, z3: number): number {
    const t = this.targetBark;
    const d1 = z1 - t[index * 3];
    const d2 = z2 - t[index * 3 + 1];
    let sum = d1 * d1 + d2 * d2;
    if (z3 > 0) {
      const d3 = z3 - t[index * 3 + 2];
      sum += this.config.f3Weight * d3 * d3;
    }
    return Math.sqrt(sum);
  }

  private accuracyFromDistance(distance: number): number {
    return 100 * clamp01(1 - distance / this.config.toleranceBark);
  }
}

let analyzer: FormantAnalyzer | null = null;

function fail(message: string): void {
  const response: FormantWorkerResponse = { type: 'error', message };
  ctx.postMessage(response);
}

function postGeometry(): void {
  if (!analyzer) return;
  const response: FormantWorkerResponse = { type: 'geometry', geometry: analyzer.geometry() };
  ctx.postMessage(response);
}

ctx.onmessage = (event: MessageEvent) => {
  const request = event.data as FormantWorkerRequest;

  try {
    switch (request.type) {
      case 'init': {
        analyzer?.disconnect();
        analyzer = new FormantAnalyzer(request.config);
        const response: FormantWorkerResponse = {
          type: 'ready',
          config: analyzer.currentConfig,
          geometry: analyzer.geometry(),
        };
        ctx.postMessage(response);
        break;
      }

      case 'process': {
        if (!analyzer) {
          fail('Worker received audio before init');
          return;
        }

        const { buffer, length } = request;
        const format = analyzer.currentConfig.inputFormat;
        const bytesPerSample = format === 'i16' ? 2 : 4;
        const available = Math.floor(buffer.byteLength / bytesPerSample);
        const count = Math.min(length ?? available, available);

        const samples =
          format === 'i16' ? new Int16Array(buffer, 0, count) : new Float32Array(buffer, 0, count);

        const frames = analyzer.push(samples);
        const response: FormantWorkerResponse = { type: 'formants', frames, buffer };
        ctx.postMessage(response, [buffer]);
        break;
      }

      case 'connect': {
        if (!analyzer) {
          fail('Worker received a port before init');
          return;
        }
        analyzer.connect(request.port);
        break;
      }

      case 'setTarget': {
        analyzer?.setTarget(request.symbol);
        break;
      }

      case 'setTargets': {
        analyzer?.setTargets(request.targets);
        postGeometry();
        break;
      }

      case 'setProfile': {
        analyzer?.setProfile(request.profile);
        postGeometry();
        break;
      }

      case 'reset': {
        analyzer?.reset();
        break;
      }

      case 'close': {
        analyzer?.disconnect();
        analyzer = null;
        ctx.close();
        break;
      }

      default: {
        fail(`Unknown request: ${String((request as { type?: unknown }).type)}`);
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
};
