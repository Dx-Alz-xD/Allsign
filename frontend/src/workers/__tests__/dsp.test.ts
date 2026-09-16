/**
 * DSP verification for the Laptop 2 audio stack: fluencyProcessor (DAF/FSF),
 * captureProcessor (48 kHz -> 16 kHz), audio/formant/biomarker/trigger
 * workers, and the served worklet copies.
 *
 *   npx vitest run src/workers/__tests__
 *
 * Signals are synthetic with known ground truth, so every assertion is a
 * calibration check rather than a snapshot.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_WORKLETS_DIR,
  WORKLETS_DIR,
  addNoise,
  bestLag,
  dominantFreq,
  impulseTrain,
  loadWorker,
  loadWorklet,
  makeChannel,
  median,
  rms,
  sine,
  synthVowel,
  tick,
  type FakePort,
} from './harness';

const SLOW = 120_000;
const QUANTUM = 128;
const HOP = 160;
const SR16 = 16000;

// ---------------------------------------------------------------------------
// fluencyProcessor.js (DAF + FSF)

describe('fluencyProcessor worklet', () => {
  const SR = 48000;

  function newProcessor(sampleRate = SR, processorOptions: Record<string, unknown> = {}) {
    const worklet = loadWorklet('fluencyProcessor.js', sampleRate);
    const Proc = worklet.registry['fluency-processor'];
    expect(Proc).toBeDefined();
    const proc = new Proc({ processorOptions });
    const descriptors = (Proc as unknown as { parameterDescriptors: Array<{ name: string; defaultValue: number }> })
      .parameterDescriptors;
    const params = (overrides: Record<string, number> = {}) => {
      const p: Record<string, Float32Array> = {};
      for (const d of descriptors) p[d.name] = new Float32Array([overrides[d.name] ?? d.defaultValue]);
      return p;
    };
    const run = (input: Float32Array, p: Record<string, Float32Array> | ((offset: number) => Record<string, Float32Array>), channels = 1) => {
      const out = new Float32Array(input.length);
      for (let off = 0; off < input.length; off += QUANTUM) {
        const outCh: Float32Array[] = [];
        for (let c = 0; c < channels; c++) outCh.push(new Float32Array(QUANTUM));
        const keep = proc.process([[input.subarray(off, off + QUANTUM)]], [outCh], typeof p === 'function' ? p(off) : p);
        if (!keep) throw new Error('process() returned false');
        out.set(outCh[0], off);
        for (let c = 1; c < channels; c++) {
          for (let i = 0; i < QUANTUM; i++) if (outCh[c][i] !== outCh[0][i]) throw new Error('output channels differ');
        }
      }
      return out;
    };
    return { proc, params, run, posted: worklet.posted, descriptors };
  }

  it('posts a ready message with a 1024-sample vocoder latency at 48 kHz', () => {
    const { posted, descriptors } = newProcessor();
    const ready = posted.find((m) => (m as { type: string }).type === 'ready') as Record<string, number>;
    expect(ready.fftFrameSize).toBe(1024);
    expect(ready.fsfLatencySamples).toBe(1024);
    expect(descriptors.map((d) => d.name)).toEqual(['dafDelayMs', 'dafMix', 'fsfOctaveShift', 'fsfMix', 'outputGain', 'bypass']);
  });

  it.each([30, 60, 100, 150])('DAF %i ms is the total delay heard', (ms) => {
    const { params, run } = newProcessor();
    const inp = impulseTrain(SR, 1.0, 10000);
    const out = run(inp, params({ dafDelayMs: ms }), 2);
    const expected = Math.round((ms / 1000) * SR);
    expect(Math.abs(bestLag(inp, out, 8000, 10000) - expected)).toBeLessThanOrEqual(1);
  });

  it('dafMix = 0 leaves only the vocoder latency', () => {
    const { params, run } = newProcessor();
    const inp = impulseTrain(SR, 0.5, 4000);
    const out = run(inp, params({ dafMix: 0 }));
    expect(bestLag(inp, out, 2000, 4000)).toBe(1024);
  });

  it('bypass is the identity', () => {
    const { params, run } = newProcessor();
    const inp = sine(SR, 440, 0.2);
    const out = run(inp, params({ bypass: 1 }));
    let maxErr = 0;
    for (let i = 0; i < inp.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - inp[i]));
    expect(maxErr).toBe(0);
  });

  it.each([
    [0.5, 220],
    [-0.5, 440],
    [0.25, 300],
  ])('FSF shifts by %f octaves', (octave, f0) => {
    const { params, run } = newProcessor();
    const inp = sine(SR, f0, 1.5);
    const out = run(inp, params({ fsfOctaveShift: octave, dafMix: 0 }));
    const expected = f0 * Math.pow(2, octave);
    const measured = dominantFreq(out, SR, SR * 0.5);
    const level = rms(out, SR * 0.5) / rms(inp, SR * 0.5);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.02);
    expect(level).toBeGreaterThan(0.7);
    expect(level).toBeLessThan(1.3);
  });

  it('overlap-add gain is unity when the vocoder is engaged', () => {
    const { params, run } = newProcessor();
    const inp = sine(SR, 440, 1.0);
    const out = run(inp, params({ fsfOctaveShift: 0.01, dafMix: 0 }));
    expect(Math.abs(rms(out, SR * 0.4) / rms(inp, SR * 0.4) - 1)).toBeLessThan(0.1);
  });

  it('wet and dry paths are sample-aligned at ratio 1', () => {
    const { proc } = newProcessor();
    const v = proc.vocoder as { process: (i: Float32Array, d: Float32Array, w: Float32Array, r: number, a: boolean) => void; latency: number };
    const inp = sine(SR, 230, 1.0, 0.5);
    const dry = new Float32Array(inp.length);
    const wet = new Float32Array(inp.length);
    for (let off = 0; off < inp.length; off += QUANTUM) {
      v.process(inp.subarray(off, off + QUANTUM), dry.subarray(off, off + QUANTUM), wet.subarray(off, off + QUANTUM), 1.0, true);
    }
    let dryErr = 0;
    for (let i = v.latency; i < inp.length; i++) dryErr = Math.max(dryErr, Math.abs(dry[i] - inp[i - v.latency]));
    expect(dryErr).toBe(0);
    let err = 0;
    for (let i = SR * 0.5; i < inp.length; i++) err = Math.max(err, Math.abs(wet[i] - dry[i]));
    expect(err).toBeLessThan(1e-3);
  });

  it('total delay is unchanged when FSF toggles on (tone-burst envelope)', () => {
    const { params, run } = newProcessor();
    const n = Math.floor((2.0 * SR) / QUANTUM) * QUANTUM;
    const inp = new Float32Array(n);
    for (let i = 0; i < n; i++) inp[i] = (i % 9600 < 4800 ? 0.5 : 0) * Math.sin((2 * Math.PI * 230 * i) / SR);
    const out = run(inp, (off) => params({ dafDelayMs: 100, fsfOctaveShift: off > SR ? 0.3 : 0 }));
    const env = (x: Float32Array) => {
      const e = new Float32Array(x.length);
      let a = 0;
      for (let i = 0; i < x.length; i++) {
        a += (Math.abs(x[i]) - a) * 0.02;
        e[i] = a;
      }
      return e;
    };
    const ei = env(inp);
    const eo = env(out);
    const lagOf = (from: number, to: number) => {
      let b = 0;
      let bs = -Infinity;
      for (let lag = 4000; lag <= 5600; lag++) {
        let sc = 0;
        for (let i = from; i < to - 5600; i++) sc += (ei[i] - 0.15) * (eo[i + lag] - 0.15);
        if (sc > bs) {
          bs = sc;
          b = lag;
        }
      }
      return b;
    };
    const expected = Math.round(0.1 * SR);
    expect(Math.abs(lagOf(8000, SR) - expected)).toBeLessThan(100);
    expect(Math.abs(lagOf(SR * 1.2, n) - expected)).toBeLessThan(300);
  });

  it('engaging FSF mid-stream has no dropout and lands on the shifted pitch', () => {
    const { params, run } = newProcessor();
    const inp = sine(SR, 230, 1.0, 0.5);
    const out = run(inp, (off) => params({ dafMix: 0, fsfOctaveShift: off >= SR * 0.5 ? 0.5 : 0 }));
    let minEnvelope = Infinity;
    for (let start = SR * 0.5; start + 480 <= out.length; start += 240) {
      let peak = 0;
      for (let i = start; i < start + 480; i++) peak = Math.max(peak, Math.abs(out[i]));
      minEnvelope = Math.min(minEnvelope, peak);
    }
    expect(minEnvelope).toBeGreaterThan(0.25);
    expect(Math.abs(dominantFreq(out, SR, SR * 0.8) - 325.3)).toBeLessThan(7);
  });

  it('delay changes crossfade without a click', () => {
    const { params, run } = newProcessor();
    const inp = sine(SR, 200, 1.0);
    const out = run(inp, (off) => params({ dafDelayMs: off > SR * 0.5 ? 150 : 30 }));
    let maxStep = 0;
    for (let i = SR * 0.4; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
    const nominal = (0.5 * 2 * Math.PI * 200) / SR;
    expect(maxStep).toBeLessThan(nominal * 1.2);
  });

  it('picks a 512 frame at 16 kHz (32 ms latency)', () => {
    const { posted } = newProcessor(16000);
    const ready = posted[posted.length - 1] as Record<string, number>;
    expect(ready.fftFrameSize).toBe(512);
    expect(ready.fsfLatencyMs).toBeCloseTo(32, 2);
  });

  it('answers getInfo on the port and ignores garbage', () => {
    const { proc, posted } = newProcessor();
    const before = posted.length;
    proc.port.onmessage?.({ data: { type: 'getInfo' } });
    proc.port.onmessage?.({ data: { type: 'reset' } });
    proc.port.onmessage?.({ data: 'garbage' });
    expect(posted.length).toBe(before + 1);
    expect((posted[before] as { type: string }).type).toBe('info');
  });

  it('runs well under real time', () => {
    const { params, run } = newProcessor();
    const inp = sine(SR, 180, 10);
    const t0 = performance.now();
    run(inp, params({ fsfOctaveShift: 0.4 }), 2);
    // Vitest's sandbox is several times slower than a real worklet thread;
    // 10 s of audio still has to clear in well under real time.
    expect(performance.now() - t0).toBeLessThan(5000);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// captureProcessor.js (native rate -> 16 kHz)

describe('captureProcessor worklet', () => {
  function newCapture(sampleRate: number, processorOptions: Record<string, unknown> = {}) {
    const worklet = loadWorklet('captureProcessor.js', sampleRate);
    const Proc = worklet.registry['capture-processor'];
    expect(Proc).toBeDefined();
    const proc = new Proc({ processorOptions });
    const chunks: Array<{ buffer: ArrayBuffer; length: number; sampleRate: number }> = [];
    proc.port.postMessage = (message: unknown) => {
      const m = message as { type: string; buffer: ArrayBuffer; length: number; sampleRate: number };
      if (m.type === 'pcm') chunks.push(m);
      else worklet.posted.push(message);
    };
    const feed = (input: Float32Array) => {
      for (let off = 0; off + QUANTUM <= input.length; off += QUANTUM) {
        if (!proc.process([[input.subarray(off, off + QUANTUM)]], [[new Float32Array(QUANTUM)]], {})) {
          throw new Error('process() returned false');
        }
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        out.set(new Float32Array(c.buffer, 0, c.length), at);
        at += c.length;
      }
      return out;
    };
    return { proc, chunks, feed, posted: worklet.posted };
  }

  it('reports an exact 3:1 ratio and an odd FIR at 48 kHz', () => {
    const { posted } = newCapture(48000);
    const ready = posted.find((m) => (m as { type: string }).type === 'ready') as Record<string, number>;
    expect(ready.ratio).toBe(3);
    expect(ready.outputRate).toBe(16000);
    expect(ready.chunkSize).toBe(160);
    expect(ready.taps % 2).toBe(1);
    expect(ready.taps).toBeGreaterThanOrEqual(31);
    expect(ready.latencyMs).toBeLessThan(15);
  });

  it('emits 160-sample chunks at 16 kHz and preserves a passband tone', () => {
    const { chunks, feed } = newCapture(48000);
    const out = feed(sine(48000, 1000, 1.0, 0.5));
    expect(chunks.every((c) => c.length === 160 && c.sampleRate === 16000)).toBe(true);
    expect(Math.abs(out.length - 16000)).toBeLessThan(200);
    expect(Math.abs(dominantFreq(out, 16000, 2000) - 1000)).toBeLessThan(5);
    expect(rms(out, 2000) / (0.5 / Math.SQRT2)).toBeCloseTo(1, 1);
  });

  it.each([10000, 12000, 20000])('attenuates a %i Hz tone above the new Nyquist by > 40 dB', (freq) => {
    const { feed } = newCapture(48000);
    const out = feed(sine(48000, freq, 1.0, 0.5));
    const attenuationDb = 20 * Math.log10(rms(out, 2000) / (0.5 / Math.SQRT2));
    expect(attenuationDb).toBeLessThan(-40);
  });

  it('resamples a 44.1 kHz context to 16 kHz as well', () => {
    const { feed, posted } = newCapture(44100);
    const ready = posted.find((m) => (m as { type: string }).type === 'ready') as Record<string, number>;
    expect(ready.ratio).toBeCloseTo(2.75625, 5);
    const out = feed(sine(44100, 1000, 1.0, 0.5));
    expect(Math.abs(out.length - 16000)).toBeLessThan(200);
    expect(Math.abs(dominantFreq(out, 16000, 2000) - 1000)).toBeLessThan(5);
  });

  it('passes a 16 kHz context straight through', () => {
    const { feed } = newCapture(16000);
    const inp = sine(16000, 300, 0.5, 0.4);
    const out = feed(inp);
    let maxErr = 0;
    for (let i = 0; i < out.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - inp[i]));
    expect(out.length).toBeGreaterThan(0);
    expect(maxErr).toBe(0);
  });

  it('is continuous across chunk boundaries', () => {
    const { feed } = newCapture(48000);
    const out = feed(sine(48000, 100, 0.5, 0.5));
    const nominal = (0.5 * 2 * Math.PI * 100) / 16000;
    let maxStep = 0;
    for (let i = 500; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
    expect(maxStep).toBeLessThan(nominal * 1.2);
  });

  it('reuses recycled chunk buffers', () => {
    const { proc, chunks, feed } = newCapture(48000);
    feed(sine(48000, 500, 0.1));
    const recycled = chunks[0].buffer;
    proc.port.onmessage?.({ data: { type: 'recycle', buffer: recycled } });
    const before = chunks.length;
    feed(sine(48000, 500, 0.1));
    // The chunk being filled was allocated while the pool was empty; the
    // recycled buffer is picked up for the one after it.
    expect(chunks[before + 1].buffer).toBe(recycled);
  });
});

// ---------------------------------------------------------------------------
// formant.worker.ts

describe('formant.worker', () => {
  const BW = [70, 90, 120, 180, 220];
  const TARGETS: Record<string, [number, number, number]> = {
    'ɑ': [768, 1333, 2522],
    i: [342, 2322, 3000],
    u: [378, 997, 2343],
    'ɛ': [580, 1799, 2605],
    'æ': [588, 1952, 2601],
    'ɝ': [474, 1379, 1710],
  };

  type Frame = {
    voiced: boolean;
    f1: number;
    raw: { f1: number; f2: number; f3: number };
    timestamp: number;
    accuracy: number;
    nearest: { symbol: string; accuracy: number } | null;
    plane: { x: number; y: number };
    scores: number[];
    processingMs: number;
  };
  type Geometry = {
    quadSlant: number;
    corners: number[][];
    vowels: Array<{ symbol: string; plane: { x: number; y: number } }>;
  };

  function newWorker(config: Record<string, unknown> = { profile: 'male' }) {
    const worker = loadWorker('formant.worker.ts');
    worker.send({ type: 'init', config });
    const ready = worker.drain()[0] as { type: string; config: Record<string, number>; geometry: Geometry };
    const feed = (pcm: Float32Array): Frame[] => {
      const frames: Frame[] = [];
      for (let off = 0; off + HOP <= pcm.length; off += HOP) {
        const buffer = new ArrayBuffer(HOP * 4);
        new Float32Array(buffer).set(pcm.subarray(off, off + HOP));
        worker.send({ type: 'process', buffer, length: HOP });
        for (const m of worker.drain() as Array<{ type: string; message?: string; frames?: Frame[] }>) {
          if (m.type === 'error') throw new Error(m.message);
          if (m.type === 'formants') frames.push(...(m.frames as Frame[]));
        }
      }
      return frames;
    };
    return { worker, ready, feed };
  }

  it('is ready with the 12-vowel geometry', () => {
    const { ready } = newWorker();
    expect(ready.type).toBe('ready');
    expect(ready.config.frameRate).toBe(30);
    expect(ready.geometry.vowels.map((v) => v.symbol).join('')).toBe('iɪeɛæɑɔoʊuʌɝ');
    expect(ready.geometry.corners).toHaveLength(4);
  });

  for (const [symbol, [F1, F2, F3]] of Object.entries(TARGETS)) {
    it(`recovers F1-F3 of /${symbol}/ within a few percent`, () => {
      const { feed } = newWorker();
      const pcm = synthVowel({ sampleRate: SR16, seconds: 1.0, f0: 118, formants: [F1, F2, F3, 3500, 4500], bandwidths: BW, noise: 0.002 });
      const voiced = feed(pcm).filter((f) => f.voiced && f.raw.f1 > 0);
      expect(voiced.length).toBeGreaterThanOrEqual(25);
      expect(Math.abs(median(voiced.map((f) => f.raw.f1)) - F1) / F1).toBeLessThan(0.06);
      expect(Math.abs(median(voiced.map((f) => f.raw.f2)) - F2) / F2).toBeLessThan(0.06);
      expect(Math.abs(median(voiced.map((f) => f.raw.f3)) - F3) / F3).toBeLessThan(0.08);
    });

    it(`scores /${symbol}/ high against its own target and names it nearest`, () => {
      const { worker, feed } = newWorker();
      worker.send({ type: 'setTarget', symbol });
      const pcm = synthVowel({ sampleRate: SR16, seconds: 1.0, f0: 118, formants: [F1, F2, F3, 3500, 4500], bandwidths: BW, noise: 0.002 });
      const frames = feed(pcm);
      const last = frames[frames.length - 1];
      expect(last.accuracy).toBeGreaterThan(80);
      expect(last.nearest?.symbol).toBe(symbol);
    });
  }

  it('emits 30 evenly spaced frames per second', () => {
    const { feed } = newWorker();
    const frames = feed(synthVowel({ sampleRate: SR16, seconds: 3.0, f0: 130, formants: [600, 1400, 2500, 3500, 4500], bandwidths: BW }));
    expect(Math.abs(frames.length / 3 - 30)).toBeLessThan(0.5);
    const dts: number[] = [];
    for (let i = 1; i < frames.length; i++) dts.push(frames[i].timestamp - frames[i - 1].timestamp);
    expect(Math.max(...dts) - Math.min(...dts)).toBeLessThan(12);
  });

  it('orients the vowel plane: /i/ front-close, /u/ back-close, /ɑ/ open', () => {
    const { ready } = newWorker();
    const at = (s: string) => ready.geometry.vowels.find((v) => v.symbol === s)!.plane;
    const i = at('i');
    const u = at('u');
    const a = at('ɑ');
    expect(i.x).toBeLessThan(0.25);
    expect(i.y).toBeLessThan(0.3);
    expect(u.x).toBeGreaterThan(0.7);
    expect(u.y).toBeLessThan(0.35);
    expect(a.y).toBeGreaterThan(0.7);
    expect(a.x).toBeGreaterThan(i.x);
  });

  it('describes the IPA trapezoid corners', () => {
    const { ready } = newWorker();
    const c = ready.geometry.corners;
    expect(c[0]).toEqual([0, 0]);
    expect(c[2]).toEqual([1, 1]);
    expect(c[3][0]).toBe(ready.geometry.quadSlant);
  });

  it('scores the wrong vowel low against the target', () => {
    const { worker, feed } = newWorker();
    worker.send({ type: 'setTarget', symbol: 'ɑ' });
    const frames = feed(synthVowel({ sampleRate: SR16, seconds: 0.8, f0: 118, formants: [342, 2322, 3000, 3500, 4500], bandwidths: BW }));
    const last = frames[frames.length - 1];
    expect(last.accuracy).toBeLessThan(25);
    expect(last.nearest?.symbol).toBe('i');
  });

  it('reports silence as unvoiced with no formants', () => {
    const { feed } = newWorker();
    const frames = feed(new Float32Array(SR16));
    expect(frames.length).toBeGreaterThanOrEqual(28);
    expect(frames.some((f) => f.voiced)).toBe(false);
    expect(frames[frames.length - 1].f1).toBe(0);
  });

  it('switches profile and accepts custom targets, rejects unknown targets', () => {
    const { worker } = newWorker();
    worker.send({ type: 'setProfile', profile: 'female' });
    const g = worker.drain().find((m) => (m as { type: string }).type === 'geometry') as { geometry: Geometry };
    expect(g.geometry.vowels[0].symbol).toBe('i');
    worker.send({ type: 'setTargets', targets: [{ symbol: 'a', label: 'custom', f1: 700, f2: 1200, f3: 2500 }] });
    const g2 = worker.drain().find((m) => (m as { type: string }).type === 'geometry') as { geometry: Geometry };
    expect(g2.geometry.vowels).toHaveLength(1);
    worker.send({ type: 'setTarget', symbol: 'zzz' });
    const err = worker.drain().find((m) => (m as { type: string }).type === 'error') as { message: string };
    expect(err.message).toMatch(/Unknown target/);
  });

  it('costs well under a millisecond per frame', () => {
    const { feed } = newWorker({});
    const pcm = synthVowel({ sampleRate: SR16, seconds: 10, f0: 110, formants: [500, 1500, 2500, 3500, 4500], bandwidths: BW, noise: 0.01 });
    const t0 = performance.now();
    const frames = feed(pcm);
    expect(performance.now() - t0).toBeLessThan(2500);
    expect(frames.reduce((s, f) => s + f.processingMs, 0) / frames.length).toBeLessThan(1);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// audio.worker.ts -> biomarker.worker.ts

describe('biomarker.worker (via audio.worker)', () => {
  const F = [600, 1300, 2500, 3500, 4500];
  const BW = [70, 90, 120, 180, 220];

  type Payload = {
    measured: boolean;
    jitterPercent: number;
    shimmerDb: number;
    hnrDb: number;
    vocalStrainIndex: number;
    strainSmoothed: number;
    strainLevel: string;
    fatigueWarning: boolean;
    sustainedSeconds: number;
    trendPerMinute: number;
    phonationSeconds: number;
    timestamp: number;
  };

  function pipeline(biomarkerConfig: Record<string, unknown> = {}) {
    const audio = loadWorker('audio.worker.ts');
    const bio = loadWorker('biomarker.worker.ts');
    audio.send({ type: 'init', config: {} });
    bio.send({ type: 'init', config: biomarkerConfig });
    const ready = bio.drain()[0] as { type: string; config: Record<string, number> };
    const channel = makeChannel();
    audio.send({ type: 'connect', port: channel.port1 });
    bio.send({ type: 'connect', port: channel.port2 });
    audio.drain();
    const feed = (pcm: Float32Array): Payload[] => {
      const payloads: Payload[] = [];
      for (let off = 0; off + HOP <= pcm.length; off += HOP) {
        const buffer = new ArrayBuffer(HOP * 4);
        new Float32Array(buffer).set(pcm.subarray(off, off + HOP));
        audio.send({ type: 'process', buffer, length: HOP });
        for (const m of audio.drain() as Array<{ type: string; message?: string }>) if (m.type === 'error') throw new Error(m.message);
        for (const m of bio.drain() as Array<{ type: string; message?: string; payload?: Payload }>) {
          if (m.type === 'error') throw new Error(m.message);
          if (m.type === 'biomarkers') payloads.push(m.payload as Payload);
        }
      }
      return payloads;
    };
    return { ready, feed };
  }

  it('is ready with the MDVP-anchored config', () => {
    const { ready } = pipeline();
    expect(ready.type).toBe('ready');
    expect(ready.config.jitterPathologyPercent).toBe(1.04);
  });

  it('reads a clean steady voice as low jitter/shimmer, high HNR, low strain', () => {
    const { feed } = pipeline();
    const pcm = addNoise(synthVowel({ sampleRate: SR16, seconds: 3, f0: 120, formants: F, bandwidths: BW }), 40);
    const out = feed(pcm).filter((x) => x.measured);
    const last = out[out.length - 1];
    expect(median(out.map((x) => x.jitterPercent))).toBeLessThan(0.3);
    expect(median(out.map((x) => x.shimmerDb))).toBeLessThan(0.15);
    expect(median(out.map((x) => x.hnrDb))).toBeGreaterThan(25);
    expect(median(out.map((x) => x.vocalStrainIndex))).toBeLessThan(20);
    expect(last.strainLevel).toBe('normal');
    expect(last.fatigueWarning).toBe(false);
    expect(Math.abs(last.phonationSeconds - 3)).toBeLessThan(0.5);
  }, SLOW);

  it.each([0.01, 0.02])('jitter calibrates: period sigma %f -> ~1.13 sigma local jitter', (sigma) => {
    const { feed } = pipeline();
    const pcm = addNoise(synthVowel({ sampleRate: SR16, seconds: 4, f0: 120, formants: F, bandwidths: BW, jitter: sigma, seed: 3 }), 40);
    const j = median(feed(pcm).filter((x) => x.measured).map((x) => x.jitterPercent));
    const expected = sigma * 100 * 1.128;
    expect(Math.abs(j - expected)).toBeLessThan(expected * 0.35);
  }, SLOW);

  it('shimmer calibrates: amplitude sigma 5% -> 0.3..0.6 dB', () => {
    const { feed } = pipeline();
    const pcm = addNoise(synthVowel({ sampleRate: SR16, seconds: 4, f0: 120, formants: F, bandwidths: BW, shimmer: 0.05, seed: 5 }), 40);
    const sh = median(feed(pcm).filter((x) => x.measured).map((x) => x.shimmerDb));
    expect(sh).toBeGreaterThan(0.3);
    expect(sh).toBeLessThan(0.6);
  }, SLOW);

  it.each([20, 10, 5])('HNR tracks a %i dB SNR', (snr) => {
    const { feed } = pipeline();
    const pcm = addNoise(synthVowel({ sampleRate: SR16, seconds: 3, f0: 120, formants: F, bandwidths: BW }), snr);
    const h = median(feed(pcm).filter((x) => x.measured).map((x) => x.hnrDb));
    expect(Math.abs(h - snr)).toBeLessThan(3.5);
  }, SLOW);

  it('HNR is stable across f0 (window scales with the period)', () => {
    for (const f0 of [90, 200, 300]) {
      const { feed } = pipeline();
      const pcm = addNoise(synthVowel({ sampleRate: SR16, seconds: 3, f0, formants: F, bandwidths: BW }), 15);
      const h = median(feed(pcm).filter((x) => x.measured).map((x) => x.hnrDb));
      expect(Math.abs(h - 15)).toBeLessThan(4);
    }
  }, SLOW);

  it('walks the fatigue state machine: rough -> warning, silence holds, clean recovers', () => {
    const { feed } = pipeline();
    const rough = addNoise(synthVowel({ sampleRate: SR16, seconds: 8, f0: 120, formants: F, bandwidths: BW, jitter: 0.025, shimmer: 0.12, seed: 9 }), 6);
    const outRough = feed(rough);
    const lastRough = outRough[outRough.length - 1];
    const firstWarning = outRough.find((x) => x.strainLevel === 'warning');
    expect(lastRough.strainLevel).toBe('warning');
    expect(lastRough.fatigueWarning).toBe(true);
    expect(lastRough.strainSmoothed).toBeGreaterThan(55);
    expect(firstWarning && firstWarning.timestamp / 1000).toBeGreaterThan(2);

    const silent = feed(new Float32Array(SR16 * 2));
    expect(silent.length).toBeGreaterThan(0);
    expect(silent.every((x) => !x.measured)).toBe(true);
    const held = silent[silent.length - 1];
    expect(held.strainLevel).toBe('warning');
    expect(Math.abs(held.phonationSeconds - lastRough.phonationSeconds)).toBeLessThan(0.2);

    const clean = addNoise(synthVowel({ sampleRate: SR16, seconds: 10, f0: 120, formants: F, bandwidths: BW, seed: 11 }), 35);
    const outClean = feed(clean);
    const lastClean = outClean[outClean.length - 1];
    expect(lastClean.strainLevel).toBe('normal');
    expect(lastClean.fatigueWarning).toBe(false);
    expect(lastClean.strainSmoothed).toBeLessThan(30);
  }, SLOW);

  it('shows a rising trend on a gradually worsening voice', () => {
    const { feed } = pipeline();
    let last: Payload | null = null;
    for (let k = 0; k < 8; k++) {
      const chunk = addNoise(
        synthVowel({ sampleRate: SR16, seconds: 4, f0: 120, formants: F, bandwidths: BW, jitter: 0.003 + 0.002 * k, shimmer: 0.01 + 0.01 * k, seed: 20 + k }),
        30 - 2.5 * k,
      );
      const out = feed(chunk);
      if (out.length) last = out[out.length - 1];
    }
    expect(last?.trendPerMinute ?? 0).toBeGreaterThan(5);
  }, SLOW);

  it('runs the audio+biomarker chain well under real time', () => {
    const { feed } = pipeline();
    const pcm = addNoise(synthVowel({ sampleRate: SR16, seconds: 10, f0: 110, formants: F, bandwidths: BW, jitter: 0.005, shimmer: 0.03 }), 25);
    const t0 = performance.now();
    feed(pcm);
    expect(performance.now() - t0).toBeLessThan(2500);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// audio.worker.ts -> trigger.worker.ts

describe('trigger.worker (via audio.worker spectral port)', () => {
  const BW = [70, 90, 120, 180, 220];
  const humA = (seconds: number, seed = 1) =>
    addNoise(synthVowel({ sampleRate: SR16, seconds, f0: 150, formants: [300, 900, 2300, 3300, 4400], bandwidths: BW, seed }), 25, seed + 100);
  const humB = (seconds: number, seed = 1) =>
    addNoise(synthVowel({ sampleRate: SR16, seconds, f0: 250, formants: [350, 2300, 3000, 3600, 4500], bandwidths: BW, seed }), 25, seed + 200);

  type Match = { id: string; similarity: number; latencyMs: number; timestamp: number; mappedPhrase: string };
  type Msg = { type: string; message?: string; match?: Match; triggers?: unknown[]; profile?: { id: string; spectralFingerprint: number[] }; best?: { id: string; similarity: number } | null; frames?: number; needed?: number };

  async function pipeline(config: Record<string, unknown> = {}) {
    const audio = loadWorker('audio.worker.ts');
    const trigger = loadWorker('trigger.worker.ts');
    audio.send({ type: 'init', config: {} });
    trigger.send({ type: 'init', config });
    await tick();
    const ready = trigger.drain()[0] as { type: string; triggers: unknown[]; config: Record<string, number> };
    const channel = makeChannel();
    audio.send({ type: 'connectSpectral', port: channel.port1 });
    trigger.send({ type: 'connect', port: channel.port2 });
    audio.drain();
    const feed = (pcm: Float32Array): Msg[] => {
      const out: Msg[] = [];
      for (let off = 0; off + HOP <= pcm.length; off += HOP) {
        const buffer = new ArrayBuffer(HOP * 4);
        new Float32Array(buffer).set(pcm.subarray(off, off + HOP));
        audio.send({ type: 'process', buffer, length: HOP });
        for (const m of audio.drain() as Msg[]) if (m.type === 'error') throw new Error(m.message);
        out.push(...(trigger.drain() as Msg[]));
      }
      return out;
    };
    const enrolLive = async (id: string, pcm: Float32Array) => {
      trigger.send({ type: 'capture', request: { id, name: id, mappedPhrase: `phrase-${id}`, targetAction: 'DIRECT_PASTE' } });
      const during = feed(pcm);
      await tick();
      const after = trigger.drain() as Msg[];
      return [...during, ...after];
    };
    return { audio, trigger, ready, feed, enrolLive, port2: channel.port2 as FakePort };
  }

  it('starts with no triggers and the 0.85 default threshold', async () => {
    const { ready } = await pipeline();
    expect(ready.type).toBe('ready');
    expect(ready.triggers).toEqual([]);
    expect(ready.config.defaultThreshold).toBe(0.85);
  });

  it('enrols from live audio, then matches the same sound within 15 ms and respects the refractory period', async () => {
    const { feed, enrolLive, trigger } = await pipeline();
    const events = await enrolLive('hum-a', humA(0.6));
    expect(events.some((e) => e.type === 'captureProgress')).toBe(true);
    const enrolled = events.find((e) => e.type === 'enrolled');
    expect(enrolled?.profile?.id).toBe('hum-a');
    expect(enrolled?.profile?.spectralFingerprint).toHaveLength(128);
    expect((events.find((e) => e.type === 'triggers')?.triggers ?? []).length).toBe(1);

    const live = feed(humA(1.5, 2));
    const matches = live.filter((e) => e.type === 'match').map((e) => e.match!);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches.length).toBeLessThanOrEqual(4);
    for (const m of matches) {
      expect(m.id).toBe('hum-a');
      expect(m.similarity).toBeGreaterThanOrEqual(0.85);
      expect(m.latencyMs).toBeLessThan(15);
      expect(m.mappedPhrase).toBe('phrase-hum-a');
    }
    for (let i = 1; i < matches.length; i++) expect(matches[i].timestamp - matches[i - 1].timestamp).toBeGreaterThanOrEqual(500);
    trigger.send({ type: 'reset' });
  });

  it('does not fire on a different sound and reports its lower similarity', async () => {
    const { feed, enrolLive } = await pipeline();
    await enrolLive('hum-a', humA(0.6));
    // Let the 64 ms analysis window drain hum A before the other sound starts.
    feed(new Float32Array(SR16 * 0.3));
    const live = feed(humB(1.0, 3));
    expect(live.filter((e) => e.type === 'match')).toHaveLength(0);
    const scores = live.filter((e) => e.type === 'scores');
    expect(scores.length).toBeGreaterThan(0);
    expect(Math.max(...scores.map((s) => s.best?.similarity ?? 0))).toBeLessThan(0.85);
  });

  it('stays quiet on silence once the analysis window has drained', async () => {
    const { feed, enrolLive } = await pipeline();
    await enrolLive('hum-a', humA(0.6));
    feed(new Float32Array(SR16 * 0.3));
    const live = feed(new Float32Array(SR16 * 2));
    expect(live.filter((e) => e.type === 'match' || e.type === 'scores')).toHaveLength(0);
  });

  it('honours a raised threshold and removal', async () => {
    const { feed, enrolLive, trigger } = await pipeline();
    await enrolLive('hum-a', humA(0.6));
    trigger.send({ type: 'setThreshold', id: 'hum-a', threshold: 0.999 });
    await tick();
    trigger.drain();
    expect(feed(humA(1.0, 4)).filter((e) => e.type === 'match')).toHaveLength(0);

    trigger.send({ type: 'setThreshold', id: 'hum-a', threshold: 0.85 });
    await tick();
    trigger.drain();
    expect(feed(humA(1.0, 5)).filter((e) => e.type === 'match').length).toBeGreaterThan(0);

    trigger.send({ type: 'remove', id: 'hum-a' });
    await tick();
    const after = trigger.drain() as Msg[];
    expect(after.find((e) => e.type === 'triggers')?.triggers).toEqual([]);
    expect(feed(humA(1.0, 6)).filter((e) => e.type === 'match')).toHaveLength(0);
  });

  it('accepts pre-computed fingerprints and main-thread frames', async () => {
    const { trigger } = await pipeline({ smoothingFrames: 1 });
    const fingerprint = Array.from({ length: 128 }, (_, i) => Math.exp(-((i - 20) ** 2) / 50) + 0.3 * Math.exp(-((i - 60) ** 2) / 80) + 1e-4);
    trigger.send({ type: 'enroll', profile: { id: 'fp', name: 'fp', spectralFingerprint: fingerprint, mappedPhrase: 'hello', targetAction: 'TTS_SPOKEN', threshold: 0.9 } });
    await tick();
    expect((trigger.drain() as Msg[]).some((e) => e.type === 'enrolled')).toBe(true);
    trigger.send({ type: 'frame', bins: fingerprint, timestamp: 1000 });
    trigger.send({ type: 'frame', bins: fingerprint, timestamp: 1010 });
    const out = trigger.drain() as Msg[];
    const match = out.find((e) => e.type === 'match')?.match;
    expect(match?.id).toBe('fp');
    expect(match?.similarity).toBeCloseTo(1, 3);
  });

  it('times out a capture that never hears anything', async () => {
    const { feed, trigger } = await pipeline({ captureTimeoutMs: 1000 });
    trigger.send({ type: 'capture', request: { id: 'x', name: 'x', mappedPhrase: 'x', targetAction: 'OS_HOTKEY' } });
    trigger.drain();
    const out = feed(new Float32Array(SR16 * 2));
    expect(out.find((e) => e.type === 'error')?.message).toMatch(/timed out/);
  });

  it('recycles every spectral buffer back to audio.worker', async () => {
    const { feed, port2 } = await pipeline();
    let recycled = 0;
    const original = port2.postMessage;
    port2.postMessage = (message, transfer) => {
      if ((message as { type: string }).type === 'recycle') recycled++;
      original(message, transfer);
    };
    feed(humA(0.5));
    expect(recycled).toBeGreaterThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// Static copies served by Next.js / Electron

describe('public/worklets', () => {
  it('holds byte-identical copies of every src/worklets file', () => {
    const files = readdirSync(WORKLETS_DIR).filter((f) => f.endsWith('.js'));
    expect(files).toEqual(expect.arrayContaining(['captureProcessor.js', 'fluencyProcessor.js']));
    for (const file of files) {
      expect(readFileSync(join(PUBLIC_WORKLETS_DIR, file), 'utf8')).toBe(readFileSync(join(WORKLETS_DIR, file), 'utf8'));
    }
  });

  it('registers the processor names the main-thread helper expects', () => {
    const capture = loadWorklet('captureProcessor.js', 48000, PUBLIC_WORKLETS_DIR);
    const fluency = loadWorklet('fluencyProcessor.js', 48000, PUBLIC_WORKLETS_DIR);
    expect(Object.keys(capture.registry)).toEqual(['capture-processor']);
    expect(Object.keys(fluency.registry)).toEqual(['fluency-processor']);
  });
});

