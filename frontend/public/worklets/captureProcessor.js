/**
 * Microphone capture AudioWorkletProcessor: native-rate input (48 kHz on most
 * devices) -> anti-aliased 16 kHz PCM in 10 ms transferable chunks.
 *
 * A Hamming-windowed sinc low-pass (7 kHz pass, 8 kHz stop, designed for the
 * actual context rate) runs only at the output instants, so 48 kHz -> 16 kHz
 * is an exact 3:1 decimation and 44.1 kHz still resamples correctly through
 * linear interpolation between two filtered samples.
 *
 * Runs in AudioWorkletGlobalScope: no imports, no DOM. Served from
 * `public/worklets/captureProcessor.js`; the source of truth is
 * `src/worklets/captureProcessor.js` (see scripts/sync-worklets.mjs).
 *
 * First input channel only; the output is silent (connect through a muted
 * GainNode to the destination so the graph keeps pulling).
 *
 * processorOptions: { targetRate?: 16000, chunkSize?: 160 }
 * port messages out:
 *   { type: 'ready', inputRate, outputRate, ratio, taps, latencyMs }
 *   { type: 'pcm', buffer, length, sampleRate, timestamp }   (buffer transferred)
 * port messages in:
 *   { type: 'recycle', buffer }   hand a consumed chunk back to the pool
 *   { type: 'reset' } | { type: 'getInfo' }
 */

const PROCESSOR_NAME = 'capture-processor';
const DEFAULT_TARGET_RATE = 16000;
const DEFAULT_CHUNK = 160;
const PASSBAND_HZ = 7000;
const STOPBAND_HZ = 8000;
const MAX_POOLED = 16;
const MAX_TAPS = 1023;

class Resampler {
  constructor(inputRate, outputRate) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.ratio = inputRate / outputRate;
    this.bypass = inputRate === outputRate;
    this.taps = 1;

    if (!this.bypass) {
      if (inputRate < outputRate) {
        throw new Error(`captureProcessor only downsamples; context is ${inputRate} Hz`);
      }
      // Hamming main-lobe rule: ~3.3 / (transition / fs) taps for ~53 dB stop.
      const transition = (STOPBAND_HZ - PASSBAND_HZ) / inputRate;
      let taps = Math.ceil(3.3 / transition);
      if (taps % 2 === 0) taps++;
      this.taps = Math.min(MAX_TAPS, Math.max(31, taps));

      const cutoff = (PASSBAND_HZ + STOPBAND_HZ) / 2 / inputRate;
      const centre = (this.taps - 1) / 2;
      this.coefficients = new Float64Array(this.taps);
      let sum = 0;
      for (let i = 0; i < this.taps; i++) {
        const n = i - centre;
        const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
        const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (this.taps - 1));
        this.coefficients[i] = sinc * window;
        sum += this.coefficients[i];
      }
      for (let i = 0; i < this.taps; i++) this.coefficients[i] /= sum;
    }

    let size = 256;
    while (size < this.taps + 2 * 128 + 2) size <<= 1;
    this.mask = size - 1;
    this.history = new Float32Array(size);
    this.written = 0;
    this.outputIndex = 0;
  }

  /** Group delay of the filter plus nothing else; chunking adds 10 ms. */
  get latencySeconds() {
    return (this.taps - 1) / 2 / this.inputRate;
  }

  reset() {
    this.history.fill(0);
    this.written = 0;
    this.outputIndex = 0;
  }

  /** Feeds a block; calls `emit(sample)` for each output-rate sample produced. */
  process(input, emit) {
    if (this.bypass) {
      for (let i = 0; i < input.length; i++) emit(input[i]);
      return;
    }

    const history = this.history;
    const mask = this.mask;
    for (let i = 0; i < input.length; i++) {
      history[this.written & mask] = input[i];
      this.written++;
    }

    for (;;) {
      const position = this.outputIndex * this.ratio;
      const base = Math.floor(position);
      const fraction = position - base;
      // Interpolation needs the sample after `base`; wait for it.
      if (base + (fraction > 0 ? 1 : 0) >= this.written) break;

      let value = this.filterAt(base);
      if (fraction > 0) value += (this.filterAt(base + 1) - value) * fraction;
      emit(value);
      this.outputIndex++;
    }
  }

  filterAt(index) {
    const h = this.coefficients;
    const history = this.history;
    const mask = this.mask;
    const taps = this.taps;
    let acc = 0;
    for (let j = 0; j < taps; j++) {
      const k = index - j;
      if (k < 0) break;
      acc += h[j] * history[k & mask];
    }
    return acc;
  }
}

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = (options && options.processorOptions) || {};
    this.outputRate = processorOptions.targetRate || DEFAULT_TARGET_RATE;
    this.chunkSize = processorOptions.chunkSize || DEFAULT_CHUNK;

    this.resampler = new Resampler(sampleRate, this.outputRate);
    this.pool = [];
    this.chunk = new Float32Array(this.chunkSize);
    this.fill = 0;
    this.emitted = 0;
    this.emit = (sample) => this.push(sample);

    this.port.onmessage = (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'recycle':
          if (
            message.buffer instanceof ArrayBuffer &&
            message.buffer.byteLength === this.chunkSize * 4 &&
            this.pool.length < MAX_POOLED
          ) {
            this.pool.push(new Float32Array(message.buffer));
          }
          break;
        case 'reset':
          this.resampler.reset();
          this.fill = 0;
          this.emitted = 0;
          break;
        case 'getInfo':
          this.port.postMessage({ type: 'info', ...this.info() });
          break;
        default:
          break;
      }
    };

    this.port.postMessage({ type: 'ready', ...this.info() });
  }

  info() {
    return {
      name: PROCESSOR_NAME,
      inputRate: sampleRate,
      outputRate: this.outputRate,
      ratio: this.resampler.ratio,
      taps: this.resampler.taps,
      chunkSize: this.chunkSize,
      latencyMs: (this.resampler.latencySeconds + this.chunkSize / this.outputRate) * 1000,
    };
  }

  push(sample) {
    this.chunk[this.fill++] = sample;
    if (this.fill < this.chunkSize) return;

    const buffer = this.chunk.buffer;
    this.port.postMessage(
      {
        type: 'pcm',
        buffer,
        length: this.chunkSize,
        sampleRate: this.outputRate,
        // Wall time of the chunk's first sample, in the AudioContext clock.
        timestamp: currentTime - this.chunkSize / this.outputRate,
      },
      [buffer],
    );
    this.emitted++;
    this.chunk = this.pool.pop() || new Float32Array(this.chunkSize);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    this.resampler.process(input[0], this.emit);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, CaptureProcessor);
