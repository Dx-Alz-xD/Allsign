/**
 * Fluency-assist AudioWorkletProcessor: Delayed Auditory Feedback (DAF) and
 * Frequency-Shifted Feedback (FSF).
 *
 * Signal path (first input channel, duplicated to every output channel):
 *
 *   in -> FSF phase vocoder (fixed latency) -> DAF fractional delay -> gain -> out
 *
 * The vocoder stays in the chain even while idle so its latency never changes;
 * toggling FSF therefore never jumps the delay. The DAF stage subtracts that
 * latency, so `dafDelayMs` is the total input-to-output delay the listener
 * hears (floored at the vocoder latency reported in the `ready` message).
 *
 * Runs in AudioWorkletGlobalScope: no imports, no DOM. Load with
 * `ctx.audioWorklet.addModule(url)` then
 * `new AudioWorkletNode(ctx, 'fluency-processor', { processorOptions })`.
 * Next.js: serve from `public/worklets/` or reference via
 * `new URL('@/worklets/fluencyProcessor.js', import.meta.url)`.
 *
 * AudioParams (all k-rate, read once per 128-frame quantum):
 *   dafDelayMs      30..150   total delay heard, default 60
 *   dafMix          0..1      0 = undelayed, 1 = fully delayed, default 1
 *   fsfOctaveShift  -0.5..0.5 pitch shift in octaves, default 0 (off)
 *   fsfMix          0..1      dry/wet for the shifted signal, default 1
 *   outputGain      0..2      default 1
 *   bypass          0|1       passes input straight through, default 0
 *
 * processorOptions: { fftFrameSize?, oversample?, maxDelayMs? }
 * port messages in:  { type: 'reset' } | { type: 'getInfo' }
 * port messages out: { type: 'ready' | 'info', ...ProcessorInfo }
 */

const PROCESSOR_NAME = 'fluency-processor';
const TWO_PI = 2 * Math.PI;

const MIN_DELAY_MS = 30;
const MAX_DELAY_MS = 150;
const DEFAULT_DELAY_MS = 60;
const MAX_OCTAVE_SHIFT = 0.5;
/**
 * Delay changes crossfade between the old and new tap over this window: no
 * click, and unlike gliding the read pointer, no pitch bend while it settles.
 */
const DELAY_FADE_MS = 20;
/** Below this the vocoder is skipped and the dry (equally delayed) path is used. */
const SHIFT_EPSILON = 1e-3;

