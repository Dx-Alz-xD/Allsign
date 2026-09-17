import { describe, expect, it } from 'vitest';
import { parseCaregiverMessage } from '../messages';

const telemetry = {
  timestamp: 1,
  volumeDb: -20,
  pitchHz: 120,
  spectralBins: Array.from({ length: 128 }, (_, i) => i / 128),
  jitterPercent: 0.5,
  shimmerDb: 0.3,
  hnrDb: 18,
  vocalStrainIndex: 22,
};
const fluency = { wpm: 120, vocalBlockDetected: false, blockDurationMs: 0, pitchVolatilityHz: 12, dafDelayMs: 0, fsfOctaveShift: 0 };
const grammar = {
  formattedText: 'I want water.',
  parsedTree: '(S (NP (PRP I)) (VP (VBP want) (NP (NN water))))',
  originalTokens: ['me', 'want', 'water'],
  executionLatencyMs: 1.8,
};

describe('parseCaregiverMessage', () => {
  it('accepts well-formed telemetry, alerts, and transcripts', () => {
    expect(parseCaregiverMessage({ type: 'telemetry', telemetry, fluency, latencyMs: 6 })).toEqual({
      type: 'telemetry',
      telemetry,
      fluency,
      latencyMs: 6,
    });
    const alert = { id: 'a1', kind: 'vocal-block', message: 'Vocal block detected', timestamp: 2, durationMs: 900 };
    expect(parseCaregiverMessage({ type: 'alert', alert })).toEqual({ type: 'alert', alert });
    const transcript = { id: 't1', source: 'manual', grammar, roundTripMs: 4.2, timestamp: 3 };
    expect(parseCaregiverMessage({ type: 'transcript', transcript })).toEqual({ type: 'transcript', transcript });
  });

  it('accepts a phone alert as the relay stamps it, and only a known origin', () => {
    const relayed = { id: 'phone-1a2b', kind: 'message', message: 'Please come here', timestamp: 5, origin: 'phone' };
    expect(parseCaregiverMessage({ type: 'alert', alert: relayed })).toEqual({ type: 'alert', alert: relayed });
    const parsed = parseCaregiverMessage({ type: 'alert', alert: { ...relayed, origin: 'satellite' } });
    expect(parsed).toEqual({ type: 'alert', alert: { id: 'phone-1a2b', kind: 'message', message: 'Please come here', timestamp: 5 } });
    expect(parseCaregiverMessage({ type: 'alert', alert: { ...relayed, kind: 'shout' } })).toBeNull();
  });

  it('drops extra fields instead of passing them through', () => {
    const parsed = parseCaregiverMessage({ type: 'alert', alert: { id: 'a', kind: 'emergency', message: 'Help', timestamp: 1, html: '<b>' } });
    expect(parsed).toEqual({ type: 'alert', alert: { id: 'a', kind: 'emergency', message: 'Help', timestamp: 1 } });
  });

  it('rejects a transcript mistaken for telemetry and telemetry that would break the HUD', () => {
    expect(parseCaregiverMessage({ type: 'telemetry', transcript: { id: 't' } })).toBeNull();
    expect(parseCaregiverMessage({ type: 'telemetry', telemetry: { ...telemetry, pitchHz: Number.NaN }, fluency, latencyMs: 1 })).toBeNull();
    expect(
      parseCaregiverMessage({ type: 'telemetry', telemetry: { ...telemetry, spectralBins: new Array(4096).fill(0) }, fluency, latencyMs: 1 }),
    ).toBeNull();
    expect(parseCaregiverMessage({ type: 'telemetry', telemetry: { ...telemetry, spectralBins: ['1'] }, fluency, latencyMs: 1 })).toBeNull();
    expect(parseCaregiverMessage({ type: 'telemetry', telemetry, fluency: { ...fluency, vocalBlockDetected: 'no' }, latencyMs: 1 })).toBeNull();
  });

  it('rejects unknown kinds, sources, types, and oversized content', () => {
    expect(parseCaregiverMessage({ type: 'alert', alert: { id: 'a', kind: 'popup', message: 'x', timestamp: 1 } })).toBeNull();
    expect(parseCaregiverMessage({ type: 'alert', alert: { id: 'a', kind: 'trigger', message: 'x'.repeat(501), timestamp: 1 } })).toBeNull();
    expect(parseCaregiverMessage({ type: 'transcript', transcript: { id: 't', source: 'cloud', grammar, roundTripMs: 1, timestamp: 1 } })).toBeNull();
    expect(
      parseCaregiverMessage({
        type: 'transcript',
        transcript: { id: 't', source: 'demo', grammar: { ...grammar, originalTokens: [42] }, roundTripMs: 1, timestamp: 1 },
      }),
    ).toBeNull();
    expect(parseCaregiverMessage({ type: 'command', run: 'rm -rf' })).toBeNull();
    expect(parseCaregiverMessage(null)).toBeNull();
    expect(parseCaregiverMessage([{ type: 'alert' }])).toBeNull();
  });
});
