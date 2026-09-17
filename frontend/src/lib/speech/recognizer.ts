/**
 * Main-thread side of the on-device recognizer: owns the worker, reports model download progress, hands
 * it utterances and returns their verbatim text. See workers/asr.worker.ts for what runs inside.
 */

import type { AsrConfig, AsrDevice, AsrModelSize, AsrRequest, AsrResponse } from '@/workers/asr.worker';

export type RecognizerStatus = 'off' | 'loading' | 'ready' | 'error';

export interface RecognizerProgress {
  /** 0..1 over every file, or null before the first byte. */
  fraction: number | null;
  loadedMb: number;
  totalMb: number;
}

export interface RecognizerState {
  status: RecognizerStatus;
  model: AsrModelSize;
  device: AsrDevice | null;
  progress: RecognizerProgress;
  error: string | null;
  /** Utterances waiting to be decoded. */
  pending: number;
}

export interface Recognition {
  id: string;
  text: string;
  durationMs: number;
  decodeMs: number;
}

interface RecognizerHandlers {
  onState: (state: RecognizerState) => void;
  onResult: (result: Recognition) => void;
}

export const MODEL_LABELS: Record<AsrModelSize, { label: string; detail: string }> = {
  tiny: { label: 'Fastest', detail: 'about 40 MB, rough' },
  base: { label: 'Balanced', detail: 'about 80 MB, good on most laptops' },
  small: { label: 'Most accurate', detail: 'about 250 MB, best with a GPU' },
};

export function asrDevice(): Promise<AsrDevice> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return Promise.resolve('wasm');
  return gpu
    .requestAdapter()
    .then((adapter) => (adapter ? 'webgpu' : 'wasm'))
    .catch(() => 'wasm' as const);
}

export class Recognizer {
  private worker: Worker | null = null;
  private files = new Map<string, { loaded: number; total: number }>();
  private counter = 0;
  private state: RecognizerState;

  constructor(
    private readonly handlers: RecognizerHandlers,
    model: AsrModelSize,
  ) {
    this.state = { status: 'off', model, device: null, progress: { fraction: null, loadedMb: 0, totalMb: 0 }, error: null, pending: 0 };
  }

  getState(): RecognizerState {
    return this.state;
  }

  private update(patch: Partial<RecognizerState>): void {
    this.state = { ...this.state, ...patch };
    this.handlers.onState(this.state);
  }

  async start(model: AsrModelSize): Promise<void> {
    this.stop();
    const device = await asrDevice();
    this.files.clear();
    this.update({ status: 'loading', model, device, error: null, progress: { fraction: null, loadedMb: 0, totalMb: 0 }, pending: 0 });
    const worker = new Worker(new URL('../../workers/asr.worker.ts', import.meta.url));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<AsrResponse>) => this.handle(event.data);
    worker.onerror = (event) => this.update({ status: 'error', error: event.message || 'The recognizer stopped.' });
    // Absolute, so it does not depend on which page is open: app://omnivoice/ort/ or http://localhost:3000/ort/.
    const config: AsrConfig = { model, device, ortPath: new URL('/ort/', document.baseURI).toString() };
    const request: AsrRequest = { type: 'init', config };
    worker.postMessage(request);
  }

  stop(): void {
    if (this.worker) {
      const request: AsrRequest = { type: 'close' };
      this.worker.postMessage(request);
      this.worker.terminate();
      this.worker = null;
    }
    if (this.state.status !== 'off') this.update({ status: 'off', device: null, pending: 0 });
  }

  transcribe(audio: Float32Array, durationMs: number): string | null {
    if (!this.worker || this.state.status !== 'ready') return null;
    this.counter += 1;
    const id = `utt-${this.counter}`;
    const request: AsrRequest = { type: 'transcribe', id, audio, durationMs };
    this.worker.postMessage(request, [audio.buffer]);
    this.update({ pending: this.state.pending + 1 });
    return id;
  }

  private handle(message: AsrResponse): void {
    switch (message.type) {
      case 'progress': {
        this.files.set(message.file, { loaded: message.loaded, total: message.total });
        let loaded = 0;
        let total = 0;
        for (const file of this.files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        this.update({ progress: { fraction: total > 0 ? loaded / total : null, loadedMb: loaded / 1e6, totalMb: total / 1e6 } });
        return;
      }
      case 'ready':
        this.update({ status: 'ready', device: message.device, progress: { ...this.state.progress, fraction: 1 } });
        return;
      case 'result':
        this.update({ pending: Math.max(0, this.state.pending - 1) });
        this.handlers.onResult({ id: message.id, text: message.text, durationMs: message.durationMs, decodeMs: message.decodeMs });
        return;
      case 'error':
        if (message.fatal) this.update({ status: 'error', error: message.message });
        else this.update({ pending: Math.max(0, this.state.pending - 1), error: message.message });
        return;
    }
  }
}
