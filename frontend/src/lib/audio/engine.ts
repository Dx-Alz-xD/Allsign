/**
 * The one AudioContext the app runs on, and the graph around it:
 *
 *   mic ─► muteGain ─► captureNode (→ 16 kHz PCM to the workers via its port)
 *                  └─► fluencyNode (DAF/FSF) ─► feedbackGain ─► destination
 *
 * Nothing here does DSP on the main thread; the worklets do. `start()` must
 * be called from a user gesture (browsers gate AudioContext and microphone
 * access behind one). Devices come from the app's audio settings.
 */

import {
  createCaptureNode,
  createFluencyNode,
  loadWorklets,
  rampParam,
  type CaptureHandle,
  type CaptureInfo,
  type CaptureMessage,
  type FluencyHandle,
  type FluencyInfo,
  type FluencyMessage,
  type FluencyParams,
} from '@/lib/worklets';
import { SYSTEM_DEFAULT_DEVICE } from '@/lib/settings/schema';

export type EngineState = 'idle' | 'starting' | 'running' | 'error';

export interface FluencySettings {
  /** 0 disables the delayed feedback entirely (dafMix 0). */
  dafDelayMs: number;
  fsfOctaveShift: number;
  /** 0 = no feedback heard, 1 = full. */
  feedbackGain: number;
}

export interface EngineSnapshot {
  state: EngineState;
  error: string | null;
  sampleRate: number;
  capture: CaptureInfo | null;
  fluency: FluencyInfo | null;
  muted: boolean;
  feedbackEnabled: boolean;
  inputLabel: string;
}

type Listener = (snapshot: EngineSnapshot) => void;

type SinkContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

const DAF_MIN_MS = 30;
const DAF_MAX_MS = 150;

export class AudioEngine {
  private context: SinkContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private muteGain: GainNode | null = null;
  private feedbackGain: GainNode | null = null;
  private capture: CaptureHandle | null = null;
  private fluency: FluencyHandle | null = null;
  private workletsLoaded = false;

  private snapshot: EngineSnapshot = {
    state: 'idle',
    error: null,
    sampleRate: 0,
    capture: null,
    fluency: null,
    muted: false,
    feedbackEnabled: false,
    inputLabel: '',
  };
  private readonly listeners = new Set<Listener>();

  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The capture worklet's port; PCM chunks arrive as `pcm` messages. */
  get capturePort(): MessagePort | null {
    return this.capture?.port ?? null;
  }

  get fluencyParams(): FluencyParams | null {
    return this.fluency?.params ?? null;
  }

  get audioContext(): AudioContext | null {
    return this.context;
  }

  private update(patch: Partial<EngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  /** Opens the microphone and builds the graph. Safe to call again; it restarts with the new device. */
  async start(options: { inputDeviceId?: string; outputDeviceId?: string } = {}): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.update({ state: 'error', error: 'Microphone capture is not available in this environment.' });
      return;
    }
    this.update({ state: 'starting', error: null });

