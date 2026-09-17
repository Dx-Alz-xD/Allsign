/**
 * Delivery helpers on the speech output path: the caregiver broadcast queue, the direct paste queue,
 * the sign manifest behind the Studio overlay, and HUD block counting.
 */

import { describe, expect, it } from 'vitest';
import { createSilentFrame, createTelemetryStore } from '../hud/store';
import { createPasteQueue, type PasteResult } from '../output/pasteQueue';
import { Outbox, type OutboxChannel } from '../peer/outbox';
import { EMPTY_SIGN_MANIFEST, parseSignManifest, signAssetUrl, signHoldMs, signTokens } from '../signs/manifest';

class FakeChannel implements OutboxChannel {
  readyState = 'connecting';
  bufferedAmount = 0;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}

describe('Outbox', () => {
  it('sends straight through an open channel', () => {
    const outbox = new Outbox();
    const channel = new FakeChannel();
    channel.readyState = 'open';
    expect(outbox.deliver('a', channel)).toBe('sent');
    expect(channel.sent).toEqual(['a']);
    expect(outbox.size).toBe(0);
  });

  it('queues until the channel opens, then sends in order', () => {
    const outbox = new Outbox();
    const channel = new FakeChannel();
    expect(outbox.deliver('a', null)).toBe('queued');
    expect(outbox.deliver('b', channel)).toBe('queued');
    expect(channel.sent).toEqual([]);
    channel.readyState = 'open';
    // Something new never jumps the queue.
    expect(outbox.deliver('c', channel)).toBe('sent');
    expect(channel.sent).toEqual(['a', 'b', 'c']);
  });

  it('pauses while the channel buffer is full', () => {
    const outbox = new Outbox({ highWaterBytes: 10 });
    const channel = new FakeChannel();
    channel.readyState = 'open';
    channel.bufferedAmount = 11;
    expect(outbox.deliver('a', channel)).toBe('queued');
    channel.bufferedAmount = 0;
    expect(outbox.flush(channel)).toBe(1);
    expect(channel.sent).toEqual(['a']);
  });

  it('drops the oldest entries when full and expires stale ones', () => {
    let now = 0;
    const outbox = new Outbox({ maxEntries: 2, maxAgeMs: 1000, now: () => now });
    outbox.deliver('a', null);
    outbox.deliver('b', null);
    outbox.deliver('c', null);
    expect(outbox.dropped).toBe(1);
    now = 500;
    outbox.deliver('d', null);
    expect(outbox.dropped).toBe(2);
    now = 1200;
    const channel = new FakeChannel();
    channel.readyState = 'open';
    outbox.flush(channel);
    // 'c' was queued at 0 and is older than a second; 'd' is not.
    expect(channel.sent).toEqual(['d']);
    expect(outbox.dropped).toBe(3);
    outbox.deliver('e', null);
    outbox.clear();
    expect(outbox.size).toBe(0);
  });
});

