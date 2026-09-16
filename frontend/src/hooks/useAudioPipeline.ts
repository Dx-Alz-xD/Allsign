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
  BiomarkerConfig,
  BiomarkerRequest,
  BiomarkerResponse,
  StrainLevel,
} from '@/workers/biomarker.worker';
import type {
  FormantFrame,
  FormantWorkerConfig,
  FormantWorkerRequest,
  FormantWorkerResponse,
  SpeakerProfile,
  VowelPlaneGeometry,
  VowelTarget,
} from '@/workers/formant.worker';
import type {
  CaptureRequest,
  TriggerMatch,
  TriggerScore,
  TriggerWorkerConfig,
  TriggerWorkerRequest,
  TriggerWorkerResponse,
} from '@/workers/trigger.worker';
import type { CadenceConfig, CadenceRequest, CadenceResponse } from '@/workers/cadence.worker';
import type { CaptureMessage } from '@/lib/worklets';
import type { HudFrame } from '@/lib/hud/types';
import type {
  AcousticTriggerProfile,
  AudioTelemetryFrame,
  FluencyMetrics,
  FormantData,
  SessionAnalyticsInput,
} from '@shared/types';

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
  strainSmoothed: number;
  strainLevel: StrainLevel;
  fatigueWarning: boolean;
  sustainedSeconds: number;
  trendPerMinute: number;
  phonationSeconds: number;
  biomarkersReady: boolean;
  formants: FormantSnapshot;
  /** Best-scoring enrolled trigger on the latest scored frame. */
  triggerBestId: string | null;
  triggerBestSimilarity: number;
  lastTriggerId: string | null;
  lastTriggerAt: number;
  cadence: CadenceSnapshot;
  /** Newest 16 kHz PCM, oldest first; the oscilloscope trace. */
  waveform: Float32Array;
  frameCount: number;
}

/** Latest cadence payload, flattened for in-place mutation. */
export interface CadenceSnapshot {
  wpm: number;
  syllablesPerSecond: number;
  vocalBlockDetected: boolean;
  blockDurationMs: number;
  blockCount: number;
  blockedMs: number;
  speakingMs: number;
  pitchVolatilityHz: number;
  utteranceActive: boolean;
  ready: boolean;
}

/** Live DAF/FSF settings mirrored into FluencyMetrics; set by the session that owns the feedback node. */
export interface FeedbackState {
  dafDelayMs: number;
  fsfOctaveShift: number;
}

/** Latest formant frame, flattened for in-place mutation. */
export interface FormantSnapshot {
  voiced: boolean;
  f1: number;
  f2: number;
  f3: number;
  /** Bark-normalised rectangle: x 0 front..1 back, y 0 close..1 open. */
  planeX: number;
  planeY: number;
  /** Same point skewed onto the IPA trapezoid. */
  quadX: number;
  quadY: number;
  target: string | null;
  /** 0..100 against `target`. */
  accuracy: number;
  nearest: string | null;
  nearestAccuracy: number;
  ready: boolean;
  frameCount: number;
}

export type PipelineStatus = 'idle' | 'running' | 'error';

export interface UseAudioPipelineOptions {
  /**
   * Must inline the literal constructor so the bundler can statically find the
   * worker chunk: `() => new Worker(new URL('@/workers/audio.worker.ts', import.meta.url))`.
   */
  createAudioWorker: () => Worker;
  /** Telemetry stays null while absent. */
  createBiomarkerWorker?: () => Worker;
  /** Formant snapshot stays inert while absent. */
  createFormantWorker?: () => Worker;
  /** Trigger list stays empty and no matches fire while absent. */
  createTriggerWorker?: () => Worker;
  /** FluencyMetrics (rate, blocks, volatility) stay at zero while absent. */
  createCadenceWorker?: () => Worker;
  config?: Partial<AudioWorkerConfig>;
  biomarkerConfig?: Partial<BiomarkerConfig>;
  formantConfig?: Partial<FormantWorkerConfig>;
  triggerConfig?: Partial<TriggerWorkerConfig>;
  cadenceConfig?: Partial<CadenceConfig>;
  /** Samples kept for the oscilloscope trace. */
  waveformSize?: number;
  /** Called for every frame, before its spectral buffer is recycled. */
  onFrame?: (frame: Readonly<PipelineSnapshot>) => void;
  /** Called at the formant frame rate with the full frame (per-vowel scores). */
  onFormantFrame?: (frame: FormantFrame) => void;
  /** Fires once per acoustic trigger match; wire Direct Paste / TTS here. */
  onTriggerMatch?: (match: TriggerMatch) => void;
  onTriggerScores?: (best: TriggerScore | null, scores: TriggerScore[]) => void;
  /** Non-fatal notices, e.g. the trigger store being unreachable. */
  onWarning?: (message: string) => void;
  onError?: (message: string) => void;
}

