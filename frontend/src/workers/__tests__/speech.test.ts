/**
 * speech.worker.ts: token stream segmentation and ordered delivery to POST /api/grammar/translate.
 * Timers and fetch are fakes, so every case is deterministic.
 */

import { describe, expect, it } from 'vitest';
import { loadWorker, tick } from './harness';

type Grammar = { formattedText: string; parsedTree: string; originalTokens: string[]; executionLatencyMs: number };
type Utterance = { id: number; requestId: string | null; tokens: string[]; source: string; reason: string; part: number; parts: number };
type Message = {
  type: string;
  message?: string;
  config?: Record<string, unknown>;
  tokens?: string[];
  source?: string;
  utterance?: Utterance;
  translation?: { utterance: Utterance; grammar: Grammar; unparsedGroups: number; roundTripMs: number; queuedMs: number; attempts: number };
  status?: number | null;
  retryInMs?: number | null;
  pending?: number;
};

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms = 0) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
  };
}

interface Call {
  url: string;
  body: { rawSpeechTokens: string[]; sourceLang: string; targetProfile: string };
  resolve: (response: unknown) => void;
  reject: (error: unknown) => void;
}

function fakeFetch() {
  const calls: Call[] = [];
  const fetch = (url: string, init: { body: string; signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      calls.push({ url, body: JSON.parse(init.body), resolve, reject });
    });
  return { fetch, calls };
}

const grammarFor = (tokens: string[], text = tokens.join(' ')): Grammar => ({
  formattedText: text,
  parsedTree: `(S ${text})`,
  originalTokens: tokens,
  executionLatencyMs: 1.5,
});

const ok = (grammar: Grammar, unparsed = 0) => ({
  ok: true,
  status: 200,
  headers: { get: (name: string) => (name.toLowerCase() === 'x-grammar-unparsed-groups' ? String(unparsed) : null) },
  json: async () => grammar,
});

const httpError = (status: number, body: unknown) => ({
  ok: false,
  status,
  headers: { get: () => null },
  json: async () => body,
});

function setup(config: Record<string, unknown> = {}) {
  const clock = fakeClock();
  const network = fakeFetch();
  const worker = loadWorker('speech.worker.ts', {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    fetch: network.fetch,
    AbortController,
    Date: { now: () => 1_000 },
  });
  worker.send({ type: 'init', config: { apiBaseUrl: 'http://backend.test/', ...config } });
  const ready = worker.drain()[0] as Message;
  const messages = () => worker.drain() as Message[];
  const submit = (tokens: string[], requestId?: string, source = 'manual') =>
    worker.send({ type: 'tokens', tokens, final: true, source, endOfUtterance: true, requestId });
  const dictate = (tokens: string[], final = true) => worker.send({ type: 'tokens', tokens, final, source: 'system-dictation' });
  return { worker, clock, network, ready, messages, submit, dictate };
}

const ofType = (messages: Message[], type: string) => messages.filter((m) => m.type === type);

