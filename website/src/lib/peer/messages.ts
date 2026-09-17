/**
 * Validation for messages arriving over the caregiver data channel.
 *
 * The other device is a separate app instance, so everything it sends is
 * checked before it reaches the HUD: a malformed telemetry frame would
 * otherwise throw inside the canvas render loop, and an unbounded string or
 * array would grow the UI without limit.
 */

import type {
  AudioTelemetryFrame,
  CaregiverAlert,
  CaregiverMessage,
  CaregiverTranscript,
  FluencyMetrics,
  GrammarResponse,
  SpeechSource,
} from '@shared/types';

const MAX_SPECTRAL_BINS = 128;
const MAX_ID_CHARS = 128;
const MAX_ALERT_CHARS = 500;
const MAX_SENTENCE_CHARS = 4000;
const MAX_TREE_CHARS = 20_000;
const MAX_TOKENS = 256;
const MAX_TOKEN_CHARS = 64;

const ALERT_KINDS: ReadonlySet<CaregiverAlert['kind']> = new Set(['vocal-block', 'fatigue', 'emergency', 'trigger']);
const SPEECH_SOURCES: ReadonlySet<SpeechSource> = new Set(['manual', 'system-dictation', 'demo']);

type Record_ = Record<string, unknown>;

const isRecord = (value: unknown): value is Record_ => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

function parseTelemetry(value: unknown): AudioTelemetryFrame | null {
  if (!isRecord(value)) return null;
  const { timestamp, volumeDb, pitchHz, spectralBins, jitterPercent, shimmerDb, hnrDb, vocalStrainIndex } = value;
  if (![timestamp, volumeDb, pitchHz, jitterPercent, shimmerDb, hnrDb, vocalStrainIndex].every(finite)) return null;
  if (!Array.isArray(spectralBins) || spectralBins.length > MAX_SPECTRAL_BINS || !spectralBins.every(finite)) return null;
  return {
    timestamp: timestamp as number,
    volumeDb: volumeDb as number,
    pitchHz: pitchHz as number,
    spectralBins: spectralBins as number[],
    jitterPercent: jitterPercent as number,
    shimmerDb: shimmerDb as number,
    hnrDb: hnrDb as number,
    vocalStrainIndex: vocalStrainIndex as number,
  };
}

function parseFluency(value: unknown): FluencyMetrics | null {
  if (!isRecord(value)) return null;
  const { wpm, vocalBlockDetected, blockDurationMs, pitchVolatilityHz, dafDelayMs, fsfOctaveShift } = value;
  if (typeof vocalBlockDetected !== 'boolean') return null;
  if (![wpm, blockDurationMs, pitchVolatilityHz, dafDelayMs, fsfOctaveShift].every(finite)) return null;
  return {
    wpm: wpm as number,
    vocalBlockDetected,
    blockDurationMs: blockDurationMs as number,
    pitchVolatilityHz: pitchVolatilityHz as number,
    dafDelayMs: dafDelayMs as number,
    fsfOctaveShift: fsfOctaveShift as number,
  };
}

function parseAlert(value: unknown): CaregiverAlert | null {
  if (!isRecord(value)) return null;
  const { id, kind, message, timestamp, durationMs } = value;
  if (!boundedString(id, MAX_ID_CHARS) || !boundedString(message, MAX_ALERT_CHARS) || !finite(timestamp)) return null;
  if (typeof kind !== 'string' || !ALERT_KINDS.has(kind as CaregiverAlert['kind'])) return null;
  if (durationMs !== undefined && !finite(durationMs)) return null;
  return {
    id,
    kind: kind as CaregiverAlert['kind'],
    message,
    timestamp,
    ...(durationMs !== undefined ? { durationMs: durationMs as number } : {}),
  };
}

export function parseGrammarResponse(value: unknown): GrammarResponse | null {
  if (!isRecord(value)) return null;
  const { formattedText, parsedTree, originalTokens, executionLatencyMs } = value;
  if (!boundedString(formattedText, MAX_SENTENCE_CHARS) || !boundedString(parsedTree, MAX_TREE_CHARS)) return null;
  if (!finite(executionLatencyMs)) return null;
  if (
    !Array.isArray(originalTokens) ||
    originalTokens.length > MAX_TOKENS ||
    !originalTokens.every((token) => boundedString(token, MAX_TOKEN_CHARS))
  ) {
    return null;
  }
  return { formattedText, parsedTree, originalTokens: originalTokens as string[], executionLatencyMs };
}

function parseTranscript(value: unknown): CaregiverTranscript | null {
  if (!isRecord(value)) return null;
  const { id, source, grammar, roundTripMs, timestamp } = value;
  if (!boundedString(id, MAX_ID_CHARS) || !finite(roundTripMs) || !finite(timestamp)) return null;
  if (typeof source !== 'string' || !SPEECH_SOURCES.has(source as SpeechSource)) return null;
  const parsedGrammar = parseGrammarResponse(grammar);
  if (!parsedGrammar) return null;
  return { id, source: source as SpeechSource, grammar: parsedGrammar, roundTripMs, timestamp };
}

/** Returns a well-formed CaregiverMessage, or null for anything else. */
export function parseCaregiverMessage(value: unknown): CaregiverMessage | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'telemetry': {
      const telemetry = parseTelemetry(value.telemetry);
      const fluency = parseFluency(value.fluency);
      if (!telemetry || !fluency || !finite(value.latencyMs)) return null;
      return { type: 'telemetry', telemetry, fluency, latencyMs: value.latencyMs };
    }
    case 'alert': {
      const alert = parseAlert(value.alert);
      return alert ? { type: 'alert', alert } : null;
    }
    case 'transcript': {
      const transcript = parseTranscript(value.transcript);
      return transcript ? { type: 'transcript', transcript } : null;
    }
    default:
      return null;
  }
}
