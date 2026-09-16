/**
 * Acoustic trigger matcher for low-vocal users: hums, grunts and pitch rises
 * enrolled as 128-bin spectral fingerprints, matched frame by frame against
 * the live spectrum.
 *
 * Scoring is a line-for-line port of backend/acoustic_matcher.py, so a
 * trigger's threshold means the same thing here as in `POST /api/triggers/
 * match` and in the backend's evaluation report:
 *   score = 0.6 * shape + 0.2 * band + 0.2 * peaks
 * on a 3-bin-smoothed dB envelope (bin 0 dropped, floored 30 dB below its
 * maximum): correlation of the mean-removed envelopes, the query's share of
 * power inside the template's strongest band, and prominent-peak overlap
 * within two bins. Frames below the -60 dB silence floor never match.
 *
 * Spectra arrive as SpectralPackets over a MessagePort from audio.worker.ts
 * (one per 10 ms hop) or as `frame` messages; the query is the mean power of
 * the last `smoothingFrames` frames. A match needs `minConsecutiveFrames`
 * above threshold and is followed by a refractory hold-off.
 *
 * Profiles live in the backend's SQLite store when `apiBaseUrl` is set (the
 * worker talks to /api/triggers directly); otherwise in IndexedDB, or in
 * memory where neither exists (tests).
 */

import type { SpectralPacket, SpectralPortMessage } from '@/workers/audio.worker';
import type { AcousticTriggerProfile } from '@shared/types';

export interface TriggerWorkerConfig {
  /** Spectral bins per frame; must match audio.worker's spectralBinCount. */
  binCount: number;
  /** Used when a profile carries no threshold of its own. */
  defaultThreshold: number;
  /** Frames whose summed power is below this (dB) never match or enrol. */
  silenceFloorDb: number;
  /** Frames averaged (raw power) before scoring; the backend evaluates ~120 ms. */
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
  /** Backend origin, e.g. http://127.0.0.1:8000. Empty = local IndexedDB store. */
  apiBaseUrl: string;
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
  | { type: 'ready'; config: TriggerWorkerConfig; triggers: AcousticTriggerProfile[]; warning?: string }
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
  silenceFloorDb: -60,
  smoothingFrames: 6,
  minConsecutiveFrames: 2,
  refractoryMs: 500,
  scoreEveryFrames: 5,
  captureDurationMs: 400,
  captureTimeoutMs: 5000,
  frameMs: 10,
  apiBaseUrl: '',
};

// Matcher constants, identical to backend/acoustic_matcher.py.
const SILENT_DB = -120;
const SMOOTHING_BINS = 3;
const DYNAMIC_RANGE_DB = 30;
const SUPPORT_RANGE_DB = 15;
const SHAPE_WEIGHT = 0.6;
const BAND_WEIGHT = 0.2;
const PEAK_WEIGHT = 0.2;
const MAX_PEAKS = 6;
const PEAK_PROMINENCE_DB = 6;
const PEAK_TOLERANCE_BINS = 2;

const DB_NAME = 'omnivoice';
const DB_VERSION = 1;
const STORE_NAME = 'acousticTriggers';

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

// ---------------------------------------------------------------------------
// Spectral profile and similarity (port of acoustic_matcher.py)

export interface SpectralProfile {
  levelDb: number;
  shape: Float64Array;
  peaks: number[];
  support: number[];
  bandRatio: number;
  powers: Float64Array;
  totalPower: number;
}

function toDb(power: number): number {
  return power > 0 ? Math.max(SILENT_DB, 10 * Math.log10(power)) : SILENT_DB;
}

function smooth(values: Float64Array): Float64Array {
  const reach = SMOOTHING_BINS >> 1;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - reach);
    const to = Math.min(values.length - 1, i + reach);
    let sum = 0;
    for (let k = from; k <= to; k++) sum += values[k];
    out[i] = sum / (to - from + 1);
  }
  return out;
}