describe('speech.worker', () => {
  it('starts with a normalised config', () => {
    const { ready } = setup({ maxUtteranceTokens: 999 });
    expect(ready.type).toBe('ready');
    expect(ready.config).toMatchObject({ apiBaseUrl: 'http://backend.test', maxUtteranceTokens: 256, targetProfile: 'clearvoice' });
  });

  it('translates a typed sentence and reports the round trip', async () => {
    const { network, messages, submit, worker } = setup();
    worker.send({ type: 'configure', config: { targetProfile: 'aphasia' } });
    submit(['um', 'me', ' ', 'w-w-water', 'want'], 'req-1');
    expect(network.calls).toHaveLength(1);
    expect(network.calls[0].url).toBe('http://backend.test/api/grammar/translate');
    expect(network.calls[0].body).toEqual({ rawSpeechTokens: ['um', 'me', 'w-w-water', 'want'], sourceLang: 'en', targetProfile: 'aphasia' });

    network.calls[0].resolve(ok(grammarFor(['um', 'me', 'w-w-water', 'want'], 'I want water.'), 1));
    await tick();
    const out = messages();
    expect(ofType(out, 'utterance')[0].utterance).toMatchObject({ requestId: 'req-1', reason: 'submitted', part: 1, parts: 1 });
    const [done] = ofType(out, 'translation');
    expect(done.translation?.grammar.formattedText).toBe('I want water.');
    expect(done.translation?.utterance.requestId).toBe('req-1');
    expect(done.translation?.unparsedGroups).toBe(1);
    expect(done.translation?.attempts).toBe(1);
    expect(done.translation?.roundTripMs).toBeGreaterThanOrEqual(0);
    expect(done.pending).toBe(0);
  });

  it('sends one request at a time and delivers sentences in order', async () => {
    const { network, messages, submit } = setup();
    submit(['first'], 'a');
    submit(['second'], 'b');
    submit(['third'], 'c');
    expect(network.calls).toHaveLength(1);

    network.calls[0].resolve(ok(grammarFor(['first'])));
    await tick();
    expect(network.calls).toHaveLength(2);
    expect(network.calls[1].body.rawSpeechTokens).toEqual(['second']);
    network.calls[1].resolve(ok(grammarFor(['second'])));
    await tick();
    network.calls[2].resolve(ok(grammarFor(['third'])));
    await tick();

    const order = ofType(messages(), 'translation').map((m) => m.translation?.utterance.requestId);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('groups dictated finals until the speaker goes quiet', () => {
    const { clock, network, messages, dictate } = setup({ idleFlushMs: 1000 });
    dictate(['I', 'want']);
    dictate(['wa'], false);
    const interim = ofType(messages(), 'interim');
    expect(interim.at(-1)?.tokens).toEqual(['I', 'want', 'wa']);

    clock.advance(600);
    dictate(['water']);
    clock.advance(900);
    expect(network.calls).toHaveLength(0);
    clock.advance(100);
    expect(network.calls).toHaveLength(1);
    expect(network.calls[0].body.rawSpeechTokens).toEqual(['I', 'want', 'water']);
    expect(ofType(messages(), 'utterance')[0].utterance?.reason).toBe('idle');
  });

  it('holds the idle flush while cadence reports an active utterance, then closes on the boundary', () => {
    const { clock, network, messages, dictate, worker } = setup({ idleFlushMs: 500 });
    worker.send({ type: 'voice', active: true });
    dictate(['me', 'w-w']);
    clock.advance(3000);
    expect(network.calls).toHaveLength(0);
    dictate(['water']);
    worker.send({ type: 'boundary' });
    expect(network.calls).toHaveLength(1);
    expect(network.calls[0].body.rawSpeechTokens).toEqual(['me', 'w-w', 'water']);
    expect(ofType(messages(), 'utterance')[0].utterance?.reason).toBe('boundary');
  });

  it('closes a streamed utterance when voice activity ends', () => {
    const { clock, network, dictate, worker } = setup({ idleFlushMs: 500 });
    worker.send({ type: 'voice', active: true });
    dictate(['hello']);
    clock.advance(2000);
    worker.send({ type: 'voice', active: false });
    clock.advance(500);
    expect(network.calls).toHaveLength(1);
  });

  it('closes the open utterance when the source changes', () => {
    const { network, messages, dictate, submit } = setup();
    dictate(['dictated', 'words']);
    submit(['typed'], 'typed-1');
    expect(network.calls.map((call) => call.body.rawSpeechTokens)).toEqual([['dictated', 'words']]);
    const reasons = ofType(messages(), 'utterance').map((m) => m.utterance?.reason);
    expect(reasons).toEqual(['source-changed', 'submitted']);
  });

  it('splits long input at the token limits', () => {
    const { network, messages, dictate, submit } = setup({ maxUtteranceTokens: 3 });
    dictate(['a', 'b', 'c', 'd']);
    expect(network.calls[0].body.rawSpeechTokens).toEqual(['a', 'b', 'c']);
    const streamed = ofType(messages(), 'utterance').map((m) => m.utterance!);
    expect(streamed.map((u) => [u.reason, u.part, u.parts, u.tokens.length])).toEqual([
      ['max-tokens', 1, 2, 3],
      ['max-tokens', 2, 2, 1],
    ]);

    const long = Array.from({ length: 300 }, (_, index) => `w${index}`);
    submit(long, 'long');
    const typed = ofType(messages(), 'utterance').map((m) => m.utterance!);
    expect(typed.map((u) => [u.requestId, u.part, u.parts, u.tokens.length])).toEqual([
      ['long', 1, 2, 256],
      ['long', 2, 2, 44],
    ]);
  });

  it('trims oversized tokens to the backend limit', () => {
    const { network, submit } = setup();
    submit(['x'.repeat(80)]);
    expect(network.calls[0].body.rawSpeechTokens[0]).toHaveLength(64);
  });

  it('retries dictation with backoff when the backend is unreachable', async () => {
    const { clock, network, messages, dictate, worker } = setup({ retryBaseMs: 500, retryMaxMs: 800 });
    dictate(['help', 'me']);
    worker.send({ type: 'flush' });
    network.calls[0].reject(new TypeError('Failed to fetch'));
    await tick();
    let failed = ofType(messages(), 'translationFailed');
    expect(failed[0]).toMatchObject({ retryInMs: 500, status: null, pending: 1 });
    expect(failed[0].message).toContain('Could not reach the grammar server');

    clock.advance(499);
    expect(network.calls).toHaveLength(1);
    clock.advance(1);
    expect(network.calls).toHaveLength(2);
    network.calls[1].resolve(httpError(503, { detail: 'warming up' }));
    await tick();
    failed = ofType(messages(), 'translationFailed');
    expect(failed[0]).toMatchObject({ retryInMs: 800, status: 503 });

    // A successful health check retries at once instead of waiting.
    worker.send({ type: 'online' });
    expect(network.calls).toHaveLength(3);
    network.calls[2].resolve(ok(grammarFor(['help', 'me'], 'Help me.')));
    await tick();
    const [done] = ofType(messages(), 'translation');
    expect(done.translation?.attempts).toBe(3);
  });

  it('fails typed sentences fast and moves on', async () => {
    const { network, messages, submit } = setup();
    submit(['first'], 'a');
    submit(['second'], 'b');
    network.calls[0].reject(new TypeError('Failed to fetch'));
    await tick();
    const [failed] = ofType(messages(), 'translationFailed');
    expect(failed).toMatchObject({ retryInMs: null, pending: 1 });
    expect(failed.utterance?.requestId).toBe('a');
    expect(network.calls[1].body.rawSpeechTokens).toEqual(['second']);
  });

  it('drops a sentence the backend rejects and shows why', async () => {
    const { network, messages, dictate, worker } = setup();
    dictate(['x']);
    worker.send({ type: 'flush' });
    network.calls[0].resolve(httpError(422, { detail: [{ msg: 'List should have at most 256 items' }, { msg: 'bad token' }] }));
    await tick();
    const [failed] = ofType(messages(), 'translationFailed');
    expect(failed).toMatchObject({ status: 422, retryInMs: null, pending: 0 });
    expect(failed.message).toBe('The grammar server answered 422: List should have at most 256 items; bad token');
  });

  it('times out a request that never answers', async () => {
    const { clock, network, messages, submit } = setup({ requestTimeoutMs: 2000 });
    submit(['slow']);
    clock.advance(2000);
    await tick();
    const [failed] = ofType(messages(), 'translationFailed');
    expect(failed.message).toBe('The grammar server did not answer within 2000 ms.');
    expect(network.calls).toHaveLength(1);
  });

  it('rejects an answer that is not a GrammarResponse', async () => {
    const { network, messages, submit } = setup();
    submit(['odd']);
    network.calls[0].resolve(ok({ nope: true } as unknown as Grammar));
    await tick();
    expect(ofType(messages(), 'translationFailed')[0].message).toBe('The grammar server sent an unexpected answer.');
  });

  it('drops the oldest waiting sentence when the queue is full', () => {
    const { messages, submit } = setup({ maxQueue: 2 });
    submit(['one']);
    submit(['two']);
    submit(['three']);
    submit(['four']);
    const dropped = ofType(messages(), 'dropped');
    expect(dropped.map((m) => m.utterance?.tokens)).toEqual([['two']]);
  });

  it('answers an empty submission instead of leaving the caller waiting', () => {
    const { network, messages, submit } = setup();
    submit(['  ', ''], 'empty');
    expect(network.calls).toHaveLength(0);
    const [dropped] = ofType(messages(), 'dropped');
    expect(dropped.utterance?.requestId).toBe('empty');
    expect(dropped.message).toBe('There are no words to rebuild.');
  });

  it('ignores answers to requests abandoned by reset', async () => {
    const { network, messages, submit, worker } = setup();
    submit(['stale']);
    worker.send({ type: 'reset' });
    network.calls[0].resolve(ok(grammarFor(['stale'])));
    await tick();
    expect(ofType(messages(), 'translation')).toHaveLength(0);
    submit(['fresh']);
    expect(network.calls).toHaveLength(2);
  });

  it('fails without a configured backend', async () => {
    const { messages, submit } = setup({ apiBaseUrl: '' });
    submit(['hello']);
    await tick();
    expect(ofType(messages(), 'translationFailed')[0].message).toBe('No grammar server is configured.');
  });

  it('reports requests that arrive before init', () => {
    const worker = loadWorker('speech.worker.ts', { clearTimeout, AbortController });
    worker.send({ type: 'tokens', tokens: ['x'], final: true, source: 'manual' });
    expect(worker.drain()).toEqual([{ type: 'error', message: 'Worker received tokens before init' }]);
  });
});
