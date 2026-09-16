'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type {
  AudioAnalysisFrame,
  AudioWorkerRequest,
  AudioWorkerResponse,
  AudioWorkerConfig,
} from '@/workers/audio.worker';
import type {
  BiomarkerRequest,
  BiomarkerResponse,
} from '@/workers/biomarker.worker';
import type { AudioTelemetryFrame } from '@shared/types';

/**
 * Hot-path snapshot. Held in a ref and mutated in place so the DSP cadence
 * never triggers a React render; the HUD reads it from its own rAF loop.
 */
export interface PipelineSnapshot {
  timestamp: number;
  rms: number;
  volumeDb: number;
  zcr: number;
  pitchHz: number;
  pitchConfidence: number;
  voiced: boolean;
  /** Stable hook-owned array. Never the worker's transferable. */
  spectralBins: Float32Array;
  processingMs: number;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  vocalStrainIndex: number;
  biomarkersReady: boolean;
  frameCount: number;
}

export type PipelineStatus = 'idle' | 'running' | 'error';

export interface UseAudioPipelineOptions {
  /**
   * Must inline the literal constructor so the bundler can statically find the
   * worker chunk: `() => new Worker(new URL('@/workers/audio.worker.ts', import.meta.url))`.
   */
  createAudioWorker: () => Worker;
  /** Omit until biomarker.worker.ts exists; telemetry stays null while absent. */
  createBiomarkerWorker?: () => Worker;
  config?: Partial<AudioWorkerConfig>;
  /** Called for every frame, before its spectral buffer is recycled. */
  onFrame?: (frame: Readonly<PipelineSnapshot>) => void;
  onError?: (message: string) => void;
}

export interface AudioPipeline {
  status: PipelineStatus;
  error: string | null;
  snapshotRef: MutableRefObject<PipelineSnapshot>;
  pushPcm: (samples: Float32Array) => void;
  getTelemetryFrame: () => AudioTelemetryFrame | null;
  reset: () => void;
}

const SPECTRAL_BIN_COUNT = 128;
const MAX_POOLED_INPUTS = 8;

function createSnapshot(binCount: number): PipelineSnapshot {
  return {
    timestamp: 0,
    rms: 0,
    volumeDb: -120,
    zcr: 0,
    pitchHz: 0,
    pitchConfidence: 0,
    voiced: false,
    spectralBins: new Float32Array(binCount),
    processingMs: 0,
    jitterPercent: 0,
    shimmerDb: 0,
    hnrDb: 0,
    vocalStrainIndex: 0,
    biomarkersReady: false,
    frameCount: 0,
  };
}