    try {
      const context = this.context ?? (new AudioContext({ latencyHint: 'interactive' }) as SinkContext);
      this.context = context;
      if (context.state === 'suspended') await context.resume();
      if (!this.workletsLoaded) {
        await loadWorklets(context);
        this.workletsLoaded = true;
      }

      this.releaseMicrophone();
      const deviceId = options.inputDeviceId && options.inputDeviceId !== SYSTEM_DEFAULT_DEVICE ? options.inputDeviceId : undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          // Feedback therapy needs the raw voice; browser processing would fight the DAF loop.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.stream = stream;

      if (options.outputDeviceId && options.outputDeviceId !== SYSTEM_DEFAULT_DEVICE && context.setSinkId) {
        await context.setSinkId(options.outputDeviceId).catch(() => undefined);
      }

      const source = context.createMediaStreamSource(stream);
      const muteGain = context.createGain();
      muteGain.gain.value = this.snapshot.muted ? 0 : 1;
      source.connect(muteGain);

      // The pipeline hook owns the port's onmessage (see useAudioPipeline.attachCapture)
      // and forwards non-PCM messages to handleCaptureMessage.
      const capture = this.capture ?? createCaptureNode(context, muteGain);
      if (this.capture) muteGain.connect(this.capture.node);
      this.capture = capture;
      capture.port.postMessage({ type: 'getInfo' });

      const fluency = this.fluency ?? createFluencyNode(context);
      this.fluency = fluency;
      fluency.port.onmessage = (event: MessageEvent<FluencyMessage>) => {
        const message = event.data;
        if (message?.type === 'ready' || message?.type === 'info') this.update({ fluency: message });
      };
      fluency.port.postMessage({ type: 'getInfo' });

      const feedbackGain = this.feedbackGain ?? context.createGain();
      if (!this.feedbackGain) {
        feedbackGain.gain.value = 0;
        fluency.node.connect(feedbackGain);
        feedbackGain.connect(context.destination);
      }
      this.feedbackGain = feedbackGain;
      muteGain.connect(fluency.node);

      this.source = source;
      this.muteGain = muteGain;

      const track = stream.getAudioTracks()[0];
      this.update({
        state: 'running',
        error: null,
        sampleRate: context.sampleRate,
        inputLabel: track?.label ?? '',
      });
    } catch (error) {
      this.update({ state: 'error', error: describeError(error) });
    }
  }

  /** Ready / info replies from the capture worklet, forwarded by whoever owns its port. */
  handleCaptureMessage(message: CaptureMessage): void {
    if (message?.type === 'ready' || message?.type === 'info') this.update({ capture: message });
  }

  setMuted(muted: boolean): void {
    if (this.muteGain && this.context) rampParam(this.muteGain.gain, muted ? 0 : 1, this.context, 0.02);
    this.update({ muted });
  }

  /** Turns the DAF/FSF feedback path on or off (the analysis path is unaffected). */
  setFeedbackEnabled(enabled: boolean): void {
    if (this.feedbackGain && this.context) rampParam(this.feedbackGain.gain, enabled ? 1 : 0, this.context, 0.05);
    this.update({ feedbackEnabled: enabled });
  }

  applyFluency(settings: FluencySettings): void {
    const params = this.fluency?.params;
    const context = this.context;
    if (!params || !context) return;
    const delay = Math.min(DAF_MAX_MS, Math.max(DAF_MIN_MS, settings.dafDelayMs));
    rampParam(params.dafDelayMs, delay, context, 0.05);
    rampParam(params.dafMix, settings.dafDelayMs > 0 ? 1 : 0, context, 0.05);
    rampParam(params.fsfOctaveShift, Math.max(-0.5, Math.min(0.5, settings.fsfOctaveShift)), context, 0.05);
    rampParam(params.fsfMix, 1, context, 0.05);
    rampParam(params.outputGain, Math.max(0, Math.min(2, settings.feedbackGain)), context, 0.05);
  }

  private releaseMicrophone(): void {
    this.source?.disconnect();
    this.source = null;
    this.muteGain?.disconnect();
    this.muteGain = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  async stop(): Promise<void> {
    this.releaseMicrophone();
    this.capture?.disconnect();
    this.capture = null;
    this.fluency?.node.disconnect();
    this.fluency = null;
    this.feedbackGain?.disconnect();
    this.feedbackGain = null;
    const context = this.context;
    this.context = null;
    this.workletsLoaded = false;
    if (context) await context.close().catch(() => undefined);
    this.update({ state: 'idle', error: null, sampleRate: 0, capture: null, fluency: null, inputLabel: '', feedbackEnabled: false });
  }
}

function describeError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow OmniVoice OS in your system privacy settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'That microphone is not available. Choose another one in Settings.';
  }
  return error instanceof Error ? error.message : String(error);
}

let shared: AudioEngine | null = null;

/** Module-level singleton: one context per renderer, shared by every view. */
export function getAudioEngine(): AudioEngine {
  shared ??= new AudioEngine();
  return shared;
}
