/**
 * Off-thread acoustic feature extraction for 16 kHz raw PCM.
 * Input buffers are transferred in and handed back for reuse; spectral bin
 * arrays are transferred out and returned to a pool via `recycle`.
 */

export interface AudioWorkerConfig {
  sampleRate: number;
  /** Analysis window length in samples. Must be a power of two. */
  frameSize: number;
  /** Samples advanced between successive frames. */
  hopSize: number;
  spectralBinCount: number;
  minPitchHz: number;
  maxPitchHz: number;
  yinThreshold: number;
  /**
   * Without a dip below `yinThreshold`, the global CMND minimum still counts
   * as voiced (at lower confidence) when it is below this. Rough or breathy
   * voices never dip under the clean-speech threshold, and the biomarker
   * stage needs pitch precisely then.
   */
  unvoicedCmnd: number;
  /** Frames quieter than this skip pitch detection and report unvoiced. */
  silenceFloorDb: number;
  inputFormat: 'f32' | 'i16';
  /** Added to the sample-derived clock so frames carry wall time. */
  epochMs: number;
}

export interface AudioAnalysisFrame {
  /** epochMs + audio-clock offset of the window's trailing edge. */
  timestamp: number;
  rms: number;
  volumeDb: number;
  /** Sign changes per sample, 0..1. */
  zcr: number;
  pitchHz: number;
  /** YIN periodicity, 0..1. */
  pitchConfidence: number;
  voiced: boolean;
  spectralBins: Float32Array;
  processingMs: number;
}

/**
 * Sent straight to downstream workers (biomarker, formant) over MessagePorts,
 * never via the main thread. `hop` carries only the samples that entered the
 * window since the last packet, so each downstream ring reconstructs a
 * gapless, non-overlapping stream. Every port receives its own copy.
 */
export interface CyclePacket {
  timestamp: number;
  pitchHz: number;
  pitchConfidence: number;
  voiced: boolean;
  rms: number;
  sampleRate: number;
  hopSize: number;
  hop: Float32Array;
}

export type CyclePortMessage = { type: 'recycle'; buffer: ArrayBuffer };

/**
 * Per-frame spectrum for spectral consumers (trigger.worker.ts), also sent
 * worker-to-worker. `bins` is a pooled copy, returned with a `recycle`.
 */
export interface SpectralPacket {
  timestamp: number;
  rms: number;
  volumeDb: number;
  voiced: boolean;
  pitchHz: number;
  bins: Float32Array;
}

export type SpectralPortMessage = { type: 'recycle'; buffer: ArrayBuffer };

export type AudioWorkerRequest =
  | { type: 'init'; config?: Partial<AudioWorkerConfig> }
  | { type: 'process'; buffer: ArrayBuffer; length?: number }
  | { type: 'recycle'; buffers: ArrayBuffer[] }
  | { type: 'connect'; port: MessagePort }
  | { type: 'connectSpectral'; port: MessagePort }
  | { type: 'reset' }
  | { type: 'close' };

export type AudioWorkerResponse =
  | { type: 'ready'; config: AudioWorkerConfig }
  | { type: 'analysis'; frames: AudioAnalysisFrame[]; buffer: ArrayBuffer }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}

const ctx = self as unknown as WorkerScope;

const DEFAULT_CONFIG: AudioWorkerConfig = {
  sampleRate: 16000,
  frameSize: 1024,
  hopSize: 160,
  spectralBinCount: 128,
  minPitchHz: 60,
  maxPitchHz: 1000,
  yinThreshold: 0.12,
  unvoicedCmnd: 0.5,
  silenceFloorDb: -60,
  inputFormat: 'f32',
  epochMs: 0,
};

const SILENT_DB = -120;
const MAX_POOLED_BUFFERS = 8;

