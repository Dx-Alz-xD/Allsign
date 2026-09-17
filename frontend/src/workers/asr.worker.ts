/**
 * On-device speech recognition: Whisper (English) through Transformers.js and ONNX Runtime, in a worker.
 *
 * The recognizer is asked for what was *said*, not what was meant: every utterance is decoded greedily
 * with no repetition penalty, primed with a disfluent prompt (Whisper copies the style of the text it is
 * shown), so "w-w-water", "um" and repeated words come through instead of being tidied away. The grammar
 * engine, not this worker, does the tidying, and the raw text is kept as it was heard.
 *
 * Model weights are fetched from the Hugging Face Hub the first time and cached by the browser; the ONNX
 * Runtime binaries come from the app's own /ort/ files. Audio never leaves the machine.
 *
 * Messages in:  { type: 'init', config }, { type: 'transcribe', id, audio: Float32Array (16 kHz) }, { type: 'close' }
 * Messages out: { type: 'progress', ... }, { type: 'ready', ... }, { type: 'result', id, text, ... }, { type: 'error', ... }
 */

import { AutoProcessor, AutoTokenizer, WhisperForConditionalGeneration, env, type PreTrainedTokenizer, type Processor } from '@huggingface/transformers';

export type AsrDevice = 'webgpu' | 'wasm';
export type AsrModelSize = 'tiny' | 'base' | 'small';

export interface AsrConfig {
  /** Which Whisper: bigger is more accurate and slower. */
  model: AsrModelSize;
  device: AsrDevice;
  /** Where /ort/ is served from, e.g. app://omnivoice/ort/ or http://localhost:3000/ort/. */
  ortPath: string;
}

export type AsrRequest = { type: 'init'; config: AsrConfig } | { type: 'transcribe'; id: string; audio: Float32Array; durationMs: number } | { type: 'close' };

export type AsrResponse =
  | { type: 'progress'; file: string; loaded: number; total: number; status: string }
  | { type: 'ready'; model: string; device: AsrDevice }
  | { type: 'result'; id: string; text: string; durationMs: number; decodeMs: number }
  | { type: 'error'; message: string; fatal: boolean };

export const MODEL_IDS: Record<AsrModelSize, string> = {
  tiny: 'onnx-community/whisper-tiny.en',
  base: 'onnx-community/whisper-base.en',
  small: 'onnx-community/whisper-small.en',
};

// Whisper mirrors the register of its prompt. A prompt full of hesitations and part-word repetitions keeps it
// from smoothing them out of what it hears.
const DISFLUENT_PROMPT = 'Um, I-I-I think, uh, the w-w-water is, is cold. Hmm, so, so I want, um, want the b-b-blue one.';
const MAX_NEW_TOKENS = 224;
const SAMPLE_RATE = 16_000;

let tokenizer: PreTrainedTokenizer | null = null;
let processor: Processor | null = null;
let model: WhisperForConditionalGeneration | null = null;
let decoderPrefix: number[] = [];
let ready: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();

const post = (message: AsrResponse) => self.postMessage(message);

async function load(config: AsrConfig): Promise<void> {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = config.ortPath;
  const id = MODEL_IDS[config.model];
  const progress_callback = (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (event.status === 'progress' && event.file) {
      post({ type: 'progress', file: event.file, loaded: event.loaded ?? 0, total: event.total ?? 0, status: 'download' });
    }
  };
  tokenizer = await AutoTokenizer.from_pretrained(id, { progress_callback });
  processor = await AutoProcessor.from_pretrained(id, { progress_callback });
  // WebGPU runs the encoder in full precision and a 4-bit decoder; the WASM fallback uses 8-bit everywhere.
  const dtype = config.device === 'webgpu' ? { encoder_model: 'fp32' as const, decoder_model_merged: 'q4' as const } : 'q8';
  const loaded = (await WhisperForConditionalGeneration.from_pretrained(id, { dtype, device: config.device, progress_callback })) as WhisperForConditionalGeneration;
  model = loaded;

  // <|startofprev|> prompt <|startoftranscript|> <|notimestamps|>: the prompt is context, not output.
  const startOfPrev = tokenizer.encode('<|startofprev|>', { add_special_tokens: false })[0];
  const promptIds = tokenizer.encode(DISFLUENT_PROMPT, { add_special_tokens: false });
  const generation = loaded.generation_config as { decoder_start_token_id?: number; no_timestamps_token_id?: number };
  const init = [generation.decoder_start_token_id, generation.no_timestamps_token_id].filter((value): value is number => typeof value === 'number');
  decoderPrefix = [startOfPrev, ...promptIds, ...init];
  post({ type: 'ready', model: id, device: config.device });
}

async function transcribe(id: string, audio: Float32Array, durationMs: number): Promise<void> {
  if (!model || !processor || !tokenizer) throw new Error('The recognizer is not loaded.');
  const started = performance.now();
  const inputs = await processor(audio, { sampling_rate: SAMPLE_RATE });
  // The typed signature insists on a generation_config; the model merges these with its own defaults.
  const output = (await model.generate({
    inputs: inputs.input_features,
    decoder_input_ids: decoderPrefix,
    max_new_tokens: MAX_NEW_TOKENS,
    // No repetition penalties of any kind: a stutter is a repetition.
    repetition_penalty: 1,
    no_repeat_ngram_size: 0,
  } as unknown as Parameters<WhisperForConditionalGeneration['generate']>[0])) as { tolist: () => number[][] };
  const ids = output.tolist()[0].slice(decoderPrefix.length);
  const text = tokenizer.decode(ids, { skip_special_tokens: true }).trim();
  post({ type: 'result', id, text, durationMs, decodeMs: Math.round(performance.now() - started) });
}

self.onmessage = (event: MessageEvent<AsrRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    ready = load(message.config).catch((error: unknown) => {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error), fatal: true });
      throw error;
    });
    return;
  }
  if (message.type === 'close') {
    self.close();
    return;
  }
  // One utterance at a time, in the order they were spoken.
  queue = queue
    .then(async () => {
      await ready;
      await transcribe(message.id, message.audio, message.durationMs);
    })
    .catch((error: unknown) => {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error), fatal: false });
    });
};
