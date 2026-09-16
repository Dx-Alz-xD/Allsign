/**
 * Acoustic trigger matcher for low-vocal users: hums, grunts and pitch rises
 * enrolled as 128-bin spectral fingerprints, matched frame by frame against
 * the live spectrum by Euclidean distance.
 *
 * Spectra arrive as SpectralPackets over a MessagePort from audio.worker.ts
 * (one per 10 ms hop, ~0.05 ms to score), or as `frame` messages from the
 * main thread. Both are normalised the same way: bin energy -> dB above a
 * floor 40 dB under the frame peak (floor bins become 0, so only the peaks
 * carry weight and the noise floor cannot make two sounds look alike), then
 * unit length, which also makes the comparison level-invariant. For unit
 * vectors the Euclidean distance is in [0, 2] and similarity = 1 - distance / 2.
 *
 * A match needs `minConsecutiveFrames` above the trigger's threshold and is
 * followed by a refractory hold-off, so one 20 ms blip never fires twice.
 * Profiles persist to IndexedDB (workers have it); an in-memory store takes
 * over where it is unavailable, e.g. tests.
 */

import type { SpectralPacket, SpectralPortMessage } from '@/workers/audio.worker';
import type { AcousticTriggerProfile } from '@shared/types';

export interface TriggerWorkerConfig {
  /** Spectral bins per frame; must match audio.worker's spectralBinCount. */
  binCount: number;
  /** Used when a profile carries no threshold of its own. */
  defaultThreshold: number;
  /** Frames below this level are neither scored nor enrolled. */
  activityFloorDb: number;
  /** Bins more than this far below the frame peak count as zero (dB). */
  peakFloorDb: number;
  /** Live frames averaged before scoring; 1 disables smoothing. */
  smoothingFrames: number;
  /** Consecutive frames above threshold required to fire. */
  minConsecutiveFrames: number;
  /** Hold-off after a match before the same trigger can fire again. */
  refractoryMs: number;
  /** Best-score reports are posted every N frames; 0 disables them. */
  scoreEveryFrames: number;
  /** Live enrolment length. */
  captureDurationMs: number;
  /** Live enrolment aborts after this long without active frames. */
  captureTimeoutMs: number;
  /** Frame period, used to convert the durations above; 10 ms at a 160 hop. */
  frameMs: number;
}

export interface TriggerMatch {
  id: string;
  name: string;
  mappedPhrase: string;
  targetAction: AcousticTriggerProfile['targetAction'];
  similarity: number;
  distance: number;
  threshold: number;
  /** Audio timestamp of the frame that completed the match. */
  timestamp: number;
  /** Worker processing time from frame receipt to emit, milliseconds. */
  latencyMs: number;
}

export interface TriggerScore {
  id: string;
  similarity: number;
}

export interface CaptureRequest {
  id: string;
  name: string;
  mappedPhrase: string;
  targetAction: AcousticTriggerProfile['targetAction'];
  threshold?: number;
  durationMs?: number;
}

export type TriggerWorkerRequest =
  | { type: 'init'; config?: Partial<TriggerWorkerConfig> }
  | { type: 'connect'; port: MessagePort }
  | { type: 'frame'; bins: Float32Array | number[]; timestamp: number; volumeDb?: number }
  | { type: 'enroll'; profile: AcousticTriggerProfile }
  | { type: 'capture'; request: CaptureRequest }
  | { type: 'cancelCapture' }
  | { type: 'remove'; id: string }
  | { type: 'setThreshold'; id: string; threshold: number }
  | { type: 'list' }
  | { type: 'reset' }
  | { type: 'close' };

export type TriggerWorkerResponse =
  | { type: 'ready'; config: TriggerWorkerConfig; triggers: AcousticTriggerProfile[] }
  | { type: 'triggers'; triggers: AcousticTriggerProfile[] }
  | { type: 'enrolled'; profile: AcousticTriggerProfile }
  | { type: 'captureProgress'; id: string; frames: number; needed: number }
  | { type: 'captureCancelled'; id: string }
  | { type: 'match'; match: TriggerMatch }
  | { type: 'scores'; timestamp: number; best: TriggerScore | null; scores: TriggerScore[] }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}