export function useAudioPipeline(options: UseAudioPipelineOptions): AudioPipeline {
  const {
    createAudioWorker,
    createBiomarkerWorker,
    config,
    onFrame,
    onError,
  } = options;

  const binCount = config?.spectralBinCount ?? SPECTRAL_BIN_COUNT;

  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const snapshotRef = useRef<PipelineSnapshot>(createSnapshot(binCount));
  const audioWorkerRef = useRef<Worker | null>(null);
  const biomarkerWorkerRef = useRef<Worker | null>(null);
  const inputPoolRef = useRef<ArrayBuffer[]>([]);
  const aliveRef = useRef(false);

  // Read through refs so a caller passing inline closures cannot tear down workers.
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  onFrameRef.current = onFrame;
  onErrorRef.current = onError;

  const fail = useCallback((message: string) => {
    if (!aliveRef.current) return;
    setStatus('error');
    setError(message);
    onErrorRef.current?.(message);
  }, []);

  useEffect(() => {
    aliveRef.current = true;

    const snapshot = snapshotRef.current;
    if (snapshot.spectralBins.length !== binCount) {
      snapshot.spectralBins = new Float32Array(binCount);
    }

    const audioWorker = createAudioWorker();
    audioWorkerRef.current = audioWorker;

    const biomarkerWorker = createBiomarkerWorker?.() ?? null;
    biomarkerWorkerRef.current = biomarkerWorker;

    audioWorker.onmessage = (event: MessageEvent<AudioWorkerResponse>) => {
      const message = event.data;

      if (message.type === 'error') {
        fail(message.message);
        return;
      }
      if (message.type === 'ready') {
        if (aliveRef.current) {
          setStatus('running');
          setError(null);
        }
        return;
      }

      const { frames, buffer } = message;

      // The PCM buffer came back detached-on-our-side only if we transferred it;
      // the worker returns ownership, so park it for the next pushPcm.
      if (buffer.byteLength > 0 && inputPoolRef.current.length < MAX_POOLED_INPUTS) {
        inputPoolRef.current.push(buffer);
      }

      if (frames.length === 0) return;

      const recycled: ArrayBuffer[] = [];
      for (const frame of frames) {
        // Copy before recycling: postMessage-with-transfer detaches the array,
        // so anything read later (a rAF repaint) would see a zero-length view.
        applyFrame(snapshot, frame);
        onFrameRef.current?.(snapshot);

        if (frame.spectralBins.byteLength > 0) {
          // Always a plain ArrayBuffer; the worker never allocates bins shared.
          recycled.push(frame.spectralBins.buffer as ArrayBuffer);
        }
      }

      if (recycled.length > 0) {
        const request: AudioWorkerRequest = { type: 'recycle', buffers: recycled };
        audioWorker.postMessage(request, recycled);
      }
    };

    audioWorker.onerror = (event: ErrorEvent) => {
      fail(event.message || 'audio.worker failed to load');
    };

    const initRequest: AudioWorkerRequest = { type: 'init', config };
    audioWorker.postMessage(initRequest);

    if (biomarkerWorker) {
      // PCM flows worker-to-worker over this channel; the main thread only
      // hands over the two ends and then stays out of the audio path.
      const channel = new MessageChannel();
      const connectAudio: AudioWorkerRequest = { type: 'connect', port: channel.port1 };
      audioWorker.postMessage(connectAudio, [channel.port1]);
      const connectBiomarker: BiomarkerRequest = { type: 'connect', port: channel.port2 };
      biomarkerWorker.postMessage(connectBiomarker, [channel.port2]);

      biomarkerWorker.onmessage = (event: MessageEvent<BiomarkerResponse>) => {
        const message = event.data;
        if (message.type === 'error') {
          fail(message.message);
          return;
        }
        if (message.type !== 'biomarkers') return;

        const { payload } = message;
        const target = snapshotRef.current;
        target.jitterPercent = payload.jitterPercent;
        target.shimmerDb = payload.shimmerDb;
        target.hnrDb = payload.hnrDb;
        target.vocalStrainIndex = payload.vocalStrainIndex;
        target.biomarkersReady = true;
      };

      biomarkerWorker.onerror = (event: ErrorEvent) => {
        fail(event.message || 'biomarker.worker failed to load');
      };

      const request: BiomarkerRequest = { type: 'init' };
      biomarkerWorker.postMessage(request);
    }

    return () => {
      aliveRef.current = false;

      audioWorker.onmessage = null;
      audioWorker.onerror = null;
      audioWorker.terminate();
      audioWorkerRef.current = null;

      if (biomarkerWorker) {
        biomarkerWorker.onmessage = null;
        biomarkerWorker.onerror = null;
        biomarkerWorker.terminate();
      }
      biomarkerWorkerRef.current = null;

      inputPoolRef.current = [];
      setStatus('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAudioWorker, createBiomarkerWorker, binCount, fail]);

  const pushPcm = useCallback((samples: Float32Array) => {
    const worker = audioWorkerRef.current;
    if (!worker) return;

    const byteLength = samples.length * Float32Array.BYTES_PER_ELEMENT;
    const pool = inputPoolRef.current;

    let buffer: ArrayBuffer | undefined;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].byteLength === byteLength) {
        buffer = pool.splice(i, 1)[0];
        break;
      }
    }
    // Copy rather than transfer the caller's array: an AudioWorklet reuses its
    // output buffer every render quantum, and transferring would detach it.
    buffer ??= new ArrayBuffer(byteLength);
    new Float32Array(buffer).set(samples);

    const request: AudioWorkerRequest = {
      type: 'process',
      buffer,
      length: samples.length,
    };
    worker.postMessage(request, [buffer]);
  }, []);

  const getTelemetryFrame = useCallback((): AudioTelemetryFrame | null => {
    const snapshot = snapshotRef.current;
    if (snapshot.frameCount === 0 || !snapshot.biomarkersReady) return null;

    return {
      timestamp: snapshot.timestamp,
      volumeDb: snapshot.volumeDb,
      pitchHz: snapshot.pitchHz,
      // Widening to number[] happens only here, at the shared-contract boundary.
      spectralBins: Array.from(snapshot.spectralBins),
      jitterPercent: snapshot.jitterPercent,
      shimmerDb: snapshot.shimmerDb,
      hnrDb: snapshot.hnrDb,
      vocalStrainIndex: snapshot.vocalStrainIndex,
    };
  }, []);

  const reset = useCallback(() => {
    const snapshot = snapshotRef.current;
    const bins = snapshot.spectralBins;
    bins.fill(0);
    Object.assign(snapshot, createSnapshot(bins.length), { spectralBins: bins });

    const resetAudio: AudioWorkerRequest = { type: 'reset' };
    audioWorkerRef.current?.postMessage(resetAudio);
    const resetBiomarker: BiomarkerRequest = { type: 'reset' };
    biomarkerWorkerRef.current?.postMessage(resetBiomarker);
  }, []);

  return { status, error, snapshotRef, pushPcm, getTelemetryFrame, reset };
}

function applyFrame(target: PipelineSnapshot, frame: AudioAnalysisFrame): void {
  target.timestamp = frame.timestamp;
  target.rms = frame.rms;
  target.volumeDb = frame.volumeDb;
  target.zcr = frame.zcr;
  target.pitchHz = frame.pitchHz;
  target.pitchConfidence = frame.pitchConfidence;
  target.voiced = frame.voiced;
  target.processingMs = frame.processingMs;
  target.frameCount++;

  const source = frame.spectralBins;
  const bins = target.spectralBins;
  if (source.length === bins.length) {
    bins.set(source);
  } else {
    bins.fill(0);
    bins.set(source.subarray(0, Math.min(source.length, bins.length)));
  }
}