class FFT {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, received ${size}`);
    }
    this.size = size;

    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) {
        if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      }
      this.reverse[i] = r;
    }
  }

  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.size;
    const rev = this.reverse;

    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let swap = re[i];
        re[i] = re[j];
        re[j] = swap;
        swap = im[i];
        im[i] = im[j];
        im[j] = swap;
      }
    }

    const sign = inverse ? -1 : 1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let base = 0; base < n; base += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cosTable[k];
          const wi = sign * this.sinTable[k];
          const a = base + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }

    if (inverse) {
      const scale = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= scale;
        im[i] *= scale;
      }
    }
  }
}

class AudioAnalyzer {
  private config: AudioWorkerConfig;

  private ring!: Float64Array;
  /** Pre-DC-blocker samples: the filter's memory spans ~1.6 glottal cycles and
   *  would compress the cycle-to-cycle amplitude variation shimmer measures. */
  private rawRing!: Float64Array;
  private writeIndex = 0;
  private samplesWritten = 0;
  private sinceLastFrame = 0;

  private window!: Float64Array;
  private hann!: Float64Array;

  private spectrumFft!: FFT;
  private specRe!: Float64Array;
  private specIm!: Float64Array;
  private specScale = 0;
  private binGroup = 1;

  private corrFft!: FFT;
  private corrRe!: Float64Array;
  private corrIm!: Float64Array;
  private padRe!: Float64Array;
  private padIm!: Float64Array;
  private cmnd!: Float64Array;

  private yinWindow = 0;
  private tauMin = 0;
  private tauMax = 0;

  private dcLastInput = 0;
  private dcLastOutput = 0;

  private readonly binPool: Float32Array[] = [];
  private readonly hopPool: Float32Array[] = [];
  private readonly ports: MessagePort[] = [];
  private readonly spectralPorts: MessagePort[] = [];

  constructor(config: Partial<AudioWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.allocate();
  }

  get currentConfig(): AudioWorkerConfig {
    return { ...this.config };
  }

  private allocate(): void {
    const {
      sampleRate,
      frameSize,
      hopSize,
      spectralBinCount,
      minPitchHz,
      maxPitchHz,
    } = this.config;

    if (frameSize < 64 || (frameSize & (frameSize - 1)) !== 0) {
      throw new Error(`frameSize must be a power of two >= 64, received ${frameSize}`);
    }
    if (hopSize < 1 || hopSize > frameSize) {
      throw new Error(`hopSize must be within 1..${frameSize}, received ${hopSize}`);
    }
    if (minPitchHz <= 0 || maxPitchHz <= minPitchHz) {
      throw new Error('Pitch range requires 0 < minPitchHz < maxPitchHz');
    }

    this.ring = new Float64Array(frameSize);
    this.rawRing = new Float64Array(frameSize);
    this.window = new Float64Array(frameSize);

    this.hann = new Float64Array(frameSize);
    let windowEnergy = 0;
    for (let i = 0; i < frameSize; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize);
      windowEnergy += this.hann[i] * this.hann[i];
    }

    this.spectrumFft = new FFT(frameSize);
    this.specRe = new Float64Array(frameSize);
    this.specIm = new Float64Array(frameSize);
    // Parseval scaling, so the one-sided bins sum to the frame's mean square.
    this.specScale = 1 / (frameSize * windowEnergy);
    this.binGroup = Math.max(1, Math.floor(frameSize / 2 / spectralBinCount));

    // Longest lag searched sets the YIN sub-window: both must fit the frame.
    this.tauMax = Math.min(frameSize >> 1, Math.floor(sampleRate / minPitchHz));
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxPitchHz));
    if (this.tauMin >= this.tauMax) {
      throw new Error('Pitch range is too narrow for the configured frameSize');
    }
    this.yinWindow = frameSize - this.tauMax;

    let corrSize = 2;
    while (corrSize < this.yinWindow + frameSize) corrSize <<= 1;
    this.corrFft = new FFT(corrSize);
    this.corrRe = new Float64Array(corrSize);
    this.corrIm = new Float64Array(corrSize);
    this.padRe = new Float64Array(corrSize);
    this.padIm = new Float64Array(corrSize);
    this.cmnd = new Float64Array(this.tauMax + 1);

    this.reset();
  }

  reset(): void {
    this.ring.fill(0);
    this.rawRing.fill(0);
    this.writeIndex = 0;
    this.samplesWritten = 0;
    this.sinceLastFrame = 0;
    this.dcLastInput = 0;
    this.dcLastOutput = 0;
  }

  releaseBins(buffer: ArrayBuffer): void {
    if (
      this.binPool.length < MAX_POOLED_BUFFERS &&
      buffer.byteLength === this.config.spectralBinCount * 4
    ) {
      this.binPool.push(new Float32Array(buffer));
    }
  }

  private takeBins(): Float32Array {
    const pooled = this.binPool.pop();
    if (pooled) {
      pooled.fill(0);
      return pooled;
    }
    return new Float32Array(this.config.spectralBinCount);
  }

  connect(port: MessagePort): void {
    this.ports.push(port);
    port.onmessage = (event: MessageEvent<CyclePortMessage>) => {
      const message = event.data;
      if (
        message?.type === 'recycle' &&
        this.hopPool.length < MAX_POOLED_BUFFERS &&
        message.buffer.byteLength === this.config.hopSize * 4
      ) {
        this.hopPool.push(new Float32Array(message.buffer));
      }
    };
  }

  connectSpectral(port: MessagePort): void {
    this.spectralPorts.push(port);
    port.onmessage = (event: MessageEvent<SpectralPortMessage>) => {
      const message = event.data;
      if (message?.type === 'recycle') this.releaseBins(message.buffer);
    };
  }

  disconnect(): void {
    for (const port of this.ports) port.close();
    this.ports.length = 0;
    for (const port of this.spectralPorts) port.close();
    this.spectralPorts.length = 0;
  }

  private emitSpectral(frame: AudioAnalysisFrame): void {
    for (const port of this.spectralPorts) {
      const bins = this.takeBins();
      bins.set(frame.spectralBins);
      const packet: SpectralPacket = {
        timestamp: frame.timestamp,
        rms: frame.rms,
        volumeDb: frame.volumeDb,
        voiced: frame.voiced,
        pitchHz: frame.pitchHz,
        bins,
      };
      port.postMessage(packet, [bins.buffer as ArrayBuffer]);
    }
  }

  private emitCyclePacket(frame: AudioAnalysisFrame): void {
    if (this.ports.length === 0) return;

    const { frameSize, hopSize, sampleRate } = this.config;
    // The newest hopSize samples end at writeIndex, so consecutive packets are
    // contiguous and never overlap.
    const from = (this.writeIndex - hopSize + frameSize) % frameSize;
    const head = frameSize - from;

    for (const port of this.ports) {
      const hop = this.hopPool.pop() ?? new Float32Array(hopSize);
      if (head >= hopSize) {
        hop.set(this.rawRing.subarray(from, from + hopSize));
      } else {
        hop.set(this.rawRing.subarray(from), 0);
        hop.set(this.rawRing.subarray(0, hopSize - head), head);
      }

      const packet: CyclePacket = {
        timestamp: frame.timestamp,
        pitchHz: frame.pitchHz,
        pitchConfidence: frame.pitchConfidence,
        voiced: frame.voiced,
        rms: frame.rms,
        sampleRate,
        hopSize,
        hop,
      };
      port.postMessage(packet, [hop.buffer as ArrayBuffer]);
    }
  }

  /** Streams a chunk in and returns every frame whose hop boundary it completed. */
  push(samples: Float32Array | Int16Array): AudioAnalysisFrame[] {
    const frames: AudioAnalysisFrame[] = [];
    const { frameSize, hopSize } = this.config;
    const scale = samples instanceof Int16Array ? 1 / 32768 : 1;

    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(hopSize - this.sinceLastFrame, samples.length - offset);

      for (let i = 0; i < take; i++) {
        const input = samples[offset + i] * scale;
        // One-pole DC blocker: a static offset would wreck ZCR and inflate RMS.
        const output = input - this.dcLastInput + 0.995 * this.dcLastOutput;
        this.dcLastInput = input;
        this.dcLastOutput = output;
        this.ring[this.writeIndex] = output;
        this.rawRing[this.writeIndex] = input;
        this.writeIndex = (this.writeIndex + 1) % frameSize;
      }

      offset += take;
      this.sinceLastFrame += take;
      this.samplesWritten += take;

      if (this.sinceLastFrame === hopSize) {
        this.sinceLastFrame = 0;
        if (this.samplesWritten >= frameSize) {
          const frame = this.analyze();
          this.emitCyclePacket(frame);
          this.emitSpectral(frame);
          frames.push(frame);
        }
      }
    }

    return frames;
  }

  private analyze(): AudioAnalysisFrame {
    const started = performance.now();
    const { frameSize, sampleRate, epochMs, silenceFloorDb } = this.config;

    const head = frameSize - this.writeIndex;
    this.window.set(this.ring.subarray(this.writeIndex), 0);
    this.window.set(this.ring.subarray(0, this.writeIndex), head);

    let sumSquares = 0;
    let crossings = 0;
    let previous = this.window[0];
    for (let i = 1; i < frameSize; i++) {
      const sample = this.window[i];
      sumSquares += sample * sample;
      if ((sample >= 0) !== (previous >= 0)) crossings++;
      previous = sample;
    }
    sumSquares += this.window[0] * this.window[0];

    const rms = Math.sqrt(sumSquares / frameSize);
    const volumeDb = rms > 0 ? Math.max(SILENT_DB, 20 * Math.log10(rms)) : SILENT_DB;
    const zcr = crossings / (frameSize - 1);

    const spectralBins = this.computeSpectrum();

    let pitchHz = 0;
    let pitchConfidence = 0;
    let voiced = false;
    if (volumeDb >= silenceFloorDb) {
      const tau = this.detectPeriod();
      if (tau > 0) {
        pitchHz = sampleRate / tau;
        pitchConfidence = Math.min(1, Math.max(0, 1 - this.cmnd[Math.round(tau)]));
        voiced = true;
      }
    }

    return {
      timestamp: epochMs + (this.samplesWritten / sampleRate) * 1000,
      rms,
      volumeDb,
      zcr,
      pitchHz,
      pitchConfidence,
      voiced,
      spectralBins,
      processingMs: performance.now() - started,
    };
  }

  private computeSpectrum(): Float32Array {
    const { frameSize, spectralBinCount } = this.config;
    const re = this.specRe;
    const im = this.specIm;

    for (let i = 0; i < frameSize; i++) {
      re[i] = this.window[i] * this.hann[i];
      im[i] = 0;
    }
    this.spectrumFft.transform(re, im, false);

    const bins = this.takeBins();
    const usable = frameSize >> 1;
    const group = this.binGroup;
    const scale = this.specScale;

    for (let bin = 0; bin < spectralBinCount; bin++) {
      const start = bin * group;
      if (start >= usable) break;
      const end = Math.min(start + group, usable);
      let energy = 0;
      for (let k = start; k < end; k++) {
        const power = (re[k] * re[k] + im[k] * im[k]) * scale;
        energy += k > 0 ? power * 2 : power;
      }
      bins[bin] = energy;
    }

    return bins;
  }

  /** YIN period in samples with parabolic refinement, or 0 when unvoiced. */
  private detectPeriod(): number {
    const { frameSize, yinThreshold, unvoicedCmnd } = this.config;
    const W = this.yinWindow;
    const tauMin = this.tauMin;
    const tauMax = this.tauMax;
    const size = this.corrFft.size;

    const ar = this.corrRe;
    const ai = this.corrIm;
    const br = this.padRe;
    const bi = this.padIm;
    ar.fill(0);
    ai.fill(0);
    br.fill(0);
    bi.fill(0);

    for (let i = 0; i < W; i++) ar[i] = this.window[i];
    for (let i = 0; i < frameSize; i++) br[i] = this.window[i];

    this.corrFft.transform(ar, ai, false);
    this.corrFft.transform(br, bi, false);

    // conj(A) * B, inverted, yields r(tau) = sum_j x[j] * x[j + tau].
    for (let i = 0; i < size; i++) {
      const real = ar[i] * br[i] + ai[i] * bi[i];
      const imag = ar[i] * bi[i] - ai[i] * br[i];
      ar[i] = real;
      ai[i] = imag;
    }
    this.corrFft.transform(ar, ai, true);

    let power = 0;
    for (let j = 0; j < W; j++) power += this.window[j] * this.window[j];
    const headPower = power;

    const cmnd = this.cmnd;
    cmnd[0] = 1;
    let runningSum = 0;

    for (let tau = 1; tau <= tauMax; tau++) {
      const leaving = this.window[tau - 1];
      const entering = this.window[tau + W - 1];
      power += entering * entering - leaving * leaving;

      const difference = Math.max(0, headPower + power - 2 * ar[tau]);
      runningSum += difference;
      cmnd[tau] = runningSum > 0 ? (difference * tau) / runningSum : 1;
    }

    let chosen = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cmnd[tau] < yinThreshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        chosen = tau;
        break;
      }
    }

    if (chosen < 0) {
      let best = tauMin;
      for (let tau = tauMin + 1; tau < tauMax; tau++) {
        if (cmnd[tau] < cmnd[best]) best = tau;
      }
      if (cmnd[best] >= unvoicedCmnd) return 0;
      chosen = best;
    }

    if (chosen <= tauMin || chosen >= tauMax) return chosen;

    const prior = cmnd[chosen - 1];
    const centre = cmnd[chosen];
    const next = cmnd[chosen + 1];
    // Only a genuine local minimum has a vertex within half a sample; a
    // range-edge minimum would send the parabola off the end of the array.
    if (prior < centre || next < centre) return chosen;
    // Negative for a dip; zero only on a flat bottom.
    const denominator = 2 * (2 * centre - next - prior);
    if (denominator >= 0) return chosen;

    const delta = (next - prior) / denominator;
    return chosen + Math.max(-0.5, Math.min(0.5, delta));
  }
}

let analyzer: AudioAnalyzer | null = null;

function fail(message: string): void {
  const response: AudioWorkerResponse = { type: 'error', message };
  ctx.postMessage(response);
}

ctx.onmessage = (event: MessageEvent) => {
  const request = event.data as AudioWorkerRequest;

  try {
    switch (request.type) {
      case 'init': {
        analyzer = new AudioAnalyzer(request.config);
        const response: AudioWorkerResponse = {
          type: 'ready',
          config: analyzer.currentConfig,
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
        const config = analyzer.currentConfig;
        const bytesPerSample = config.inputFormat === 'i16' ? 2 : 4;
        const available = Math.floor(buffer.byteLength / bytesPerSample);
        const count = Math.min(length ?? available, available);

        const samples =
          config.inputFormat === 'i16'
            ? new Int16Array(buffer, 0, count)
            : new Float32Array(buffer, 0, count);

        const frames = analyzer.push(samples);

        const transfer: Transferable[] = [buffer];
        for (const frame of frames) transfer.push(frame.spectralBins.buffer);

        const response: AudioWorkerResponse = { type: 'analysis', frames, buffer };
        ctx.postMessage(response, transfer);
        break;
      }

      case 'recycle': {
        if (!analyzer) return;
        for (const buffer of request.buffers) analyzer.releaseBins(buffer);
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

      case 'connectSpectral': {
        if (!analyzer) {
          fail('Worker received a port before init');
          return;
        }
        analyzer.connectSpectral(request.port);
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