const ctx = self as unknown as WorkerScope;

const DEFAULT_CONFIG: TriggerWorkerConfig = {
  binCount: 128,
  defaultThreshold: 0.85,
  activityFloorDb: -50,
  peakFloorDb: 40,
  smoothingFrames: 3,
  minConsecutiveFrames: 2,
  refractoryMs: 500,
  scoreEveryFrames: 5,
  captureDurationMs: 400,
  captureTimeoutMs: 5000,
  frameMs: 10,
};

const DB_NAME = 'omnivoice';
const DB_VERSION = 1;
const STORE_NAME = 'acousticTriggers';
const LOG_FLOOR = 1e-12;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

// ---------------------------------------------------------------------------
// Persistence

interface TriggerStore {
  load(): Promise<AcousticTriggerProfile[]>;
  put(profile: AcousticTriggerProfile): Promise<void>;
  remove(id: string): Promise<void>;
}

class MemoryStore implements TriggerStore {
  private readonly items = new Map<string, AcousticTriggerProfile>();

  async load(): Promise<AcousticTriggerProfile[]> {
    return [...this.items.values()];
  }

  async put(profile: AcousticTriggerProfile): Promise<void> {
    this.items.set(profile.id, profile);
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

class IndexedDbStore implements TriggerStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    return this.db;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  }

  load(): Promise<AcousticTriggerProfile[]> {
    return this.transaction('readonly', (store) => store.getAll() as IDBRequest<AcousticTriggerProfile[]>);
  }

  async put(profile: AcousticTriggerProfile): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(profile));
  }

  async remove(id: string): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(id));
  }
}

function createStore(): TriggerStore {
  return typeof indexedDB === 'undefined' ? new MemoryStore() : new IndexedDbStore();
}

// ---------------------------------------------------------------------------
// Matching

interface EnrolledTrigger {
  profile: AcousticTriggerProfile;
  vector: Float32Array;
  threshold: number;
  consecutive: number;
  lastMatchAt: number;
}

interface CaptureState {
  request: CaptureRequest;
  needed: number;
  frames: number;
  sum: Float64Array;
  /** First frame seen after the request; the timeout counts from here. */
  startedAt: number;
  lastActiveAt: number;
}

interface FrameResult {
  matches: TriggerMatch[];
  scores: TriggerWorkerResponse | null;
  capture: TriggerWorkerResponse[];
}

class TriggerMatcher {
  private config: TriggerWorkerConfig;
  private readonly store: TriggerStore;
  private readonly triggers: EnrolledTrigger[] = [];
  private readonly ports: MessagePort[] = [];

  private readonly scratch: Float32Array;
  private readonly smoothed: Float32Array;
  private readonly history: Float32Array[];
  private historyCount = 0;
  private historyNext = 0;
  private frameIndex = 0;
  private lastTimestamp = 0;
  private capture: CaptureState | null = null;