export interface AudioPipeline {
  status: PipelineStatus;
  error: string | null;
  snapshotRef: MutableRefObject<PipelineSnapshot>;
  /** Plane ranges, trapezoid corners and reference vowel positions for the HUD. */
  vowelGeometry: VowelPlaneGeometry | null;
  /** Enrolled acoustic triggers, as persisted by trigger.worker. */
  triggers: AcousticTriggerProfile[];
  pushPcm: (samples: Float32Array) => void;
  /** Zero-copy variant: `buffer` is transferred and must not be touched after. */
  pushPcmBuffer: (buffer: ArrayBuffer, length: number) => void;
  /**
   * Feeds the pipeline from captureProcessor.js. Chunks are forwarded by
   * transfer and their buffers handed back to the worklet once analysed, so
   * steady state allocates nothing. Returns a detach function.
   */
  attachCapture: (port: MessagePort, onMessage?: (message: CaptureMessage) => void) => () => void;
  getTelemetryFrame: () => AudioTelemetryFrame | null;
  getFluencyMetrics: () => FluencyMetrics;
  /**
   * One HUD render frame from the current snapshot: spectral bins mapped to
   * 0..1 for display (the raw power stays in the snapshot), waveform, latency.
   */
  getHudFrame: () => HudFrame;
  /** Session record so far, for POST /api/sessions when a session ends. */
  getSessionStats: () => SessionAnalyticsInput;
  /** Mirrors the feedback node's live DAF/FSF values into FluencyMetrics. */
  setFeedbackState: (state: FeedbackState) => void;
  getFormantData: () => FormantData | null;
  /** IPA symbol from `vowelGeometry.vowels`, or null to clear. */
  setFormantTarget: (symbol: string | null) => void;
  setFormantProfile: (profile: SpeakerProfile) => void;
  setFormantTargets: (targets: VowelTarget[]) => void;
  enrollTrigger: (profile: AcousticTriggerProfile) => void;
  /** Enrols from the next `durationMs` of live audio. */
  captureTrigger: (request: CaptureRequest) => void;
  cancelTriggerCapture: () => void;
  removeTrigger: (id: string) => void;
  setTriggerThreshold: (id: string, threshold: number) => void;
  reset: () => void;
}

const SPECTRAL_BIN_COUNT = 128;
const MAX_POOLED_INPUTS = 8;
const DEFAULT_WAVEFORM_SIZE = 512;
/** Display mapping for spectral bins: 0..1 spans this dB range of Parseval power. */
const DISPLAY_FLOOR_DB = -80;
const DISPLAY_CEIL_DB = -10;

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
    strainSmoothed: 0,
    strainLevel: 'normal',
    fatigueWarning: false,
    sustainedSeconds: 0,
    trendPerMinute: 0,
    phonationSeconds: 0,
    biomarkersReady: false,
    formants: createFormantSnapshot(),
    triggerBestId: null,
    triggerBestSimilarity: 0,
    lastTriggerId: null,
    lastTriggerAt: 0,
    cadence: createCadenceSnapshot(),
    waveform: new Float32Array(DEFAULT_WAVEFORM_SIZE),
    frameCount: 0,
  };
}

function createCadenceSnapshot(): CadenceSnapshot {
  return {
    wpm: 0,
    syllablesPerSecond: 0,
    vocalBlockDetected: false,
    blockDurationMs: 0,
    blockCount: 0,
    blockedMs: 0,
    speakingMs: 0,
    pitchVolatilityHz: 0,
    utteranceActive: false,
    ready: false,
  };
}

function createFormantSnapshot(): FormantSnapshot {
  return {
    voiced: false,
    f1: 0,
    f2: 0,
    f3: 0,
    planeX: 0.5,
    planeY: 0.5,
    quadX: 0.5,
    quadY: 0.5,
    target: null,
    accuracy: 0,
    nearest: null,
    nearestAccuracy: 0,
    ready: false,
    frameCount: 0,
  };
}

