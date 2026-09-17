/**
 * Speech token stream to the grammar engine (backend `POST /api/grammar/translate`).
 *
 * Token batches come from the main thread's token sources: typed text, opt-in
 * system dictation (lib/speech/tokenSource.ts) and the Studio demo
 * script. Nothing is recognised here; the worker only segments, orders and
 * delivers tokens. Final batches collect into an utterance, which closes when
 *   - the batch ends it (`endOfUtterance`, e.g. a typed sentence),
 *   - cadence.worker reports the end of voiced speech (`boundary`),
 *   - no final batch arrives for `idleFlushMs` while no voice is active,
 *   - it reaches `maxUtteranceTokens`, or the source changes.
 * While cadence.worker reports an active utterance (`voice`), the idle flush
 * waits, so a stuttering block in the middle of a dictated sentence does not
 * split it in two.
 *
 * Closed utterances are translated strictly in order, one request at a time,
 * so direct paste and the caregiver broadcast never see sentences out of
 * order. When the backend cannot be reached, a dictated utterance stays at
 * the head of the queue and is retried with backoff (or at once on `online`);
 * typed and demo utterances fail fast because someone is there to resubmit
 * them. A request the backend rejects (4xx) is dropped with an error.
 */

import type { GrammarResponse, ProfileMode, SpeechSource } from '@shared/types';

export interface SpeechWorkerConfig {
  /** Backend origin, e.g. http://127.0.0.1:8000. */
  apiBaseUrl: string;
  sourceLang: string;
  targetProfile: ProfileMode;
  /** A streamed utterance closes after this long without a new final batch. */
  idleFlushMs: number;
  /** Streamed utterances close at this many tokens (at most 256, the backend's limit). */
  maxUtteranceTokens: number;
  /** Closed utterances waiting for the backend; the oldest is dropped beyond this. */
  maxQueue: number;
  requestTimeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

export type CloseReason = 'submitted' | 'boundary' | 'idle' | 'max-tokens' | 'source-changed' | 'flush';

export interface Utterance {
  /** Increasing per worker instance. */
  id: number;
  /** Caller's correlation id, echoed on every part of the utterance. */
  requestId: string | null;
  tokens: string[];
  source: SpeechSource;
  /** Epoch ms of the first final batch and of the close. */
  openedAt: number;
  closedAt: number;
  reason: CloseReason;
  /** An oversized utterance is sent in parts, numbered from 1. */
  part: number;
  parts: number;
}

export interface Translation {
  utterance: Utterance;
  grammar: GrammarResponse;
  /** Clause groups the engine returned in their original order (X-Grammar-Unparsed-Groups). */
  unparsedGroups: number;
  /** Request start to parsed response, milliseconds. */
  roundTripMs: number;
  /** Utterance close to request start, milliseconds. */
  queuedMs: number;
  attempts: number;
}

export type SpeechWorkerRequest =
  | { type: 'init'; config?: Partial<SpeechWorkerConfig> }
  | { type: 'configure'; config: Partial<SpeechWorkerConfig> }
  | {
      type: 'tokens';
      tokens: string[];
      /** False for interim dictation results that may still change. */
      final: boolean;
      source: SpeechSource;
      endOfUtterance?: boolean;
      requestId?: string;
    }
  /** cadence.worker's `utteranceActive`, sent when it changes. */
  | { type: 'voice'; active: boolean }
  | { type: 'boundary' }
  | { type: 'flush' }
  /** The backend answered a health check again: retry a waiting utterance now. */
  | { type: 'online' }
  | { type: 'reset' }
  | { type: 'close' };

export type SpeechWorkerResponse =
  | { type: 'ready'; config: SpeechWorkerConfig }
  | { type: 'interim'; tokens: string[]; source: SpeechSource }
  | { type: 'utterance'; utterance: Utterance; pending: number }
  | { type: 'translation'; translation: Translation; pending: number }
  | {
      type: 'translationFailed';
      utterance: Utterance;
      message: string;
      /** HTTP status, or null when no response arrived. */
      status: number | null;
      /** Null when the utterance was given up; otherwise the delay before the next attempt. */
      retryInMs: number | null;
      pending: number;
    }
  | { type: 'dropped'; utterance: Utterance; message: string; pending: number }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

const ctx = self as unknown as WorkerScope;

/** Request limits of backend/schemas.py (GrammarRequestSchema). */
const MAX_REQUEST_TOKENS = 256;
const MAX_TOKEN_CHARS = 64;
const TRANSLATE_PATH = '/api/grammar/translate';
const UNPARSED_HEADER = 'X-Grammar-Unparsed-Groups';

const DEFAULT_CONFIG: SpeechWorkerConfig = {
  apiBaseUrl: '',
  sourceLang: 'en',
  targetProfile: 'clearvoice',
  idleFlushMs: 1200,
  maxUtteranceTokens: 64,
  maxQueue: 16,
  requestTimeoutMs: 4000,
  retryBaseMs: 500,
  retryMaxMs: 8000,
};

function normaliseConfig(config: SpeechWorkerConfig): SpeechWorkerConfig {
  const whole = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
  return {
    ...config,
    apiBaseUrl: config.apiBaseUrl.replace(/\/+$/, ''),
    idleFlushMs: whole(config.idleFlushMs, 0, 60_000),
    maxUtteranceTokens: whole(config.maxUtteranceTokens, 1, MAX_REQUEST_TOKENS),
    maxQueue: whole(config.maxQueue, 1, 1000),
    requestTimeoutMs: whole(config.requestTimeoutMs, 1, 60_000),
    retryBaseMs: whole(config.retryBaseMs, 1, 60_000),
    retryMaxMs: whole(config.retryMaxMs, 1, 600_000),
  };
}

function cleanTokens(tokens: readonly unknown[]): string[] {
  const cleaned: string[] = [];
  for (const token of tokens) {
    if (typeof token !== 'string') continue;
    const trimmed = token.trim();
    if (trimmed) cleaned.push(trimmed.slice(0, MAX_TOKEN_CHARS));
  }
  return cleaned;
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg: unknown }).msg) : ''))
        .filter(Boolean)
        .join('; ');
    }
  } catch {
    // No JSON body; the status says enough.
  }
  return '';
}