  constructor(config: Partial<TriggerWorkerConfig> = {}, store: TriggerStore = createStore()) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const { binCount, smoothingFrames } = this.config;
    if (binCount < 8) throw new Error(`binCount must be >= 8, received ${binCount}`);
    if (smoothingFrames < 1) throw new Error('smoothingFrames must be >= 1');
    this.store = store;
    this.scratch = new Float32Array(binCount);
    this.smoothed = new Float32Array(binCount);
    this.history = [];
    for (let i = 0; i < smoothingFrames; i++) this.history.push(new Float32Array(binCount));
  }

  get currentConfig(): TriggerWorkerConfig {
    return { ...this.config };
  }

  async load(): Promise<AcousticTriggerProfile[]> {
    const profiles = await this.store.load();
    this.triggers.length = 0;
    for (const profile of profiles) this.add(profile);
    return this.list();
  }

  list(): AcousticTriggerProfile[] {
    return this.triggers.map((trigger) => ({ ...trigger.profile }));
  }

  reset(): void {
    this.historyCount = 0;
    this.historyNext = 0;
    this.frameIndex = 0;
    this.capture = null;
    for (const trigger of this.triggers) {
      trigger.consecutive = 0;
      trigger.lastMatchAt = -Infinity;
    }
  }

  connect(port: MessagePort, onResult: (result: FrameResult) => void): void {
    this.ports.push(port);
    port.onmessage = (event: MessageEvent<SpectralPacket>) => {
      const packet = event.data;
      if (!packet || !(packet.bins instanceof Float32Array)) return;
      const bins = packet.bins;
      try {
        onResult(this.handleFrame(bins, packet.timestamp, packet.volumeDb));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onResult({ matches: [], scores: null, capture: [{ type: 'error', message }] });
      } finally {
        const recycle: SpectralPortMessage = { type: 'recycle', buffer: bins.buffer as ArrayBuffer };
        port.postMessage(recycle, [recycle.buffer]);
      }
    };
  }

  disconnect(): void {
    for (const port of this.ports) port.close();
    this.ports.length = 0;
  }

  async enroll(profile: AcousticTriggerProfile): Promise<AcousticTriggerProfile> {
    if (profile.spectralFingerprint.length !== this.config.binCount) {
      throw new Error(
        `Fingerprint has ${profile.spectralFingerprint.length} bins, expected ${this.config.binCount}`,
      );
    }
    const stored: AcousticTriggerProfile = {
      ...profile,
      spectralFingerprint: Array.from(profile.spectralFingerprint),
      threshold: clamp01(profile.threshold ?? this.config.defaultThreshold),
    };
    await this.store.put(stored);
    this.add(stored);
    return { ...stored };
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    const index = this.triggers.findIndex((trigger) => trigger.profile.id === id);
    if (index >= 0) this.triggers.splice(index, 1);
  }

  async setThreshold(id: string, threshold: number): Promise<void> {
    const trigger = this.triggers.find((item) => item.profile.id === id);
    if (!trigger) throw new Error(`Unknown trigger: ${id}`);
    trigger.threshold = clamp01(threshold);
    trigger.profile = { ...trigger.profile, threshold: trigger.threshold };
    await this.store.put(trigger.profile);
  }

  startCapture(request: CaptureRequest): CaptureState {
    const durationMs = request.durationMs ?? this.config.captureDurationMs;
    const needed = Math.max(1, Math.round(durationMs / this.config.frameMs));
    this.capture = {
      request,
      needed,
      frames: 0,
      sum: new Float64Array(this.config.binCount),
      startedAt: -1,
      lastActiveAt: -1,
    };
    return this.capture;
  }

  cancelCapture(): string | null {
    const id = this.capture?.request.id ?? null;
    this.capture = null;
    return id;
  }

  private add(profile: AcousticTriggerProfile): void {
    const existing = this.triggers.findIndex((trigger) => trigger.profile.id === profile.id);
    const vector = new Float32Array(this.config.binCount);
    this.normalise(profile.spectralFingerprint, vector);
    const trigger: EnrolledTrigger = {
      profile,
      vector,
      threshold: clamp01(profile.threshold ?? this.config.defaultThreshold),
      consecutive: 0,
      lastMatchAt: -Infinity,
    };
    if (existing >= 0) this.triggers[existing] = trigger;
    else this.triggers.push(trigger);
  }

  /**
   * Energy bins -> dB above the frame's floor -> unit vector. Silence maps to
   * the zero vector, which is equidistant from everything (similarity 0.29)
   * and can never clear a sensible threshold.
   */
  private normalise(bins: ArrayLike<number>, out: Float32Array): void {
    const n = out.length;
    let peak = 0;
    for (let i = 0; i < n; i++) if (bins[i] > peak) peak = bins[i];
    if (!(peak > 0)) {
      out.fill(0);
      return;
    }

    const floor = 10 * Math.log10(peak) - this.config.peakFloorDb;
    let norm = 0;
    for (let i = 0; i < n; i++) {
      const above = 10 * Math.log10(bins[i] + LOG_FLOOR) - floor;
      out[i] = above > 0 ? above : 0;
      norm += out[i] * out[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < n; i++) out[i] /= norm;
    } else {
      out.fill(0);
    }
  }

  /** Scores one frame; returns matches fired and, when due, the score table. */
  handleFrame(bins: ArrayLike<number>, timestamp: number, volumeDb: number | undefined): FrameResult {
    const started = performance.now();
    const { activityFloorDb, smoothingFrames, minConsecutiveFrames, refractoryMs, scoreEveryFrames } =
      this.config;
    this.frameIndex++;
    this.lastTimestamp = timestamp;

    const matches: TriggerMatch[] = [];
    const captureEvents: TriggerWorkerResponse[] = [];

    // Silence: nothing to score, streaks break, capture may time out.
    let active = volumeDb === undefined || volumeDb >= activityFloorDb;
    if (active) {
      let energy = 0;
      for (let i = 0; i < bins.length; i++) energy += bins[i];
      if (!(energy > 0)) active = false;
    }
    if (!active) {
      for (const trigger of this.triggers) trigger.consecutive = 0;
      captureEvents.push(...this.captureTick(null, timestamp));
      return { matches, scores: null, capture: captureEvents };
    }

    this.normalise(bins, this.scratch);
    captureEvents.push(...this.captureTick(bins, timestamp));

    let vector = this.scratch;
    if (smoothingFrames > 1) {
      this.history[this.historyNext].set(this.scratch);
      this.historyNext = (this.historyNext + 1) % smoothingFrames;
      if (this.historyCount < smoothingFrames) this.historyCount++;

      const smoothed = this.smoothed;
      smoothed.fill(0);
      for (let h = 0; h < this.historyCount; h++) {
        const frame = this.history[h];
        for (let i = 0; i < smoothed.length; i++) smoothed[i] += frame[i];
      }
      let norm = 0;
      for (let i = 0; i < smoothed.length; i++) norm += smoothed[i] * smoothed[i];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let i = 0; i < smoothed.length; i++) smoothed[i] /= norm;
      vector = smoothed;
    }

    const scores: TriggerScore[] = [];
    let best: TriggerScore | null = null;

    for (const trigger of this.triggers) {
      const target = trigger.vector;
      let sum = 0;
      for (let i = 0; i < vector.length; i++) {
        const d = vector[i] - target[i];
        sum += d * d;
      }
      const distance = Math.sqrt(sum);
      const similarity = clamp01(1 - distance / 2);
      const score = { id: trigger.profile.id, similarity };
      scores.push(score);
      if (!best || similarity > best.similarity) best = score;

      if (similarity < trigger.threshold) {
        trigger.consecutive = 0;
        continue;
      }
      trigger.consecutive++;
      if (trigger.consecutive < minConsecutiveFrames) continue;
      if (timestamp - trigger.lastMatchAt < refractoryMs) continue;

      trigger.lastMatchAt = timestamp;
      trigger.consecutive = 0;
      matches.push({
        id: trigger.profile.id,
        name: trigger.profile.name,
        mappedPhrase: trigger.profile.mappedPhrase,
        targetAction: trigger.profile.targetAction,
        similarity,
        distance,
        threshold: trigger.threshold,
        timestamp,
        latencyMs: performance.now() - started,
      });
    }

    const scoresDue =
      scoreEveryFrames > 0 && this.triggers.length > 0 && this.frameIndex % scoreEveryFrames === 0;
    const scoresMessage: TriggerWorkerResponse | null = scoresDue
      ? { type: 'scores', timestamp, best, scores }
      : null;

    return { matches, scores: scoresMessage, capture: captureEvents };
  }

  /** Accumulates active frames into a pending enrolment. */
  private captureTick(bins: ArrayLike<number> | null, timestamp: number): TriggerWorkerResponse[] {
    const capture = this.capture;
    if (!capture) return [];
    const events: TriggerWorkerResponse[] = [];
    if (capture.startedAt < 0) capture.startedAt = timestamp;

    if (bins === null) {
      const reference = capture.lastActiveAt >= 0 ? capture.lastActiveAt : capture.startedAt;
      if (timestamp - reference > this.config.captureTimeoutMs) {
        this.capture = null;
        events.push({ type: 'error', message: `Capture of ${capture.request.id} timed out` });
      }
      return events;
    }

    for (let i = 0; i < capture.sum.length; i++) capture.sum[i] += bins[i];
    capture.frames++;
    capture.lastActiveAt = timestamp;

    if (capture.frames < capture.needed) {
      if (capture.frames % 5 === 0) {
        events.push({
          type: 'captureProgress',
          id: capture.request.id,
          frames: capture.frames,
          needed: capture.needed,
        });
      }
      return events;
    }

    this.capture = null;
    const fingerprint = new Array<number>(capture.sum.length);
    for (let i = 0; i < fingerprint.length; i++) fingerprint[i] = capture.sum[i] / capture.frames;
    const { request } = capture;
    // Enrolment persists asynchronously; the caller sees `enrolled` then `triggers`.
    void this.enroll({
      id: request.id,
      name: request.name,
      spectralFingerprint: fingerprint,
      mappedPhrase: request.mappedPhrase,
      targetAction: request.targetAction,
      threshold: request.threshold ?? this.config.defaultThreshold,
    })
      .then((profile) => {
        ctx.postMessage({ type: 'enrolled', profile } satisfies TriggerWorkerResponse);
        ctx.postMessage({ type: 'triggers', triggers: this.list() } satisfies TriggerWorkerResponse);
      })
      .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
    return events;
  }
}