export function useAudioPipeline(options: UseAudioPipelineOptions): AudioPipeline {
  const {
    createAudioWorker,
    createBiomarkerWorker,
    createFormantWorker,
    createTriggerWorker,
    createCadenceWorker,
    config,
    biomarkerConfig,
    formantConfig,
    triggerConfig,
    cadenceConfig,
    waveformSize = DEFAULT_WAVEFORM_SIZE,
    onFrame,
    onFormantFrame,
    onTriggerMatch,
    onTriggerScores,
    onWarning,
    onError,
  } = options;

  const binCount = config?.spectralBinCount ?? SPECTRAL_BIN_COUNT;

  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [vowelGeometry, setVowelGeometry] = useState<VowelPlaneGeometry | null>(null);
  const [triggers, setTriggers] = useState<AcousticTriggerProfile[]>([]);

  const snapshotRef = useRef<PipelineSnapshot>(createSnapshot(binCount));
  const audioWorkerRef = useRef<Worker | null>(null);
  const biomarkerWorkerRef = useRef<Worker | null>(null);
  const formantWorkerRef = useRef<Worker | null>(null);
  const triggerWorkerRef = useRef<Worker | null>(null);
  const cadenceWorkerRef = useRef<Worker | null>(null);
  const inputPoolRef = useRef<ArrayBuffer[]>([]);
  const capturePortRef = useRef<MessagePort | null>(null);
  const aliveRef = useRef(false);
  const feedbackRef = useRef<FeedbackState>({ dafDelayMs: 0, fsfOctaveShift: 0 });
  const sessionStartRef = useRef<number>(0);
  const displayBinsRef = useRef<number[]>(new Array<number>(binCount).fill(0));

  // Read through refs so a caller passing inline closures cannot tear down workers.
  const onFrameRef = useRef(onFrame);
  const onFormantFrameRef = useRef(onFormantFrame);
  const onTriggerMatchRef = useRef(onTriggerMatch);
  const onTriggerScoresRef = useRef(onTriggerScores);
  const onWarningRef = useRef(onWarning);
  const onErrorRef = useRef(onError);
  onFrameRef.current = onFrame;
  onFormantFrameRef.current = onFormantFrame;
  onTriggerMatchRef.current = onTriggerMatch;
  onTriggerScoresRef.current = onTriggerScores;
  onWarningRef.current = onWarning;
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

    const formantWorker = createFormantWorker?.() ?? null;
    formantWorkerRef.current = formantWorker;

    const triggerWorker = createTriggerWorker?.() ?? null;
    triggerWorkerRef.current = triggerWorker;

    const cadenceWorker = createCadenceWorker?.() ?? null;
    cadenceWorkerRef.current = cadenceWorker;

    if (snapshot.waveform.length !== waveformSize) snapshot.waveform = new Float32Array(waveformSize);
    sessionStartRef.current = performance.now();

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

      // The worker returns ownership of the PCM buffer: hand it back to the
      // capture worklet when one is attached, else park it for the next pushPcm.
      if (buffer.byteLength > 0) {
        const capturePort = capturePortRef.current;
        if (capturePort) {
          capturePort.postMessage({ type: 'recycle', buffer }, [buffer]);
        } else if (inputPoolRef.current.length < MAX_POOLED_INPUTS) {
          inputPoolRef.current.push(buffer);
        }
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
        target.strainSmoothed = payload.strainSmoothed;
        target.strainLevel = payload.strainLevel;
        target.fatigueWarning = payload.fatigueWarning;
        target.sustainedSeconds = payload.sustainedSeconds;
        target.trendPerMinute = payload.trendPerMinute;
        target.phonationSeconds = payload.phonationSeconds;
        target.biomarkersReady = true;
      };

      biomarkerWorker.onerror = (event: ErrorEvent) => {
        fail(event.message || 'biomarker.worker failed to load');
      };

      const request: BiomarkerRequest = { type: 'init', config: biomarkerConfig };
      biomarkerWorker.postMessage(request);
    }

    if (formantWorker) {
      // Same worker-to-worker pattern: audio.worker fans CyclePackets out to
      // every connected port, so formants get the voicing verdict for free.
      const channel = new MessageChannel();
      const connectAudio: AudioWorkerRequest = { type: 'connect', port: channel.port1 };
      audioWorker.postMessage(connectAudio, [channel.port1]);
      const connectFormant: FormantWorkerRequest = { type: 'connect', port: channel.port2 };
      formantWorker.postMessage(connectFormant, [channel.port2]);

      formantWorker.onmessage = (event: MessageEvent<FormantWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'error') {
          fail(message.message);
          return;
        }
        if (message.type === 'ready' || message.type === 'geometry') {
          if (aliveRef.current) setVowelGeometry(message.geometry);
          return;
        }
        if (message.type !== 'formants') return;

        const target = snapshotRef.current.formants;
        for (const frame of message.frames) {
          applyFormantFrame(target, frame);
          onFormantFrameRef.current?.(frame);
        }
      };

      formantWorker.onerror = (event: ErrorEvent) => {
        fail(event.message || 'formant.worker failed to load');
      };

      const request: FormantWorkerRequest = { type: 'init', config: formantConfig };
      formantWorker.postMessage(request);
    }

    if (triggerWorker) {
      // Spectra go worker-to-worker too; matching never touches this thread.
      const channel = new MessageChannel();
      const connectAudio: AudioWorkerRequest = { type: 'connectSpectral', port: channel.port1 };
      audioWorker.postMessage(connectAudio, [channel.port1]);
      const connectTrigger: TriggerWorkerRequest = { type: 'connect', port: channel.port2 };
      triggerWorker.postMessage(connectTrigger, [channel.port2]);

      triggerWorker.onmessage = (event: MessageEvent<TriggerWorkerResponse>) => {
        const message = event.data;
        const snapshot = snapshotRef.current;
        switch (message.type) {
          case 'error':
            fail(message.message);
            break;
          case 'ready':
            if (aliveRef.current) setTriggers(message.triggers);
            if (message.warning) onWarningRef.current?.(message.warning);
            break;
          case 'triggers':
            if (aliveRef.current) setTriggers(message.triggers);
            break;
          case 'match':
            snapshot.lastTriggerId = message.match.id;
            snapshot.lastTriggerAt = message.match.timestamp;
            onTriggerMatchRef.current?.(message.match);
            break;
          case 'scores':
            snapshot.triggerBestId = message.best?.id ?? null;
            snapshot.triggerBestSimilarity = message.best?.similarity ?? 0;
            onTriggerScoresRef.current?.(message.best, message.scores);
            break;
          default:
            break;
        }
      };

      triggerWorker.onerror = (event: ErrorEvent) => {
        fail(event.message || 'trigger.worker failed to load');
      };

      const request: TriggerWorkerRequest = { type: 'init', config: triggerConfig };
      triggerWorker.postMessage(request);
    }

    if (cadenceWorker) {
      const channel = new MessageChannel();
      const connectAudio: AudioWorkerRequest = { type: 'connect', port: channel.port1 };
      audioWorker.postMessage(connectAudio, [channel.port1]);
      const connectCadence: CadenceRequest = { type: 'connect', port: channel.port2 };
      cadenceWorker.postMessage(connectCadence, [channel.port2]);

      cadenceWorker.onmessage = (event: MessageEvent<CadenceResponse>) => {
        const message = event.data;
        if (message.type === 'error') {
          fail(message.message);
          return;
        }
        if (message.type !== 'cadence') return;
        const { payload } = message;
        const target = snapshotRef.current.cadence;
        target.wpm = payload.wpm;
        target.syllablesPerSecond = payload.syllablesPerSecond;
        target.vocalBlockDetected = payload.vocalBlockDetected;
        target.blockDurationMs = payload.blockDurationMs;
        target.blockCount = payload.blockCount;
        target.blockedMs = payload.blockedMs;
        target.speakingMs = payload.speakingMs;
        target.pitchVolatilityHz = payload.pitchVolatilityHz;
        target.utteranceActive = payload.utteranceActive;
        target.ready = true;
      };

      cadenceWorker.onerror = (event: ErrorEvent) => {
        fail(event.message || 'cadence.worker failed to load');
      };

      const request: CadenceRequest = { type: 'init', config: cadenceConfig };
      cadenceWorker.postMessage(request);
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

      if (formantWorker) {
        formantWorker.onmessage = null;
        formantWorker.onerror = null;
        formantWorker.terminate();
      }
      formantWorkerRef.current = null;

      if (triggerWorker) {
        triggerWorker.onmessage = null;
        triggerWorker.onerror = null;
        triggerWorker.terminate();
      }
      triggerWorkerRef.current = null;

      if (cadenceWorker) {
        cadenceWorker.onmessage = null;
        cadenceWorker.onerror = null;
        cadenceWorker.terminate();
      }
      cadenceWorkerRef.current = null;

      inputPoolRef.current = [];
      setStatus('idle');
      setVowelGeometry(null);
      setTriggers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    createAudioWorker,
    createBiomarkerWorker,
    createFormantWorker,
    createTriggerWorker,
    createCadenceWorker,
    binCount,
    waveformSize,
    fail,
  ]);

  const recordWaveform = useCallback((samples: Float32Array) => {
    const waveform = snapshotRef.current.waveform;
    if (samples.length >= waveform.length) {
      waveform.set(samples.subarray(samples.length - waveform.length));
      return;
    }
    waveform.copyWithin(0, samples.length);
    waveform.set(samples, waveform.length - samples.length);
  }, []);

  const pushPcmBuffer = useCallback(
    (buffer: ArrayBuffer, length: number) => {
      const worker = audioWorkerRef.current;
      if (!worker) return;
      recordWaveform(new Float32Array(buffer, 0, length));
      const request: AudioWorkerRequest = { type: 'process', buffer, length };
      worker.postMessage(request, [buffer]);
    },
    [recordWaveform],
  );

  const attachCapture = useCallback(
    (port: MessagePort, onMessage?: (message: CaptureMessage) => void) => {
      if (capturePortRef.current && capturePortRef.current !== port) capturePortRef.current.onmessage = null;
      capturePortRef.current = port;
      port.onmessage = (event: MessageEvent<CaptureMessage>) => {
        const message = event.data;
        if (message?.type !== 'pcm') {
          onMessage?.(message);
          return;
        }
        pushPcmBuffer(message.buffer, message.length);
      };
      return () => {
        if (capturePortRef.current !== port) return;
        port.onmessage = null;
        capturePortRef.current = null;
      };
    },
    [pushPcmBuffer],
  );

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
    recordWaveform(samples);

    const request: AudioWorkerRequest = {
      type: 'process',
      buffer,
      length: samples.length,
    };
    worker.postMessage(request, [buffer]);
  }, [recordWaveform]);

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

  const getFluencyMetrics = useCallback((): FluencyMetrics => {
    const { cadence } = snapshotRef.current;
    const feedback = feedbackRef.current;
    return {
      wpm: cadence.wpm,
      vocalBlockDetected: cadence.vocalBlockDetected,
      blockDurationMs: cadence.blockDurationMs,
      pitchVolatilityHz: cadence.pitchVolatilityHz,
      dafDelayMs: feedback.dafDelayMs,
      fsfOctaveShift: feedback.fsfOctaveShift,
    };
  }, []);

  const getHudFrame = useCallback((): HudFrame => {
    const snapshot = snapshotRef.current;
    const source = snapshot.spectralBins;
    const display = displayBinsRef.current;
    if (display.length !== source.length) displayBinsRef.current = new Array<number>(source.length).fill(0);
    const bins = displayBinsRef.current;
    const span = DISPLAY_CEIL_DB - DISPLAY_FLOOR_DB;
    for (let i = 0; i < source.length; i++) {
      const power = source[i];
      const db = power > 0 ? 10 * Math.log10(power) : DISPLAY_FLOOR_DB;
      const value = (db - DISPLAY_FLOOR_DB) / span;
      bins[i] = value < 0 ? 0 : value > 1 ? 1 : value;
    }
    return {
      telemetry: {
        timestamp: snapshot.timestamp || Date.now(),
        volumeDb: snapshot.volumeDb,
        pitchHz: snapshot.voiced ? snapshot.pitchHz : 0,
        spectralBins: bins,
        jitterPercent: snapshot.jitterPercent,
        shimmerDb: snapshot.shimmerDb,
        hnrDb: snapshot.hnrDb,
        vocalStrainIndex: snapshot.vocalStrainIndex,
      },
      fluency: getFluencyMetrics(),
      waveform: snapshot.waveform,
      spectrumMaxHz: (config?.sampleRate ?? 16000) / 2,
      latencyMs: snapshot.processingMs,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFluencyMetrics, config?.sampleRate]);

  const getSessionStats = useCallback((): SessionAnalyticsInput => {
    const { cadence } = snapshotRef.current;
    const elapsedSeconds = Math.max(0, Math.round((performance.now() - sessionStartRef.current) / 1000));
    const spoken = cadence.speakingMs + cadence.blockedMs;
    return {
      profileMode: null,
      wpm: Math.max(0, cadence.wpm),
      stutterCount: cadence.blockCount,
      avgBlockDurationMs: cadence.blockCount > 0 ? cadence.blockedMs / cadence.blockCount : 0,
      fluencyPercentage: spoken > 0 ? Math.max(0, Math.min(100, 100 * (1 - cadence.blockedMs / spoken))) : 100,
      sessionDurationSeconds: elapsedSeconds,
    };
  }, []);

  const setFeedbackState = useCallback((state: FeedbackState) => {
    feedbackRef.current = state;
  }, []);

  const getFormantData = useCallback((): FormantData | null => {
    const formants = snapshotRef.current.formants;
    if (!formants.ready || formants.frameCount === 0) return null;
    return {
      f1: formants.f1,
      f2: formants.f2,
      f3: formants.f3,
      accuracyScore: formants.accuracy,
    };
  }, []);

  const setFormantTarget = useCallback((symbol: string | null) => {
    snapshotRef.current.formants.target = symbol;
    const request: FormantWorkerRequest = { type: 'setTarget', symbol };
    formantWorkerRef.current?.postMessage(request);
  }, []);

  const setFormantProfile = useCallback((profile: SpeakerProfile) => {
    const request: FormantWorkerRequest = { type: 'setProfile', profile };
    formantWorkerRef.current?.postMessage(request);
  }, []);

  const setFormantTargets = useCallback((targets: VowelTarget[]) => {
    const request: FormantWorkerRequest = { type: 'setTargets', targets };
    formantWorkerRef.current?.postMessage(request);
  }, []);

  const postTrigger = useCallback((request: TriggerWorkerRequest) => {
    triggerWorkerRef.current?.postMessage(request);
  }, []);

  const enrollTrigger = useCallback(
    (profile: AcousticTriggerProfile) => postTrigger({ type: 'enroll', profile }),
    [postTrigger],
  );
  const captureTrigger = useCallback(
    (request: CaptureRequest) => postTrigger({ type: 'capture', request }),
    [postTrigger],
  );
  const cancelTriggerCapture = useCallback(
    () => postTrigger({ type: 'cancelCapture' }),
    [postTrigger],
  );
  const removeTrigger = useCallback(
    (id: string) => postTrigger({ type: 'remove', id }),
    [postTrigger],
  );
  const setTriggerThreshold = useCallback(
    (id: string, threshold: number) => postTrigger({ type: 'setThreshold', id, threshold }),
    [postTrigger],
  );

  const reset = useCallback(() => {
    const snapshot = snapshotRef.current;
    const bins = snapshot.spectralBins;
    bins.fill(0);
    const waveform = snapshot.waveform;
    waveform.fill(0);
    const formantTarget = snapshot.formants.target;
    Object.assign(snapshot, createSnapshot(bins.length), { spectralBins: bins, waveform });
    snapshot.formants.target = formantTarget;
    sessionStartRef.current = performance.now();

    const resetAudio: AudioWorkerRequest = { type: 'reset' };
    audioWorkerRef.current?.postMessage(resetAudio);
    const resetBiomarker: BiomarkerRequest = { type: 'reset' };
    biomarkerWorkerRef.current?.postMessage(resetBiomarker);
    const resetFormant: FormantWorkerRequest = { type: 'reset' };
    formantWorkerRef.current?.postMessage(resetFormant);
    const resetTrigger: TriggerWorkerRequest = { type: 'reset' };
    triggerWorkerRef.current?.postMessage(resetTrigger);
    const resetCadence: CadenceRequest = { type: 'reset' };
    cadenceWorkerRef.current?.postMessage(resetCadence);
  }, []);

  return {
    status,
    error,
    snapshotRef,
    vowelGeometry,
    triggers,
    pushPcm,
    pushPcmBuffer,
    attachCapture,
    getTelemetryFrame,
    getFluencyMetrics,
    getHudFrame,
    getSessionStats,
    setFeedbackState,
    getFormantData,
    setFormantTarget,
    setFormantProfile,
    setFormantTargets,
    enrollTrigger,
    captureTrigger,
    cancelTriggerCapture,
    removeTrigger,
    setTriggerThreshold,
    reset,
  };
}

function applyFormantFrame(target: FormantSnapshot, frame: FormantFrame): void {
  target.voiced = frame.voiced;
  target.f1 = frame.f1;
  target.f2 = frame.f2;
  target.f3 = frame.f3;
  target.planeX = frame.plane.x;
  target.planeY = frame.plane.y;
  target.quadX = frame.quad.x;
  target.quadY = frame.quad.y;
  target.target = frame.target;
  target.accuracy = frame.accuracy;
  target.nearest = frame.nearest?.symbol ?? null;
  target.nearestAccuracy = frame.nearest?.accuracy ?? 0;
  target.ready = true;
  target.frameCount++;
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