describe('createPasteQueue', () => {
  function setup(results: PasteResult[] = []) {
    let now = 0;
    const typed: string[] = [];
    const outcomes: Array<{ ok: boolean; text: string; typed: string }> = [];
    const resolvers: Array<() => void> = [];
    const queue = createPasteQueue({
      type: (text) => {
        typed.push(text);
        const result = results.shift() ?? { ok: true, detail: 'typed' };
        return new Promise((resolve) => resolvers.push(() => resolve(result)));
      },
      onOutcome: (outcome) => outcomes.push(outcome),
      continueWithinMs: 1000,
      now: () => now,
    });
    const finishNext = async () => {
      await Promise.resolve();
      resolvers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { queue, typed, outcomes, finishNext, setNow: (value: number) => (now = value) };
  }

  it('types one sentence at a time, in order, with a space between them', async () => {
    const { queue, typed, outcomes, finishNext } = setup();
    queue.enqueue(' I want water. ');
    queue.enqueue('Thank you.');
    queue.enqueue('   ');
    expect(queue.pending).toBe(2);
    await finishNext();
    expect(typed).toEqual(['I want water.', ' Thank you.']);
    await finishNext();
    await queue.idle();
    expect(outcomes.map((outcome) => outcome.typed)).toEqual(['I want water.', ' Thank you.']);
    expect(queue.pending).toBe(0);
  });

  it('starts fresh after a pause, after restart, and after a failure', async () => {
    const { queue, typed, finishNext, setNow } = setup([
      { ok: true, detail: '' },
      { ok: true, detail: '' },
      { ok: true, detail: '' },
      { ok: false, detail: 'denied' },
      { ok: true, detail: '' },
    ]);
    queue.enqueue('One.');
    await finishNext();
    setNow(2000);
    queue.enqueue('Two.');
    await finishNext();
    queue.restart();
    queue.enqueue('Three.');
    await finishNext();
    setNow(2500);
    queue.enqueue('Four.');
    await finishNext();
    // Four failed, so the last text that reached the app is still Three, typed at 2000.
    setNow(3500);
    queue.enqueue('Five.');
    await finishNext();
    await queue.idle();
    expect(typed).toEqual(['One.', 'Two.', 'Three.', ' Four.', 'Five.']);
  });

  it('reports a bridge that throws as a failed paste', async () => {
    const outcomes: Array<{ ok: boolean; detail: string }> = [];
    const queue = createPasteQueue({
      type: () => Promise.reject(new Error('no desktop bridge')),
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    queue.enqueue('Hello.');
    await queue.idle();
    expect(outcomes).toEqual([{ ok: false, detail: 'no desktop bridge', text: 'Hello.', typed: 'Hello.' }]);
  });
});

describe('sign manifest', () => {
  const manifest = parseSignManifest({
    version: 1,
    language: 'ASL',
    attribution: 'Test photos',
    signs: {
      Water: { image: 'water.jpg', alt: 'Sign for water', credit: 'Tester, CC0' },
      shoe: { image: 'shoe.png', alt: 'Sign for shoe' },
      want: { image: '../secret.png', alt: 'escapes the folder' },
      go: { image: 'go.exe', alt: 'not an image' },
      help: { image: 'help.png', alt: '' },
      mom: 'not an object',
    },
  });

  it('keeps only safe, described photos', () => {
    expect(manifest.language).toBe('ASL');
    expect(Object.keys(manifest.signs).sort()).toEqual(['shoe', 'water']);
    expect(manifest.signs.water).toEqual({ image: 'water.jpg', alt: 'Sign for water', credit: 'Tester, CC0' });
    expect(manifest.signs.shoe.credit).toBe('');
    expect(parseSignManifest({ version: 2, signs: manifest.signs })).toEqual(EMPTY_SIGN_MANIFEST);
    expect(parseSignManifest('nonsense')).toEqual(EMPTY_SIGN_MANIFEST);
  });

  it('maps a sentence to sign tokens without guessing', () => {
    const tokens = signTokens('Where are my shoes? I want water.', manifest);
    expect(tokens.map((token) => [token.display, token.signed, token.entry?.image ?? null])).toEqual([
      ['Where', true, null],
      ['are', false, null],
      ['my', true, null],
      ['shoes', true, 'shoe.png'],
      ['I', true, null],
      ['want', true, null],
      ['water', true, 'water.jpg'],
    ]);
    expect(signTokens("Mom's water, please!", manifest).map((token) => token.key)).toEqual(["mom's", 'water', 'please']);
    expect(signTokens(' ... ', manifest)).toEqual([]);
  });

  it('holds each sign for one word at the speaking rate, within bounds', () => {
    expect(signHoldMs(120)).toBe(500);
    expect(signHoldMs(30)).toBe(1400);
    expect(signHoldMs(400)).toBe(450);
    expect(signHoldMs(0)).toBe(500);
    expect(signHoldMs(Number.NaN)).toBe(500);
  });

  it('resolves photos inside public/signs', () => {
    expect(signAssetUrl('water.jpg', 'app://omnivoice/')).toBe('app://omnivoice/signs/water.jpg');
    expect(signAssetUrl('water.jpg', 'http://localhost:3000/index.html')).toBe('http://localhost:3000/signs/water.jpg');
  });
});

describe('telemetry store block count', () => {
  function frame(blocked: boolean, blockCount?: number, durationMs = 0) {
    const base = createSilentFrame();
    return { ...base, fluency: { ...base.fluency, vocalBlockDetected: blocked, blockDurationMs: durationMs }, blockCount };
  }

  it('withdraws a block that turned out to be the end of the utterance', () => {
    const store = createTelemetryStore();
    store.push(frame(true, 1, 400));
    store.push(frame(false, 1, 700));
    expect(store.getBlockCount()).toBe(1);
    expect(store.getBlockEvents().map((event) => event.ongoing)).toEqual([false]);

    store.push(frame(true, 2, 400));
    expect(store.getBlockCount()).toBe(2);
    store.push(frame(false, 1, 700));
    expect(store.getBlockCount()).toBe(1);
    expect(store.getBlockEvents()).toHaveLength(1);
  });

  it('counts every block when the source has no count of its own', () => {
    const store = createTelemetryStore();
    store.push(frame(true));
    store.push(frame(false));
    store.push(frame(true));
    expect(store.getBlockCount()).toBe(2);
    const ids = store.getBlockEvents().map((event) => event.id);
    expect(new Set(ids).size).toBe(2);
  });
});
