/**
 * Main-thread glue for the AudioWorklets served from public/worklets/.
 *
 * URLs resolve against `document.baseURI`, so the same paths work on the
 * Next.js dev server (`/worklets/...`) and inside a packaged Electron build
 * loading the static export over `file://`.
 */

export const CAPTURE_WORKLET_PATH = 'worklets/captureProcessor.js';
export const FLUENCY_WORKLET_PATH = 'worklets/fluencyProcessor.js';

export const CAPTURE_PROCESSOR_NAME = 'capture-processor';
export const FLUENCY_PROCESSOR_NAME = 'fluency-processor';

export interface CaptureInfo {
  name: string;
  inputRate: number;
  outputRate: number;
  ratio: number;
  taps: number;
  chunkSize: number;
  latencyMs: number;
}

/** `pcm` message posted by captureProcessor.js; `buffer` is transferred. */
export interface CapturePcmMessage {
  type: 'pcm';
  buffer: ArrayBuffer;
  length: number;
  sampleRate: number;
  timestamp: number;
}

export type CaptureMessage =
  | ({ type: 'ready' } & CaptureInfo)
  | ({ type: 'info' } & CaptureInfo)
  | CapturePcmMessage;

export interface FluencyInfo {
  name: string;
  sampleRate: number;
  fftFrameSize: number;
  oversample: number;
  fsfLatencySamples: number;
  fsfLatencyMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  maxOctaveShift: number;
}

export type FluencyMessage = ({ type: 'ready' } & FluencyInfo) | ({ type: 'info' } & FluencyInfo);

export interface FluencyParams {
  dafDelayMs: AudioParam;
  dafMix: AudioParam;
  fsfOctaveShift: AudioParam;
  fsfMix: AudioParam;
  outputGain: AudioParam;
  bypass: AudioParam;
}

export interface FluencyOptions {
  fftFrameSize?: number;
  oversample?: number;
  maxDelayMs?: number;
}

export interface CaptureHandle {
  node: AudioWorkletNode;
  port: MessagePort;
  /** Tears down the node and the muted sink that keeps it pulling. */
  disconnect: () => void;
}

export interface FluencyHandle {
  node: AudioWorkletNode;
  port: MessagePort;
  params: FluencyParams;
}

export function workletUrl(path: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : undefined;
  return new URL(path, base).toString();
}

export async function loadWorklets(context: BaseAudioContext): Promise<void> {
  await Promise.all([
    context.audioWorklet.addModule(workletUrl(CAPTURE_WORKLET_PATH)),
    context.audioWorklet.addModule(workletUrl(FLUENCY_WORKLET_PATH)),
  ]);
}

/**
 * Mono capture tap on `source`. The node's output is silent; it runs through
 * a muted gain into the destination only so the graph keeps rendering it.
 */
export function createCaptureNode(context: BaseAudioContext, source: AudioNode): CaptureHandle {
  const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(context.destination);

  return {
    node,
    port: node.port,
    disconnect: () => {
      source.disconnect(node);
      node.disconnect();
      mute.disconnect();
      node.port.close();
    },
  };
}

export function createFluencyNode(
  context: BaseAudioContext,
  options: FluencyOptions = {},
): FluencyHandle {
  const node = new AudioWorkletNode(context, FLUENCY_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: options,
  });

  const param = (name: keyof FluencyParams): AudioParam => {
    const value = node.parameters.get(name);
    if (!value) throw new Error(`fluency-processor exposes no AudioParam named ${name}`);
    return value;
  };

  return {
    node,
    port: node.port,
    params: {
      dafDelayMs: param('dafDelayMs'),
      dafMix: param('dafMix'),
      fsfOctaveShift: param('fsfOctaveShift'),
      fsfMix: param('fsfMix'),
      outputGain: param('outputGain'),
      bypass: param('bypass'),
    },
  };
}

/** Click-free parameter move: a short exponential approach instead of a step. */
export function rampParam(
  param: AudioParam,
  value: number,
  context: BaseAudioContext,
  seconds = 0.03,
): void {
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, seconds / 3);
}