// ---------------------------------------------------------------------------
// Message loop

let matcher: TriggerMatcher | null = null;

function fail(message: string): void {
  const response: TriggerWorkerResponse = { type: 'error', message };
  ctx.postMessage(response);
}

function postTriggers(): void {
  if (!matcher) return;
  const response: TriggerWorkerResponse = { type: 'triggers', triggers: matcher.list() };
  ctx.postMessage(response);
}

function dispatch(result: FrameResult): void {
  for (const match of result.matches) {
    const response: TriggerWorkerResponse = { type: 'match', match };
    ctx.postMessage(response);
  }
  if (result.scores) ctx.postMessage(result.scores);
  for (const event of result.capture) ctx.postMessage(event);
}

ctx.onmessage = (event: MessageEvent) => {
  const request = event.data as TriggerWorkerRequest;

  try {
    switch (request.type) {
      case 'init': {
        matcher?.disconnect();
        const next = new TriggerMatcher(request.config);
        matcher = next;
        void next
          .load()
          .then((triggers) => {
            if (matcher !== next) return;
            const response: TriggerWorkerResponse = {
              type: 'ready',
              config: next.currentConfig,
              triggers,
            };
            ctx.postMessage(response);
          })
          .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
        break;
      }

      case 'connect': {
        if (!matcher) {
          fail('Worker received a port before init');
          return;
        }
        matcher.connect(request.port, dispatch);
        break;
      }

      case 'frame': {
        if (!matcher) {
          fail('Worker received a frame before init');
          return;
        }
        dispatch(matcher.handleFrame(request.bins, request.timestamp, request.volumeDb));
        break;
      }

      case 'enroll': {
        if (!matcher) return;
        void matcher
          .enroll(request.profile)
          .then((profile) => {
            const response: TriggerWorkerResponse = { type: 'enrolled', profile };
            ctx.postMessage(response);
            postTriggers();
          })
          .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
        break;
      }

      case 'capture': {
        if (!matcher) return;
        const state = matcher.startCapture(request.request);
        const response: TriggerWorkerResponse = {
          type: 'captureProgress',
          id: state.request.id,
          frames: 0,
          needed: state.needed,
        };
        ctx.postMessage(response);
        break;
      }

      case 'cancelCapture': {
        const id = matcher?.cancelCapture() ?? null;
        if (id !== null) {
          const response: TriggerWorkerResponse = { type: 'captureCancelled', id };
          ctx.postMessage(response);
        }
        break;
      }

      case 'remove': {
        if (!matcher) return;
        void matcher
          .remove(request.id)
          .then(postTriggers)
          .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
        break;
      }

      case 'setThreshold': {
        if (!matcher) return;
        void matcher
          .setThreshold(request.id, request.threshold)
          .then(postTriggers)
          .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
        break;
      }

      case 'list': {
        postTriggers();
        break;
      }

      case 'reset': {
        matcher?.reset();
        break;
      }

      case 'close': {
        matcher?.disconnect();
        matcher = null;
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