interface OpenUtterance {
  tokens: string[];
  source: SpeechSource;
  openedAt: number;
}

interface QueuedUtterance {
  utterance: Utterance;
  attempts: number;
}

type Timer = ReturnType<typeof setTimeout>;

export class SpeechPipeline {
  private config: SpeechWorkerConfig;
  private open: OpenUtterance | null = null;
  private voiceActive = false;
  private idleTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private readonly queue: QueuedUtterance[] = [];
  /** The utterance being translated, or waiting to be retried. */
  private head: QueuedUtterance | null = null;
  private busy = false;
  private nextId = 1;
  /** Bumped by reset(), so answers to abandoned requests are ignored. */
  private generation = 0;

  constructor(
    config: Partial<SpeechWorkerConfig>,
    private readonly emit: (message: SpeechWorkerResponse) => void,
  ) {
    this.config = normaliseConfig({ ...DEFAULT_CONFIG, ...config });
  }

  get currentConfig(): SpeechWorkerConfig {
    return { ...this.config };
  }

  get pending(): number {
    return this.queue.length + (this.head ? 1 : 0);
  }

  configure(patch: Partial<SpeechWorkerConfig>): void {
    this.config = normaliseConfig({ ...this.config, ...patch });
  }

  tokens(batch: Extract<SpeechWorkerRequest, { type: 'tokens' }>): void {
    const tokens = cleanTokens(batch.tokens);
    if (!batch.final) {
      const committed = this.open?.source === batch.source ? this.open.tokens : [];
      this.emit({ type: 'interim', tokens: [...committed, ...tokens], source: batch.source });
      return;
    }

    if (this.open && this.open.source !== batch.source) this.close('source-changed');
    if (tokens.length > 0) {
      if (!this.open) this.open = { tokens: [], source: batch.source, openedAt: Date.now() };
      this.open.tokens.push(...tokens);
    }

    if (batch.endOfUtterance) {
      this.close('submitted', batch.requestId ?? null, batch.source);
    } else if (this.open && this.open.tokens.length >= this.config.maxUtteranceTokens) {
      this.close('max-tokens');
    } else if (this.open) {
      this.armIdle();
    }
  }

  voice(active: boolean): void {
    this.voiceActive = active;
    if (!active && this.open) this.armIdle();
  }

  boundary(): void {
    this.voiceActive = false;
    if (this.open) this.close('boundary');
  }

  flush(): void {
    if (this.open) this.close('flush');
  }

  online(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.pump();
  }

