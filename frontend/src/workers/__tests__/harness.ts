/**
 * Test harness for the DSP workers and worklets.
 *
 * Workers are transpiled from source with `typescript.transpileModule` and
 * run inside a `node:vm` sandbox with a fake `self`, so several instances can
 * coexist and talk over fake MessagePorts. Worklets get a fake
 * `AudioWorkletProcessor` global. Signals come from a small Klatt-style
 * synthesiser with controllable jitter, shimmer and noise.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

export const FRONTEND_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const WORKERS_DIR = fileURLToPath(new URL('..', import.meta.url));
export const WORKLETS_DIR = fileURLToPath(new URL('../../worklets', import.meta.url));
export const PUBLIC_WORKLETS_DIR = fileURLToPath(new URL('../../../public/worklets', import.meta.url));

export interface Posted {
  message: unknown;
  transfer: Transferable[] | undefined;
}

export interface WorkerHandle {
  sandbox: Record<string, unknown>;
  outbox: Posted[];
  send: (message: unknown, transfer?: Transferable[]) => void;
  drain: () => unknown[];
}

function stripModuleSyntax(source: string): string {
  return source
    .replace(/^export\s+(?=(function|class|const|let|var)\b)/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^import\s.*$/gm, '');
}

const SHARED_GLOBALS = {
  performance,
  console,
  Math,
  Number,
  Array,
  Object,
  String,
  Error,
  Map,
  Set,
  Promise,
  Infinity,
  NaN,
  Float32Array,
  Float64Array,
  Int16Array,
  Uint8Array,
  Uint32Array,
  ArrayBuffer,
  setTimeout,
  queueMicrotask,
};

/** Loads `src/workers/<file>` as an isolated worker instance. */
export function loadWorker(file: string, extraGlobals: Record<string, unknown> = {}): WorkerHandle {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const code = stripModuleSyntax(outputText);

  const outbox: Posted[] = [];
  const self = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (message: unknown, transfer?: Transferable[]) => outbox.push({ message, transfer }),
    close: () => undefined,
  };
  const sandbox: Record<string, unknown> = { self, ...SHARED_GLOBALS, ...extraGlobals };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });

  return {
    sandbox,
    outbox,
    send(message, transfer) {
      if (!self.onmessage) throw new Error(`${file} installed no onmessage handler`);
      self.onmessage({ data: message, ...(transfer ? { transfer } : {}) } as { data: unknown });
    },
    drain() {
      return outbox.splice(0, outbox.length).map((item) => item.message);
    },
  };
}

export interface WorkletHandle {
  registry: Record<string, new (options?: unknown) => AudioWorkletProcessorLike>;
  posted: unknown[];
  sandbox: Record<string, unknown>;
}

export interface AudioWorkletProcessorLike {
  port: { postMessage: (message: unknown, transfer?: Transferable[]) => void; onmessage: ((event: { data: unknown }) => void) | null };
  process: (inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) => boolean;
  [key: string]: unknown;
}

/** Loads a worklet file from `dir` with a fake AudioWorkletGlobalScope. */
export function loadWorklet(file: string, sampleRate: number, dir: string = WORKLETS_DIR): WorkletHandle {
  const source = readFileSync(new URL(file, `file://${dir.replace(/\\/g, '/')}/`), 'utf8');
  const registry: WorkletHandle['registry'] = {};
  const posted: unknown[] = [];

  class AudioWorkletProcessor {
    port = { postMessage: (message: unknown) => posted.push(message), onmessage: null };
  }

  const sandbox: Record<string, unknown> = {
    AudioWorkletProcessor,
    registerProcessor: (name: string, cls: WorkletHandle['registry'][string]) => {
      registry[name] = cls;
    },
    sampleRate,
    currentTime: 0,
    ...SHARED_GLOBALS,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: file });
  return { registry, posted, sandbox };
}

export interface FakePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  close: () => void;
  closed: boolean;
}

/** Synchronous MessagePort pair for worker-to-worker links. */
export function makeChannel(): { port1: FakePort; port2: FakePort } {
  const a = { onmessage: null, closed: false } as FakePort;
  const b = { onmessage: null, closed: false } as FakePort;
  a.postMessage = (message) => b.onmessage?.({ data: message });
  b.postMessage = (message) => a.onmessage?.({ data: message });
  a.close = () => {
    a.closed = true;
  };
  b.close = () => {
    b.closed = true;
  };
  return { port1: a, port2: b };
}