class FFT {
  constructor(size) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, received ${size}`);
    }
    this.size = size;

    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-TWO_PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) {
        if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      }
      this.reverse[i] = r;
    }
  }

  /** In-place radix-2. Inverse is scaled by 1/N. */
  transform(re, im, inverse) {
    const n = this.size;
    const rev = this.reverse;

    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let swap = re[i];
        re[i] = re[j];
        re[j] = swap;
        swap = im[i];
        im[i] = im[j];
        im[j] = swap;
      }
    }

    const sign = inverse ? -1 : 1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let base = 0; base < n; base += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cosTable[k];
          const wi = sign * this.sinTable[k];
          const a = base + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }

    if (inverse) {
      const scale = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= scale;
        im[i] *= scale;
      }
    }
  }
}

/**
 * STFT pitch shifter: per-bin instantaneous frequency from the phase advance
 * between hops, bins remapped by the shift ratio, phases re-accumulated on
 * synthesis, Hann-windowed overlap-add. Output lags input by exactly one
 * frame; the input FIFO carries one extra hop so the dry tap sits at the same
 * latency as the synthesized signal.
 */
class PhaseVocoder {
  constructor(frameSize, oversample, sampleRate) {
    if (frameSize < 128 || (frameSize & (frameSize - 1)) !== 0) {
      throw new Error(`fftFrameSize must be a power of two >= 128, received ${frameSize}`);
    }
    if (oversample < 2 || frameSize % oversample !== 0) {
      throw new Error(`oversample must divide fftFrameSize, received ${oversample}`);
    }

    this.frameSize = frameSize;
    this.half = frameSize >> 1;
    this.hop = frameSize / oversample;
    this.oversample = oversample;
    this.latency = frameSize;
    this.freqPerBin = sampleRate / frameSize;
    this.expectedAdvance = (TWO_PI * this.hop) / frameSize;
    // Hann^2 summed across `oversample` overlapping hops is oversample * 3/8.
    this.olaGain = 8 / (3 * oversample);

    this.fft = new FFT(frameSize);
    this.window = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / frameSize);
    }

    this.inFifo = new Float32Array(frameSize + this.hop);
    this.outFifo = new Float32Array(this.hop);
    this.outAccum = new Float32Array(frameSize);
    this.re = new Float64Array(frameSize);
    this.im = new Float64Array(frameSize);
    this.lastPhase = new Float64Array(this.half + 1);
    this.prevPhase = new Float64Array(this.half + 1);
    this.sumPhase = new Float64Array(this.half + 1);
    this.anaMag = new Float64Array(this.half + 1);
    this.anaFreq = new Float64Array(this.half + 1);
    this.synMag = new Float64Array(this.half + 1);
    this.synFreq = new Float64Array(this.half + 1);

    this.cursor = frameSize;
    this.framesSinceReset = 0;
  }

  reset() {
    this.inFifo.fill(0);
    this.cursor = this.frameSize;
    this.resetSpectralState();
  }

  /** Clears synthesis memory only; the input FIFO keeps the dry path continuous. */
  resetSpectralState() {
    this.outFifo.fill(0);
    this.outAccum.fill(0);
    this.lastPhase.fill(0);
    this.sumPhase.fill(0);
    this.framesSinceReset = 0;
  }

  /**
   * Streams one block. `dry` receives the input delayed by exactly `latency`
   * samples; `wet` receives the pitch-shifted signal at the same latency, or
   * is left untouched when `active` is false.
   */
  process(input, dry, wet, ratio, active) {
    const inFifo = this.inFifo;
    const outFifo = this.outFifo;
    const frameSize = this.frameSize;
    const hop = this.hop;
    const capacity = frameSize + hop;
    let cursor = this.cursor;

    for (let i = 0; i < input.length; i++) {
      inFifo[cursor] = input[i];
      const readIndex = cursor - frameSize;
      dry[i] = inFifo[readIndex];
      if (active) wet[i] = outFifo[readIndex];
      cursor++;

      if (cursor >= capacity) {
        cursor = frameSize;
        if (active) this.transformFrame(ratio);
        inFifo.copyWithin(0, hop);
      }
    }

    this.cursor = cursor;
  }

  transformFrame(ratio) {
    const { frameSize, half, oversample, freqPerBin, expectedAdvance } = this;
    const { re, im, window, lastPhase, prevPhase, sumPhase, anaMag, anaFreq, synMag, synFreq } = this;
    const inFifo = this.inFifo;
    const hop = this.hop;

    // The first frame after (re)activation only primes lastPhase; the second
    // seeds each synthesis bin from its source bin's phase, so the wet path
    // starts phase-continuous with the dry path and the bins of one partial
    // keep the mutual phase relationship a windowed sinusoid has.
    const framesSinceReset = this.framesSinceReset++;
    const seed = framesSinceReset === 1;

    // The newest full frame; indices below `hop` are the dry tap's history.
    for (let k = 0; k < frameSize; k++) {
      re[k] = inFifo[hop + k] * window[k];
      im[k] = 0;
    }
    this.fft.transform(re, im, false);

    // Analysis: deviation of the measured phase advance from the bin centre
    // gives the true frequency of whatever partial dominates the bin.
    for (let k = 0; k <= half; k++) {
      const r = re[k];
      const j = im[k];
      const phase = Math.atan2(j, r);
      const previous = lastPhase[k];
      let delta = phase - previous - k * expectedAdvance;
      prevPhase[k] = previous;
      lastPhase[k] = phase;
      delta -= TWO_PI * Math.round(delta / TWO_PI);

      anaMag[k] = Math.sqrt(r * r + j * j);
      anaFreq[k] = (k + (delta * oversample) / TWO_PI) * freqPerBin;
    }
    if (framesSinceReset === 0) return;

    synMag.fill(0);
    synFreq.fill(0);
    for (let k = 0; k <= half; k++) {
      const target = Math.round(k * ratio);
      if (target > half) break;
      synMag[target] += anaMag[k];
      synFreq[target] = anaFreq[k] * ratio;
      if (seed) sumPhase[target] = prevPhase[k];
    }

    // Synthesis: integrate each bin's shifted frequency into a running phase.
    for (let k = 0; k <= half; k++) {
      const deviation = synFreq[k] / freqPerBin - k;
      let phase = sumPhase[k] + (deviation * TWO_PI) / oversample + k * expectedAdvance;
      phase -= TWO_PI * Math.floor(phase / TWO_PI);
      sumPhase[k] = phase;

      const magnitude = synMag[k];
      re[k] = magnitude * Math.cos(phase);
      im[k] = magnitude * Math.sin(phase);
    }
    im[0] = 0;
    im[half] = 0;
    for (let k = 1; k < half; k++) {
      re[frameSize - k] = re[k];
      im[frameSize - k] = -im[k];
    }

    this.fft.transform(re, im, true);

    const outAccum = this.outAccum;
    const gain = this.olaGain;
    for (let k = 0; k < frameSize; k++) {
      outAccum[k] += re[k] * window[k] * gain;
    }

    this.outFifo.set(outAccum.subarray(0, hop));
    outAccum.copyWithin(0, hop);
    outAccum.fill(0, frameSize - hop);
  }
}

/** Ring buffer with linear-interpolated fractional read. */
class FractionalDelay {
  constructor(maxDelaySamples) {
    let size = 2;
    while (size < maxDelaySamples + 2) size <<= 1;
    this.mask = size - 1;
    this.maxDelay = size - 2;
    this.buffer = new Float32Array(size);
    this.write = 0;
  }

  reset() {
    this.buffer.fill(0);
    this.write = 0;
  }

  push(sample) {
    this.buffer[this.write] = sample;
    this.write = (this.write + 1) & this.mask;
  }

  /** `delay` in samples, 0 = the sample just pushed. */
  read(delay) {
    const position = this.write - 1 - delay;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = this.buffer[index & this.mask];
    const b = this.buffer[(index + 1) & this.mask];
    return a + (b - a) * fraction;
  }
}

class FluencyProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'dafDelayMs',
        defaultValue: DEFAULT_DELAY_MS,
        minValue: MIN_DELAY_MS,
        maxValue: MAX_DELAY_MS,
        automationRate: 'k-rate',
      },
      { name: 'dafMix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      {
        name: 'fsfOctaveShift',
        defaultValue: 0,
        minValue: -MAX_OCTAVE_SHIFT,
        maxValue: MAX_OCTAVE_SHIFT,
        automationRate: 'k-rate',
      },
      { name: 'fsfMix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'outputGain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const processorOptions = (options && options.processorOptions) || {};

    // ~21ms vocoder latency at 48kHz; halved below 32kHz so a 16kHz context
    // lands at 32ms, just over the 30ms DAF floor.
    const frameSize = processorOptions.fftFrameSize ?? (sampleRate >= 32000 ? 1024 : 512);
    const oversample = processorOptions.oversample ?? 4;
    const maxDelayMs = Math.max(MAX_DELAY_MS, processorOptions.maxDelayMs ?? MAX_DELAY_MS);

    this.vocoder = new PhaseVocoder(frameSize, oversample, sampleRate);
    this.delay = new FractionalDelay(Math.ceil((maxDelayMs / 1000) * sampleRate));
    this.fadeLength = Math.max(1, Math.round((DELAY_FADE_MS / 1000) * sampleRate));
    /** Tap currently heard; -1 until the first block reads the parameter. */
    this.activeDelay = -1;
    this.fadeDelay = 0;
    /** Sample position inside the running crossfade, or -1 when idle. */
    this.fadePosition = -1;

    this.dry = new Float32Array(128);
    this.wet = new Float32Array(128);
    this.silence = new Float32Array(128);

    this.fsfWasActive = false;
    /** Samples since FSF engaged; gates the wet mix until the OLA has filled. */
    this.fsfWarmup = 0;
    this.lastGain = 1;
    this.lastDafMix = 1;
    this.lastFsfMix = 1;

    this.port.onmessage = (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'reset':
          this.reset();
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
    const latencySamples = this.vocoder.latency;
    return {
      name: PROCESSOR_NAME,
      sampleRate,
      fftFrameSize: this.vocoder.frameSize,
      oversample: this.vocoder.oversample,
      fsfLatencySamples: latencySamples,
      fsfLatencyMs: (latencySamples / sampleRate) * 1000,
      minDelayMs: MIN_DELAY_MS,
      maxDelayMs: (this.delay.maxDelay / sampleRate) * 1000,
      maxOctaveShift: MAX_OCTAVE_SHIFT,
    };
  }

  reset() {
    this.vocoder.reset();
    this.delay.reset();
    this.activeDelay = -1;
    this.fadePosition = -1;
    this.fsfWasActive = false;
    this.fsfWarmup = 0;
  }

  targetDelaySamples(delayMs) {
    const total = (delayMs / 1000) * sampleRate - this.vocoder.latency;
    return Math.min(this.delay.maxDelay, Math.max(0, total));
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const out0 = output[0];
    const frames = out0.length;

    if (this.dry.length !== frames) {
      this.dry = new Float32Array(frames);
      this.wet = new Float32Array(frames);
      this.silence = new Float32Array(frames);
    }

    const input = inputs[0];
    const inCh = input && input.length > 0 ? input[0] : this.silence;

    const bypass = parameters.bypass[0] >= 0.5;
    const dafMix = parameters.dafMix[0];
    const fsfMix = parameters.fsfMix[0];
    const gain = parameters.outputGain[0];
    const octaves = Math.max(
      -MAX_OCTAVE_SHIFT,
      Math.min(MAX_OCTAVE_SHIFT, parameters.fsfOctaveShift[0]),
    );
    const ratio = Math.pow(2, octaves);
    const fsfActive = !bypass && fsfMix > 0 && Math.abs(octaves) > SHIFT_EPSILON;

    const targetDelay = this.targetDelaySamples(parameters.dafDelayMs[0]);
    if (this.activeDelay < 0) this.activeDelay = targetDelay;
    // One crossfade at a time; a dragged slider is followed fade by fade.
    if (this.fadePosition < 0 && Math.abs(targetDelay - this.activeDelay) > 0.5) {
      this.fadeDelay = targetDelay;
      this.fadePosition = 0;
    }

    if (fsfActive && !this.fsfWasActive) {
      this.vocoder.resetSpectralState();
      this.fsfWarmup = 0;
    }
    this.fsfWasActive = fsfActive;

    const dry = this.dry;
    const wet = this.wet;
    this.vocoder.process(inCh, dry, wet, ratio, fsfActive);

    // Per-block parameter steps are ramped across the quantum to stay click-free.
    const gainStep = (gain - this.lastGain) / frames;
    const dafStep = (dafMix - this.lastDafMix) / frames;
    const fsfStep = (fsfMix - this.lastFsfMix) / frames;
    let g = this.lastGain;
    let dm = this.lastDafMix;
    let fm = this.lastFsfMix;

    const delay = this.delay;
    const fadeLength = this.fadeLength;
    const fadeDelay = this.fadeDelay;
    let activeDelay = this.activeDelay;
    let fadePosition = this.fadePosition;

    // Wet output is silent for one vocoder latency after engaging and then
    // builds up over the overlap; hold dry until then and crossfade in.
    const warmupStart = this.vocoder.latency;
    const warmupLength = this.vocoder.frameSize;
    let warmup = this.fsfWarmup;

    for (let i = 0; i < frames; i++) {
      let fed = dry[i];
      if (fsfActive) {
        let mix = fm;
        if (warmup < warmupStart + warmupLength) {
          mix *= Math.max(0, (warmup - warmupStart) / warmupLength);
          warmup++;
        }
        fed += (wet[i] - dry[i]) * mix;
      }
      delay.push(fed);

      let delayed = delay.read(activeDelay);
      if (fadePosition >= 0) {
        const incoming = delay.read(fadeDelay);
        delayed += (incoming - delayed) * (fadePosition / fadeLength);
        if (++fadePosition >= fadeLength) {
          activeDelay = fadeDelay;
          fadePosition = -1;
        }
      }

      out0[i] = bypass ? inCh[i] : (fed + (delayed - fed) * dm) * g;

      g += gainStep;
      dm += dafStep;
      fm += fsfStep;
    }

    this.activeDelay = activeDelay;
    this.fadePosition = fadePosition;
    this.fsfWarmup = warmup;
    this.lastGain = gain;
    this.lastDafMix = dafMix;
    this.lastFsfMix = fsfMix;

    for (let c = 1; c < output.length; c++) output[c].set(out0);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, FluencyProcessor);
