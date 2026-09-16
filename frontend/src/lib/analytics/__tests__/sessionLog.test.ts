import { describe, expect, it } from 'vitest';
import { MAX_SAMPLES, SessionLogRecorder, type BiomarkerReading } from '../sessionLog';

const voiced: BiomarkerReading = {
  voiced: true,
  biomarkersReady: true,
  jitterPercent: 0.8,
  shimmerDb: 0.3,
  hnrDb: 18,
  strainIndex: 40,
  pitchHz: 120,
};

describe('SessionLogRecorder', () => {
  it('samples voiced audio once a second, timed from the session start', () => {
    const recorder = new SessionLogRecorder();
    recorder.sample(voiced, 0); // before start: ignored
    recorder.start(10_000, '2026-09-17T10:00:00.000Z');
    recorder.sample(voiced, 10_000);
    recorder.sample(voiced, 10_400); // too soon
    recorder.sample({ ...voiced, voiced: false }, 11_000); // silence
    recorder.sample({ ...voiced, pitchHz: 0, jitterPercent: Number.NaN, strainIndex: 180 }, 11_200);
    const log = recorder.toLog('fluency', 900, 12_000);
    expect(log.samples.map((sample) => sample.timestamp)).toEqual([0, 1200]);
    expect(log.samples[1]).toMatchObject({ pitchHz: null, jitterPercent: 0, strainIndex: 100 });
    expect(log).toMatchObject({ startedAt: '2026-09-17T10:00:00.000Z', profileMode: 'fluency', speakingMs: 900 });
  });

  it('logs feedback activations and blocks the way the report counts them', () => {
    const recorder = new SessionLogRecorder();
    recorder.feedbackChanged(true, 60, 0, 0); // on before the session: logged at its start
    recorder.start(1000);
    recorder.block(700, 2000);
    recorder.feedbackChanged(true, 60, 0, 2500); // unchanged
    recorder.feedbackChanged(true, 60, -0.5, 3000); // only the shift changed
    recorder.feedbackChanged(false, 60, -0.5, 4000); // switching off is not an activation
    recorder.feedbackChanged(true, 60, -0.5, 5000);
    const log = recorder.toLog('fluency', null, 6000);
    expect(log.events).toEqual([
      { timestamp: 0, kind: 'daf', value: 60 },
      { timestamp: 1000, kind: 'block', value: 700 },
      { timestamp: 2000, kind: 'fsf', value: -0.5 },
      { timestamp: 4000, kind: 'daf', value: 60 },
      { timestamp: 4000, kind: 'fsf', value: -0.5 },
    ]);
    expect(log).toMatchObject({ dafDelayMs: 60, fsfOctaveShift: -0.5, speakingMs: 5000 });
  });

  it('stays inside the backend limits', () => {
    const recorder = new SessionLogRecorder();
    recorder.start(0);
    for (let second = 0; second < MAX_SAMPLES + 10; second++) recorder.sample(voiced, second * 1000);
    expect(recorder.sampleCount).toBe(MAX_SAMPLES);
  });
});