function prominentPeaks(envelope: Float64Array): number[] {
  const sorted = Array.from(envelope).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const last = envelope.length - 1;
  const candidates: number[] = [];
  for (let i = 0; i < envelope.length; i++) {
    const value = envelope[i];
    if (value - median < PEAK_PROMINENCE_DB) continue;
    if (i > 0 && value < envelope[i - 1]) continue;
    if (i < last && value <= envelope[i + 1]) continue;
    candidates.push(i);
  }
  candidates.sort((a, b) => envelope[b] - envelope[a] || a - b);
  return candidates.slice(0, MAX_PEAKS).sort((a, b) => a - b);
}

export function spectralProfile(bins: ArrayLike<number>): SpectralProfile {
  const n = bins.length - 1;
  // Bin 0 is DC and mains hum territory; it carries no trigger identity.
  const powers = new Float64Array(n);
  let totalPower = 0;
  let level = 0;
  for (let i = 0; i < bins.length; i++) {
    level += bins[i];
    if (i > 0) {
      powers[i - 1] = bins[i];
      totalPower += bins[i];
    }
  }

  const envelope = smooth(Float64Array.from(powers, toDb));
  let top = -Infinity;
  for (let i = 0; i < n; i++) if (envelope[i] > top) top = envelope[i];

  const floored = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    floored[i] = Math.max(envelope[i], top - DYNAMIC_RANGE_DB);
    mean += floored[i];
  }
  mean /= n;
  const shape = new Float64Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) {
    shape[i] = floored[i] - mean;
    norm += shape[i] * shape[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < n; i++) shape[i] /= norm;
  else shape.fill(0);

  const support: number[] = [];
  let supportPower = 0;
  for (let i = 0; i < n; i++) {
    if (envelope[i] >= top - SUPPORT_RANGE_DB) {
      support.push(i);
      supportPower += powers[i];
    }
  }

  return {
    levelDb: toDb(level),
    shape,
    peaks: prominentPeaks(envelope),
    support,
    bandRatio: totalPower > 0 ? supportPower / totalPower : 0,
    powers,
    totalPower,
  };
}

function peakRecall(reference: number[], other: number[]): number {
  let hits = 0;
  for (const peak of reference) {
    if (other.some((candidate) => Math.abs(peak - candidate) <= PEAK_TOLERANCE_BINS)) hits++;
  }
  return hits / reference.length;
}

export function similarity(query: SpectralProfile, template: SpectralProfile): number {
  let dot = 0;
  for (let i = 0; i < query.shape.length; i++) dot += query.shape[i] * template.shape[i];
  const shape = Math.max(0, dot);

  let band = 0;
  if (query.totalPower > 0 && template.bandRatio > 0) {
    let inBand = 0;
    for (const index of template.support) inBand += query.powers[index];
    band = Math.min(1, inBand / query.totalPower / template.bandRatio);
  }

  let peaks: number;
  if (query.peaks.length > 0 && template.peaks.length > 0) {
    peaks = (peakRecall(template.peaks, query.peaks) + peakRecall(query.peaks, template.peaks)) / 2;
  } else {
    peaks = query.peaks.length > 0 || template.peaks.length > 0 ? 0 : 1;
  }

  return SHAPE_WEIGHT * shape + BAND_WEIGHT * band + PEAK_WEIGHT * peaks;
}

// ---------------------------------------------------------------------------
// Persistence

interface TriggerStore {
  load(): Promise<AcousticTriggerProfile[]>;
  /** Creates or replaces; the returned profile carries the store's id. */
  save(profile: AcousticTriggerProfile, exists: boolean): Promise<AcousticTriggerProfile>;
  patch(id: string, changes: Partial<AcousticTriggerProfile>): Promise<AcousticTriggerProfile>;
  remove(id: string): Promise<void>;
}

class MemoryStore implements TriggerStore {
  private readonly items = new Map<string, AcousticTriggerProfile>();

  async load(): Promise<AcousticTriggerProfile[]> {
    return [...this.items.values()];
  }

  async save(profile: AcousticTriggerProfile): Promise<AcousticTriggerProfile> {
    this.items.set(profile.id, profile);
    return profile;
  }

  async patch(id: string, changes: Partial<AcousticTriggerProfile>): Promise<AcousticTriggerProfile> {
    const current = this.items.get(id);
    if (!current) throw new Error(`Unknown trigger: ${id}`);
    const next = { ...current, ...changes, id };
    this.items.set(id, next);
    return next;
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
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    return this.db;
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  }

