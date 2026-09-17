/**
 * Broadcast queue for the caregiver data channel.
 *
 * Alerts and reconstructed sentences must reach the caregiver even when they
 * happen while the channel is still connecting or briefly down, so they wait
 * here and go out in order once it opens. Live telemetry is never queued: a
 * reading from a minute ago is not a live reading. Old entries expire, and
 * sending pauses while the channel's own send buffer is full.
 */

export interface OutboxChannel {
  readonly readyState: string;
  readonly bufferedAmount: number;
  send(data: string): void;
}

export interface OutboxOptions {
  maxEntries: number;
  maxAgeMs: number;
  /** Stop sending while the channel buffers more than this; resume on `bufferedamountlow`. */
  highWaterBytes: number;
  now: () => number;
}

export type Delivery = 'sent' | 'queued';

interface Entry {
  data: string;
  queuedAt: number;
}

const DEFAULT_OPTIONS: OutboxOptions = {
  maxEntries: 100,
  maxAgeMs: 5 * 60_000,
  highWaterBytes: 1 << 20,
  now: () => Date.now(),
};

export class Outbox {
  private readonly entries: Entry[] = [];
  private readonly options: OutboxOptions;
  /** Entries dropped because the queue was full or they expired. */
  dropped = 0;

  constructor(options: Partial<OutboxOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get size(): number {
    return this.entries.length;
  }

  /** Sends now when the channel is open and nothing is waiting ahead of it; otherwise queues. */
  deliver(data: string, channel: OutboxChannel | null): Delivery {
    if (channel && this.entries.length === 0 && this.writable(channel)) {
      channel.send(data);
      return 'sent';
    }
    this.entries.push({ data, queuedAt: this.options.now() });
    while (this.entries.length > this.options.maxEntries) {
      this.entries.shift();
      this.dropped++;
    }
    if (!channel) return 'queued';
    this.flush(channel);
    // The new entry is the newest, so it went out only if everything did.
    return this.entries.length === 0 ? 'sent' : 'queued';
  }

  /** Sends waiting entries, oldest first, until the queue is empty or the channel is not writable. */
  flush(channel: OutboxChannel): number {
    const oldest = this.options.now() - this.options.maxAgeMs;
    let sent = 0;
    while (this.entries.length > 0) {
      const entry = this.entries[0];
      if (entry.queuedAt < oldest) {
        this.entries.shift();
        this.dropped++;
        continue;
      }
      if (!this.writable(channel)) break;
      channel.send(entry.data);
      this.entries.shift();
      sent++;
    }
    return sent;
  }

  clear(): void {
    this.entries.length = 0;
  }

  private writable(channel: OutboxChannel): boolean {
    return channel.readyState === 'open' && channel.bufferedAmount <= this.options.highWaterBytes;
  }
}
