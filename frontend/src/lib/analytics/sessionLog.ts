import type { FeedbackEvent, ProfileMode, SessionLog, StrainSample } from '@shared/types';

/**
 * Collects what the clinical report agent reads (POST /api/agent/generate-report): one biomarker sample per
 * second of voiced audio, plus feedback changes and vocal blocks, all timed from the start of the session.
 * Nothing leaves the computer until someone asks for a report.
 */

export const SAMPLE_INTERVAL_MS = 1000;
// The backend accepts at most 20 000 samples and 5 000 events; an hour of speech stays well inside that.
export const MAX_SAMPLES = 20_000;
export const MAX_EVENTS = 5_000;

export interface BiomarkerReading {
  voiced: boolean;
  biomarkersReady: boolean;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  strainIndex: number;
  pitchHz: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

export class SessionLogRecorder {
  private startedAt = 0;
  private startedIso: string | null = null;
  private lastSampleAt = -Infinity;
  private samples: StrainSample[] = [];
  private events: FeedbackEvent[] = [];
  private feedback = { enabled: false, dafDelayMs: 0, fsfOctaveShift: 0 };

  start(now: number, iso = new Date().toISOString()): void {
    this.startedAt = now;
    this.startedIso = iso;
    this.lastSampleAt = -Infinity;
    this.samples = [];
    this.events = [];
    // Feedback that was already on counts from the first moment of the session.
    if (this.feedback.enabled) this.logFeedback(now, this.feedback.dafDelayMs, this.feedback.fsfOctaveShift);
  }

  get started(): boolean {
    return this.startedIso !== null;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  sample(reading: BiomarkerReading, now: number): void {
    if (!this.started || !reading.voiced || !reading.biomarkersReady) return;
    if (now - this.lastSampleAt < SAMPLE_INTERVAL_MS || this.samples.length >= MAX_SAMPLES) return;
    this.lastSampleAt = now;
    this.samples.push({
      timestamp: this.elapsed(now),
      jitterPercent: clamp(reading.jitterPercent, 0, 100),
      shimmerDb: clamp(reading.shimmerDb, 0, 60),
      hnrDb: clamp(reading.hnrDb, -20, 60),
      strainIndex: clamp(reading.strainIndex, 0, 100),
      pitchHz: reading.pitchHz > 0 ? clamp(reading.pitchHz, 0, 2000) : null,
    });
  }

  block(durationMs: number, now: number): void {
    this.push({ timestamp: this.elapsed(now), kind: 'block', value: Math.max(0, durationMs) });
  }

  /**
   * Feedback switched on or retuned. The report counts each daf/fsf event as an activation and times its
   * before/after comparison from the first one, so switching off and settings left at zero are not logged.
   */
  feedbackChanged(enabled: boolean, dafDelayMs: number, fsfOctaveShift: number, now: number): void {
    const previous = this.feedback;
    this.feedback = { enabled, dafDelayMs, fsfOctaveShift };
    if (!this.started || !enabled) return;
    if (previous.enabled && previous.dafDelayMs === dafDelayMs && previous.fsfOctaveShift === fsfOctaveShift) return;
    this.logFeedback(now, previous.enabled && previous.dafDelayMs === dafDelayMs ? 0 : dafDelayMs, previous.enabled && previous.fsfOctaveShift === fsfOctaveShift ? 0 : fsfOctaveShift);
  }

  toLog(profileMode: ProfileMode, speakingMs: number | null, now: number): SessionLog {
    return {
      startedAt: this.startedIso,
      profileMode,
      samples: [...this.samples],
      events: [...this.events],
      dafDelayMs: this.feedback.enabled ? clamp(this.feedback.dafDelayMs, 0, 1000) : 0,
      fsfOctaveShift: this.feedback.enabled ? clamp(this.feedback.fsfOctaveShift, -1, 1) : 0,
      speakingMs: speakingMs === null ? Math.max(0, now - this.startedAt) : Math.max(0, speakingMs),
    };
  }

  /** Logs the settings that are in effect and non-zero; a zero means that one did not change or is off. */
  private logFeedback(now: number, dafDelayMs: number, fsfOctaveShift: number): void {
    const timestamp = this.elapsed(now);
    if (dafDelayMs > 0) this.push({ timestamp, kind: 'daf', value: clamp(dafDelayMs, 0, 1000) });
    if (fsfOctaveShift !== 0) this.push({ timestamp, kind: 'fsf', value: clamp(fsfOctaveShift, -1, 1) });
  }

  private push(event: FeedbackEvent): void {
    if (this.started && this.events.length < MAX_EVENTS) this.events.push(event);
  }

  private elapsed(now: number): number {
    return Math.max(0, Math.round(now - this.startedAt));
  }
}