  reset(): void {
    this.generation++;
    this.clearIdle();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.open = null;
    this.voiceActive = false;
    this.queue.length = 0;
    this.head = null;
    this.busy = false;
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.open) return;
      // Someone is still mid-utterance; the boundary (or a later idle check) closes it.
      if (this.voiceActive) this.armIdle();
      else this.close('idle');
    }, this.config.idleFlushMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private close(reason: CloseReason, requestId: string | null = null, source?: SpeechSource): void {
    this.clearIdle();
    const open = this.open;
    this.open = null;
    const closedAt = Date.now();

    if (!open || open.tokens.length === 0) {
      // A submission with nothing usable in it still gets an answer.
      if (requestId !== null) {
        const utterance: Utterance = {
          id: this.nextId++,
          requestId,
          tokens: [],
          source: source ?? 'manual',
          openedAt: closedAt,
          closedAt,
          reason,
          part: 1,
          parts: 1,
        };
        this.emit({ type: 'dropped', utterance, message: 'There are no words to rebuild.', pending: this.pending });
      }
      return;
    }

    const limit = reason === 'submitted' ? MAX_REQUEST_TOKENS : this.config.maxUtteranceTokens;
    const parts = Math.ceil(open.tokens.length / limit);
    for (let part = 0; part < parts; part++) {
      this.enqueue({
        id: this.nextId++,
        requestId,
        tokens: open.tokens.slice(part * limit, (part + 1) * limit),
        source: open.source,
        openedAt: open.openedAt,
        closedAt,
        reason,
        part: part + 1,
        parts,
      });
    }
    this.pump();
  }

  private enqueue(utterance: Utterance): void {
    this.queue.push({ utterance, attempts: 0 });
    this.emit({ type: 'utterance', utterance, pending: this.pending });
    while (this.queue.length > this.config.maxQueue) {
      const dropped = this.queue.shift()!;
      this.emit({
        type: 'dropped',
        utterance: dropped.utterance,
        message: 'Too many sentences were waiting for the grammar engine, so the oldest one was dropped.',
        pending: this.pending,
      });
    }
  }

  private pump(): void {
    if (this.busy || this.retryTimer !== null) return;
    if (!this.head) {
      const next = this.queue.shift();
      if (!next) return;
      this.head = next;
    }

    const item = this.head;
    const generation = this.generation;
    const startedEpoch = Date.now();
    const started = performance.now();
    this.busy = true;
    item.attempts++;

    this.request(item.utterance).then(
      ({ grammar, unparsedGroups }) => {
        if (generation !== this.generation) return;
        this.busy = false;
        this.head = null;
        const translation: Translation = {
          utterance: item.utterance,
          grammar,
          unparsedGroups,
          roundTripMs: performance.now() - started,
          queuedMs: Math.max(0, startedEpoch - item.utterance.closedAt),
          attempts: item.attempts,
        };
        this.emit({ type: 'translation', translation, pending: this.pending });
        this.pump();
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.busy = false;
        const failure =
          error instanceof RequestError ? error : new RequestError(error instanceof Error ? error.message : String(error), null, false);
        const retry = failure.retryable && item.utterance.source === 'system-dictation';
        if (!retry) {
          this.head = null;
          this.emit({
            type: 'translationFailed',
            utterance: item.utterance,
            message: failure.message,
            status: failure.status,
            retryInMs: null,
            pending: this.pending,
          });
          this.pump();
          return;
        }
        const delay = Math.min(this.config.retryMaxMs, this.config.retryBaseMs * 2 ** (item.attempts - 1));
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.pump();
        }, delay);
        this.emit({
          type: 'translationFailed',
          utterance: item.utterance,
          message: failure.message,
          status: failure.status,
          retryInMs: delay,
          pending: this.pending,
        });
      },
    );
  }

  private async request(utterance: Utterance): Promise<{ grammar: GrammarResponse; unparsedGroups: number }> {
    const { apiBaseUrl, requestTimeoutMs, sourceLang, targetProfile } = this.config;
    if (!apiBaseUrl || typeof fetch !== 'function') {
      throw new RequestError('No grammar server is configured.', null, false);
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), requestTimeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${apiBaseUrl}${TRANSLATE_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rawSpeechTokens: utterance.tokens, sourceLang, targetProfile }),
          signal: controller?.signal,
        });
      } catch {
        const message = controller?.signal.aborted
          ? `The grammar server did not answer within ${requestTimeoutMs} ms.`
          : `Could not reach the grammar server at ${apiBaseUrl}.`;
        throw new RequestError(message, null, true);
      }

      if (!response.ok) {
        const detail = await readDetail(response);
        const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        throw new RequestError(
          `The grammar server answered ${response.status}${detail ? `: ${detail}` : '.'}`,
          response.status,
          retryable,
        );
      }

      let grammar: GrammarResponse;
      try {
        grammar = (await response.json()) as GrammarResponse;
      } catch {
        throw new RequestError('The grammar server sent an unreadable answer.', response.status, false);
      }
      if (typeof grammar?.formattedText !== 'string' || !Array.isArray(grammar.originalTokens)) {
        throw new RequestError('The grammar server sent an unexpected answer.', response.status, false);
      }
      const unparsedGroups = Number(response.headers.get(UNPARSED_HEADER) ?? 0);
      return { grammar, unparsedGroups: Number.isFinite(unparsedGroups) ? unparsedGroups : 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}

let pipeline: SpeechPipeline | null = null;

function post(message: SpeechWorkerResponse): void {
  ctx.postMessage(message);
}

function fail(message: string): void {
  post({ type: 'error', message });
}

ctx.onmessage = (event: MessageEvent<SpeechWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      pipeline?.reset();
      pipeline = new SpeechPipeline(request.config ?? {}, post);
      post({ type: 'ready', config: pipeline.currentConfig });
      return;
    }
    if (request.type === 'close') {
      pipeline?.reset();
      pipeline = null;
      ctx.close();
      return;
    }
    if (!pipeline) {
      fail(`Worker received ${String((request as { type?: unknown }).type)} before init`);
      return;
    }

    switch (request.type) {
      case 'configure':
        pipeline.configure(request.config);
        break;
      case 'tokens':
        pipeline.tokens(request);
        break;
      case 'voice':
        pipeline.voice(request.active);
        break;
      case 'boundary':
        pipeline.boundary();
        break;
      case 'flush':
        pipeline.flush();
        break;
      case 'online':
        pipeline.online();
        break;
      case 'reset':
        pipeline.reset();
        break;
      default:
        fail(`Unknown request: ${String((request as { type?: unknown }).type)}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
};