// ---------------------------------------------------------------------------
// Signals

export function makeRandom(seed: number): { uniform: () => number; gauss: () => number } {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
  const gauss = () => {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += uniform() + 0.5;
    return sum - 6;
  };
  return { uniform, gauss };
}

export interface VowelOptions {
  sampleRate?: number;
  seconds?: number;
  f0?: number;
  formants: number[];
  bandwidths: number[];
  noise?: number;
  jitter?: number;
  shimmer?: number;
  seed?: number;
  glottalTilt?: boolean;
}

/** Glottal-pulse excited cascade of second-order resonators. */
export function synthVowel(options: VowelOptions): Float32Array {
  const {
    sampleRate = 16000,
    seconds = 1,
    f0 = 120,
    formants,
    bandwidths,
    noise = 0,
    jitter = 0,
    shimmer = 0,
    seed = 1,
    glottalTilt = true,
  } = options;
  const n = Math.floor(seconds * sampleRate);
  const { gauss } = makeRandom(seed);

  // Sub-sample pulse placement: whole-sample rounding alone adds ~0.4% jitter.
  const excitation = new Float64Array(n);
  const period = sampleRate / f0;
  let t = 0;
  while (t < n) {
    const p = period * (1 + jitter * gauss());
    const amp = 1 + shimmer * gauss();
    const i = Math.floor(t);
    const frac = t - i;
    if (i < n) excitation[i] += amp * (1 - frac);
    if (i + 1 < n) excitation[i + 1] += amp * frac;
    t += p;
  }

  // Glottal flow falls ~-12 dB/oct; with +6 dB/oct lip radiation the net
  // source is ~-6 dB/oct: one leaky integrator.
  if (glottalTilt) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc = excitation[i] + 0.97 * acc;
      excitation[i] = acc;
    }
  }

  let signal = excitation;
  for (let k = 0; k < formants.length; k++) {
    const C = -Math.exp((-2 * Math.PI * bandwidths[k]) / sampleRate);
    const B = 2 * Math.exp((-Math.PI * bandwidths[k]) / sampleRate) * Math.cos((2 * Math.PI * formants[k]) / sampleRate);
    const A = 1 - B - C;
    const y = new Float64Array(n);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const v = A * signal[i] + B * y1 + C * y2;
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    signal = y;
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(signal[i]));
  const scale = 0.5 / (peak || 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = signal[i] * scale + noise * gauss() * 0.5;
  return out;
}

export function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

export function addNoise(clean: Float32Array, snrDb: number, seed = 7): Float32Array {
  const { gauss } = makeRandom(seed);
  const target = rms(clean) / Math.pow(10, snrDb / 20);
  const out = new Float32Array(clean.length);
  for (let i = 0; i < clean.length; i++) out[i] = clean[i] + gauss() * target;
  return out;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : Number.NaN;
}

export function sine(sampleRate: number, freq: number, seconds: number, amp = 0.5, quantum = 128): Float32Array {
  const n = Math.floor((seconds * sampleRate) / quantum) * quantum;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return x;
}

export function impulseTrain(sampleRate: number, seconds: number, period: number, quantum = 128): Float32Array {
  const n = Math.floor((seconds * sampleRate) / quantum) * quantum;
  const x = new Float32Array(n);
  for (let i = period; i < n; i += period) x[i] = 1;
  return x;
}

/** Lag in samples that best aligns `out` to `inp`, searched over [0, maxLag]. */
export function bestLag(inp: Float32Array, out: Float32Array, maxLag: number, from: number, to = out.length): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = from; i < to - maxLag; i++) score += inp[i] * out[i + lag];
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

/** Zero-crossing frequency estimate over `x[from..]`. */
export function dominantFreq(x: Float32Array, sampleRate: number, from: number): number {
  const segment = x.subarray(from);
  let crossings = 0;
  for (let i = 1; i < segment.length; i++) if (segment[i] >= 0 !== segment[i - 1] >= 0) crossings++;
  return crossings / 2 / (segment.length / sampleRate);
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