  load(): Promise<AcousticTriggerProfile[]> {
    return this.transaction('readonly', (store) => store.getAll() as IDBRequest<AcousticTriggerProfile[]>);
  }

  async save(profile: AcousticTriggerProfile): Promise<AcousticTriggerProfile> {
    await this.transaction('readwrite', (store) => store.put(profile));
    return profile;
  }

  async patch(id: string, changes: Partial<AcousticTriggerProfile>): Promise<AcousticTriggerProfile> {
    const current = await this.transaction('readonly', (store) => store.get(id) as IDBRequest<AcousticTriggerProfile | undefined>);
    if (!current) throw new Error(`Unknown trigger: ${id}`);
    const next = { ...current, ...changes, id };
    await this.transaction('readwrite', (store) => store.put(next));
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(id));
  }
}

/** The backend's SQLite triggers via /api/triggers; the server assigns ids. */
class BackendStore implements TriggerStore {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Trigger store ${init?.method ?? 'GET'} ${path} failed: ${response.status} ${detail}`.trim());
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  load(): Promise<AcousticTriggerProfile[]> {
    return this.request<AcousticTriggerProfile[]>('/api/triggers?limit=500');
  }

  save(profile: AcousticTriggerProfile, exists: boolean): Promise<AcousticTriggerProfile> {
    const { id, ...body } = profile;
    return exists
      ? this.request<AcousticTriggerProfile>(`/api/triggers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) })
      : this.request<AcousticTriggerProfile>('/api/triggers', { method: 'POST', body: JSON.stringify(body) });
  }

  patch(id: string, changes: Partial<AcousticTriggerProfile>): Promise<AcousticTriggerProfile> {
    return this.request<AcousticTriggerProfile>(`/api/triggers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
  }

  remove(id: string): Promise<void> {
    return this.request<void>(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

function createStore(apiBaseUrl: string): TriggerStore {
  if (apiBaseUrl && typeof fetch === 'function') return new BackendStore(apiBaseUrl.replace(/\/+$/, ''));
  return typeof indexedDB === 'undefined' ? new MemoryStore() : new IndexedDbStore();
}

// ---------------------------------------------------------------------------
// Matching

interface EnrolledTrigger {
  profile: AcousticTriggerProfile;
  template: SpectralProfile;
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

  private readonly history: Float64Array[];
  private readonly query: Float64Array;
  private historyCount = 0;
  private historyNext = 0;
  private frameIndex = 0;
  private capture: CaptureState | null = null;

  constructor(config: Partial<TriggerWorkerConfig> = {}, store?: TriggerStore) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const { binCount, smoothingFrames } = this.config;
    if (binCount < 8) throw new Error(`binCount must be >= 8, received ${binCount}`);
    if (smoothingFrames < 1) throw new Error('smoothingFrames must be >= 1');
    this.store = store ?? createStore(this.config.apiBaseUrl);
    this.query = new Float64Array(binCount);
    this.history = [];
    for (let i = 0; i < smoothingFrames; i++) this.history.push(new Float64Array(binCount));
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
      throw new Error(`Fingerprint has ${profile.spectralFingerprint.length} bins, expected ${this.config.binCount}`);
    }
    const exists = this.triggers.some((trigger) => trigger.profile.id === profile.id);
    const stored = await this.store.save(
      {
        ...profile,
        spectralFingerprint: Array.from(profile.spectralFingerprint),
        threshold: clamp01(profile.threshold ?? this.config.defaultThreshold),
      },
      exists,
    );
    if (exists && stored.id !== profile.id) this.drop(profile.id);
    this.add(stored);
    return { ...stored };
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    this.drop(id);
  }

  async setThreshold(id: string, threshold: number): Promise<void> {
    const trigger = this.triggers.find((item) => item.profile.id === id);
    if (!trigger) throw new Error(`Unknown trigger: ${id}`);
    const stored = await this.store.patch(id, { threshold: clamp01(threshold) });
    trigger.threshold = clamp01(stored.threshold ?? threshold);
    trigger.profile = { ...trigger.profile, ...stored, threshold: trigger.threshold };
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

  private drop(id: string): void {
    const index = this.triggers.findIndex((trigger) => trigger.profile.id === id);
    if (index >= 0) this.triggers.splice(index, 1);
  }

  private add(profile: AcousticTriggerProfile): void {
    const trigger: EnrolledTrigger = {
      profile,
      template: spectralProfile(profile.spectralFingerprint),
      threshold: clamp01(profile.threshold ?? this.config.defaultThreshold),
      consecutive: 0,
      lastMatchAt: -Infinity,
    };
    const existing = this.triggers.findIndex((item) => item.profile.id === profile.id);
    if (existing >= 0) this.triggers[existing] = trigger;
    else this.triggers.push(trigger);
  }

  /** Scores one frame; returns matches fired and, when due, the score table. */
  handleFrame(bins: ArrayLike<number>, timestamp: number, volumeDb: number | undefined): FrameResult {
    const started = performance.now();
    const { silenceFloorDb, smoothingFrames, minConsecutiveFrames, refractoryMs, scoreEveryFrames } = this.config;
    this.frameIndex++;

    const matches: TriggerMatch[] = [];
    const captureEvents: TriggerWorkerResponse[] = [];

    // The mean power of the last few frames is the query, as in the backend evaluation.
    this.history[this.historyNext].set(bins as ArrayLike<number> & { length: number });
    this.historyNext = (this.historyNext + 1) % smoothingFrames;
    if (this.historyCount < smoothingFrames) this.historyCount++;
    const query = this.query;
    query.fill(0);
    for (let h = 0; h < this.historyCount; h++) {
      const frame = this.history[h];
      for (let i = 0; i < query.length; i++) query[i] += frame[i];
    }
    for (let i = 0; i < query.length; i++) query[i] /= this.historyCount;

    const profile = spectralProfile(query);
    const active = profile.levelDb >= silenceFloorDb && (volumeDb === undefined || volumeDb >= silenceFloorDb);
    if (!active) {
      for (const trigger of this.triggers) trigger.consecutive = 0;
      captureEvents.push(...this.captureTick(null, timestamp));
      return { matches, scores: null, capture: captureEvents };
    }
    captureEvents.push(...this.captureTick(bins, timestamp));

    const scores: TriggerScore[] = [];
    let best: TriggerScore | null = null;
    let bestTrigger: EnrolledTrigger | null = null;

    for (const trigger of this.triggers) {
      const score = clamp01(similarity(profile, trigger.template));
      const entry = { id: trigger.profile.id, similarity: score };
      scores.push(entry);
      if (!best || score > best.similarity) {
        best = entry;
        bestTrigger = trigger;
      }
    }

    // Only the best candidate can fire, and only above its own threshold (as in the backend).
    for (const trigger of this.triggers) {
      const own = trigger === bestTrigger && best !== null && best.similarity >= trigger.threshold;
      if (!own) {
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
        similarity: best!.similarity,
        distance: 1 - best!.similarity,
        threshold: trigger.threshold,
        timestamp,
        latencyMs: performance.now() - started,
      });
    }

    const scoresDue = scoreEveryFrames > 0 && this.triggers.length > 0 && this.frameIndex % scoreEveryFrames === 0;
    const scoresMessage: TriggerWorkerResponse | null = scoresDue ? { type: 'scores', timestamp, best, scores } : null;

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
        events.push({ type: 'captureProgress', id: capture.request.id, frames: capture.frames, needed: capture.needed });
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

const failed = (error: unknown): void => fail(error instanceof Error ? error.message : String(error));

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
            const response: TriggerWorkerResponse = { type: 'ready', config: next.currentConfig, triggers };
            ctx.postMessage(response);
          })
          .catch((error: unknown) => {
            // An unreachable store must not take the matcher down: start empty and say so.
            if (matcher !== next) return;
            const warning = error instanceof Error ? error.message : String(error);
            const response: TriggerWorkerResponse = { type: 'ready', config: next.currentConfig, triggers: [], warning };
            ctx.postMessage(response);
          });
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
          .catch(failed);
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
        void matcher.remove(request.id).then(postTriggers).catch(failed);
        break;
      }

      case 'setThreshold': {
        if (!matcher) return;
        void matcher.setThreshold(request.id, request.threshold).then(postTriggers).catch(failed);
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
    failed(error);
  }
};
