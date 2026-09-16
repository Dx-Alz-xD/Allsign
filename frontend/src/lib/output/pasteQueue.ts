/**
 * Ordered hand-off of reconstructed sentences to direct paste
 * (electron/directPaste.ts through the preload bridge).
 *
 * Sentences are typed one after another, never interleaved, in the order the
 * grammar engine returned them. Consecutive sentences get a space between
 * them; after `continueWithinMs` of quiet, or after `restart()` (direct paste
 * switched on again), the next sentence starts without one, because the
 * person has probably moved to another text field by then.
 */

export interface PasteResult {
  ok: boolean;
  detail: string;
}

export interface PasteOutcome extends PasteResult {
  /** The sentence as queued, without the separator. */
  text: string;
  /** What was actually sent to the bridge. */
  typed: string;
}

export interface PasteQueueOptions {
  type: (text: string) => Promise<PasteResult>;
  onOutcome: (outcome: PasteOutcome) => void;
  continueWithinMs?: number;
  now?: () => number;
}

export interface PasteQueue {
  enqueue(text: string): void;
  restart(): void;
  readonly pending: number;
  /** Resolves when everything queued so far has been attempted. */
  idle(): Promise<void>;
}

export function createPasteQueue({ type, onOutcome, continueWithinMs = 30_000, now = () => Date.now() }: PasteQueueOptions): PasteQueue {
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let lastTypedAt: number | null = null;

  return {
    enqueue(text) {
      const sentence = text.trim();
      if (!sentence) return;
      pending++;
      chain = chain.then(async () => {
        const continuing = lastTypedAt !== null && now() - lastTypedAt <= continueWithinMs;
        const typed = continuing ? ` ${sentence}` : sentence;
        let result: PasteResult;
        try {
          result = await type(typed);
        } catch (error) {
          result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
        }
        if (result.ok) lastTypedAt = now();
        pending--;
        onOutcome({ ...result, text: sentence, typed });
      });
    },
    restart() {
      lastTypedAt = null;
    },
    get pending() {
      return pending;
    },
    idle() {
      return chain;
    },
  };
}
