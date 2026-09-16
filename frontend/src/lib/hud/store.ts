import type { BlockEvent, HudFrame, TelemetryStore } from '@/lib/hud/types';

export const SPECTRAL_BIN_COUNT = 128;
const MAX_BLOCK_EVENTS = 20;

export function createSilentFrame(waveformSize = 512, spectrumMaxHz = 8000): HudFrame {
  return {
    telemetry: {
      timestamp: 0,
      volumeDb: -60,
      pitchHz: 0,
      spectralBins: new Array<number>(SPECTRAL_BIN_COUNT).fill(0),
      jitterPercent: 0,
      shimmerDb: 0,
      hnrDb: 0,
      vocalStrainIndex: 0,
    },
    fluency: {
      wpm: 0,
      vocalBlockDetected: false,
      blockDurationMs: 0,
      pitchVolatilityHz: 0,
      dafDelayMs: 0,
      fsfOctaveShift: 0,
    },
    waveform: new Float32Array(waveformSize),
    spectrumMaxHz,
    latencyMs: 0,
  };
}

export function createTelemetryStore(initial: HudFrame = createSilentFrame()): TelemetryStore {
  let frame = initial;
  let blockCount = 0;
  let nextEventId = 1;
  let blocks: readonly BlockEvent[] = [];

  return {
    getFrame: () => frame,
    getBlockEvents: () => blocks,
    getBlockCount: () => blockCount,

    push(next) {
      const wasBlocked = frame.fluency.vocalBlockDetected;
      const isBlocked = next.fluency.vocalBlockDetected;
      const [latest, ...rest] = blocks;
      // A block that ends with the count going down was the end of the utterance, not a block.
      const withdrawn = next.blockCount !== undefined && next.blockCount < (frame.blockCount ?? 0);

      if (isBlocked && !wasBlocked) {
        blockCount += 1;
        const event: BlockEvent = {
          id: nextEventId++,
          startedAt: next.telemetry.timestamp,
          durationMs: next.fluency.blockDurationMs,
          ongoing: true,
        };
        blocks = [event, ...blocks].slice(0, MAX_BLOCK_EVENTS);
      } else if (latest?.ongoing && isBlocked) {
        blocks = [{ ...latest, durationMs: next.fluency.blockDurationMs }, ...rest];
      } else if (latest?.ongoing && !isBlocked) {
        blocks = withdrawn ? rest : [{ ...latest, ongoing: false }, ...rest];
      }
      if (next.blockCount !== undefined) blockCount = next.blockCount;

      frame = next;
    },
  };
}
