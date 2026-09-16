import type { AudioTelemetryFrame, FluencyMetrics } from '@shared/types';

/**
 * One render frame for the HUD. `telemetry` and `fluency` mirror the shared backend contract;
 * the remaining fields are frontend-only and never leave the renderer.
 */
export interface HudFrame {
  telemetry: AudioTelemetryFrame;
  fluency: FluencyMetrics;
  /** Time-domain samples in [-1, 1] for the oscilloscope trace. */
  waveform: Float32Array;
  /** Frequency at the top of `telemetry.spectralBins` (Nyquist). Bins hold normalized energy in [0, 1]. */
  spectrumMaxHz: number;
  /** End-to-end DSP processing latency for this frame. */
  latencyMs: number;
}

export interface BlockEvent {
  id: number;
  /** Epoch ms when the block was first detected. */
  startedAt: number;
  durationMs: number;
  ongoing: boolean;
}

/** Read side of the telemetry stream. Renderers poll `getFrame()` inside requestAnimationFrame. */
export interface TelemetrySource {
  getFrame(): HudFrame;
  /** Most recent first. A new array is returned whenever the list changes. */
  getBlockEvents(): readonly BlockEvent[];
  getBlockCount(): number;
}

/** Write side, fed by the DSP worker (or the simulated signal until that exists). */
export interface TelemetryStore extends TelemetrySource {
  push(frame: HudFrame): void;
}

export type PeerStatus = 'disconnected' | 'connecting' | 'connected';

export interface PeerLinkState {
  status: PeerStatus;
  peerLabel: string;
  roundTripMs: number | null;
}
