/**
 * Cuts the 16 kHz microphone stream into utterances for the recognizer.
 *
 * An energy gate with hangover: speech starts when a 10 ms chunk is louder than `openDb`, keeps a short
 * pre-roll so the first consonant is not lost, and ends after `closeMs` of quiet. A pause inside a stutter
 * is shorter than that, so a blocked word stays in one utterance. Utterances longer than `maxMs` are cut,
 * which keeps every one inside Whisper's 30 s window.
 */

export interface UtteranceRecorderOptions {
  sampleRate?: number;
  /** Chunk level, in dBFS, that opens the gate. */
  openDb?: number;
  /** Quiet needed to close it, in ms. */
  closeMs?: number;
  preRollMs?: number;
  /** Shorter utterances are dropped as noise. */
  minMs?: number;
  maxMs?: number;
  onUtterance: (audio: Float32Array, durationMs: number) => void;
}

const DEFAULTS = { sampleRate: 16_000, openDb: -42, closeMs: 700, preRollMs: 320, minMs: 350, maxMs: 26_000 };

export class UtteranceRecorder {
  private readonly options: Required<UtteranceRecorderOptions>;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private current: Float32Array[] = [];
  private currentSamples = 0;
  private quietMs = 0;
  private open = false;

  constructor(options: UtteranceRecorderOptions) {
    this.options = { ...DEFAULTS, ...options };
  }

  get active(): boolean {
    return this.open;
  }

  /** Feed one chunk of samples in [-1, 1]. */
  push(samples: Float32Array): void {
    const { sampleRate, openDb, closeMs, preRollMs, maxMs } = this.options;
    const chunkMs = (samples.length / sampleRate) * 1000;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const db = 10 * Math.log10(sum / Math.max(1, samples.length) + 1e-12);
    const loud = db > openDb;

    if (!this.open) {
      this.preRoll.push(samples.slice());
      this.preRollSamples += samples.length;
      const keep = (preRollMs / 1000) * sampleRate;
      while (this.preRollSamples > keep && this.preRoll.length > 1) {
        this.preRollSamples -= this.preRoll[0].length;
        this.preRoll.shift();
      }
      if (!loud) return;
      this.open = true;
      this.current = this.preRoll;
      this.currentSamples = this.preRollSamples;
      this.preRoll = [];
      this.preRollSamples = 0;
      this.quietMs = 0;
      return;
    }

    this.current.push(samples.slice());
    this.currentSamples += samples.length;
    this.quietMs = loud ? 0 : this.quietMs + chunkMs;
    const durationMs = (this.currentSamples / sampleRate) * 1000;
    if (this.quietMs >= closeMs || durationMs >= maxMs) this.finish();
  }

  /** Ends the current utterance now (the microphone stopped, recognition was switched off). */
  flush(): void {
    if (this.open) this.finish();
  }

  reset(): void {
    this.open = false;
    this.current = [];
    this.currentSamples = 0;
    this.preRoll = [];
    this.preRollSamples = 0;
    this.quietMs = 0;
  }

  private finish(): void {
    const { sampleRate, minMs, closeMs } = this.options;
    const chunks = this.current;
    const total = this.currentSamples;
    this.open = false;
    this.current = [];
    this.currentSamples = 0;
    // Drop most of the trailing quiet; keep a little so the last word is not clipped.
    const trailing = Math.max(0, this.quietMs - 200);
    this.quietMs = 0;
    const keep = Math.max(0, total - Math.floor((trailing / 1000) * sampleRate));
    const durationMs = (keep / sampleRate) * 1000;
    if (durationMs < minMs) return;
    const audio = new Float32Array(keep);
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= keep) break;
      const slice = chunk.subarray(0, Math.min(chunk.length, keep - offset));
      audio.set(slice, offset);
      offset += slice.length;
    }
    void closeMs;
    this.options.onUtterance(audio, Math.round(durationMs));
  }
}
