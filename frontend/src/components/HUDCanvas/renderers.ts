import { breathingTargetAt, cycleMs, type BreathingPattern } from '@/lib/hud/breathing';
import type { HudFrame } from '@/lib/hud/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CYAN = '#00F2FE';
const BLUE = '#4FACFE';
const MIST = '#A9B8CC';
const GRID = 'rgba(148, 197, 255, 0.10)';
const AXIS_HEIGHT = 20;
const SPECTROGRAM_GUTTER = 48;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

function neonGradient(ctx: CanvasRenderingContext2D, rect: Rect): CanvasGradient {
  const gradient = ctx.createLinearGradient(rect.x, 0, rect.x + rect.w, 0);
  gradient.addColorStop(0, CYAN);
  gradient.addColorStop(1, BLUE);
  return gradient;
}

function formatHz(hz: number): string {
  if (hz <= 0) return '0 Hz';
  if (hz < 1000) return `${Math.round(hz)} Hz`;
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function setLabelFont(ctx: CanvasRenderingContext2D, font: string) {
  ctx.font = `12px ${font}`;
  ctx.fillStyle = MIST;
}

/* Oscilloscope trace ----------------------------------------------------- */

export function drawWaveform(ctx: CanvasRenderingContext2D, rect: Rect, frame: HudFrame) {
  const mid = Math.round(rect.y + rect.h / 2) + 0.5;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x, mid);
  ctx.lineTo(rect.x + rect.w, mid);
  ctx.stroke();

  const samples = frame.waveform;
  const count = samples.length;
  if (count < 2) return;

  const step = Math.max(1, Math.floor(count / rect.w));
  const amplitude = rect.h * 0.46;
  ctx.beginPath();
  for (let i = 0; i < count; i += step) {
    const px = rect.x + (i / (count - 1)) * rect.w;
    const py = mid - samples[i] * amplitude;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.16)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = neonGradient(ctx, rect);
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* 128-bin spectral energy bars ------------------------------------------- */

export interface SpectrumState {
  levels: Float32Array;
  peaks: Float32Array;
}

export function createSpectrumState(binCount = 128): SpectrumState {
  return { levels: new Float32Array(binCount), peaks: new Float32Array(binCount) };
}

function drawFrequencyAxis(ctx: CanvasRenderingContext2D, rect: Rect, top: number, maxHz: number, font: string) {
  setLabelFont(ctx, font);
  ctx.textBaseline = 'top';
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  ticks.forEach((tick, index) => {
    ctx.textAlign = index === 0 ? 'left' : index === ticks.length - 1 ? 'right' : 'center';
    ctx.fillText(formatHz(maxHz * tick), rect.x + rect.w * tick, top);
  });
}

export function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  frame: HudFrame,
  state: SpectrumState,
  dtSeconds: number,
  font: string,
) {
  const bins = frame.telemetry.spectralBins;
  const count = Math.min(bins.length, state.levels.length);
  if (count === 0) return;

  const plotHeight = rect.h - AXIS_HEIGHT;
  const base = rect.y + plotHeight;
  const slot = rect.w / count;
  const gap = slot > 5 ? 2 : slot > 2.5 ? 1 : 0;
  const barWidth = Math.max(1, slot - gap);

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const quarter of [0.25, 0.5, 0.75]) {
    const gy = Math.round(base - plotHeight * quarter) + 0.5;
    ctx.moveTo(rect.x, gy);
    ctx.lineTo(rect.x + rect.w, gy);
  }
  ctx.stroke();

  // Instant attack, eased release, slow-falling peak caps.
  const release = dtSeconds * 1.8;
  const peakRelease = dtSeconds * 0.4;
  const { levels, peaks } = state;
  for (let i = 0; i < count; i += 1) {
    const value = clamp01(bins[i]);
    levels[i] = value >= levels[i] ? value : Math.max(value, levels[i] - release);
    peaks[i] = levels[i] >= peaks[i] ? levels[i] : Math.max(levels[i], peaks[i] - peakRelease);
  }

  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const barHeight = levels[i] * plotHeight;
    if (barHeight < 1) continue;
    ctx.rect(rect.x + i * slot + gap / 2 - 1.5, base - barHeight - 2, barWidth + 3, barHeight + 2);
  }
  ctx.fillStyle = 'rgba(0, 242, 254, 0.14)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const barHeight = Math.max(1, levels[i] * plotHeight);
    ctx.rect(rect.x + i * slot + gap / 2, base - barHeight, barWidth, barHeight);
  }
  ctx.fillStyle = neonGradient(ctx, rect);
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    if (peaks[i] < 0.02) continue;
    ctx.rect(rect.x + i * slot + gap / 2, base - peaks[i] * plotHeight - 3, barWidth, 1.5);
  }
  ctx.fillStyle = 'rgba(232, 241, 255, 0.8)';
  ctx.fill();

  drawFrequencyAxis(ctx, rect, base + 6, frame.spectrumMaxHz, font);
}

/* Scrolling spectrogram -------------------------------------------------- */

const COLORMAP_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [11, 15, 23]],
  [0.35, [18, 58, 107]],
  [0.62, [79, 172, 254]],
  [0.85, [0, 242, 254]],
  [1, [232, 254, 255]],
];

const COLORMAP: readonly string[] = Array.from({ length: 256 }, (_, index) => {
  const t = index / 255;
  let upper = 1;
  while (upper < COLORMAP_STOPS.length - 1 && COLORMAP_STOPS[upper][0] < t) upper += 1;
  const [t0, c0] = COLORMAP_STOPS[upper - 1];
  const [t1, c1] = COLORMAP_STOPS[upper];
  const mix = (t - t0) / (t1 - t0);
  const channel = (i: number) => Math.round(c0[i] + (c1[i] - c0[i]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
});

export interface SpectrogramState {
  /** Circular history: columns are written at `cursor`, which wraps at the buffer width. */
  buffer: HTMLCanvasElement | null;
  cursor: number;
  lastTimestamp: number;
}

export function createSpectrogramState(): SpectrogramState {
  return { buffer: null, cursor: 0, lastTimestamp: -1 };
}

export function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  frame: HudFrame,
  state: SpectrogramState,
  dpr: number,
  font: string,
) {
  const plot: Rect = { x: rect.x + SPECTROGRAM_GUTTER, y: rect.y, w: rect.w - SPECTROGRAM_GUTTER, h: rect.h };
  const width = Math.max(1, Math.round(plot.w * dpr));
  const height = Math.max(1, Math.round(plot.h * dpr));

  if (!state.buffer || state.buffer.width !== width || state.buffer.height !== height) {
    state.buffer = document.createElement('canvas');
    state.buffer.width = width;
    state.buffer.height = height;
    state.cursor = 0;
    const init = state.buffer.getContext('2d');
    if (init) {
      init.fillStyle = COLORMAP[0];
      init.fillRect(0, 0, width, height);
    }
  }
  const bufferCtx = state.buffer.getContext('2d');
  if (!bufferCtx) return;

  // One column per new telemetry frame, written into a ring so history never has to be copied.
  if (frame.telemetry.timestamp !== state.lastTimestamp) {
    state.lastTimestamp = frame.telemetry.timestamp;
    const bins = frame.telemetry.spectralBins;
    const rowHeight = height / bins.length;
    const columnWidth = Math.max(1, Math.round(dpr));
    for (let offset = 0; offset < columnWidth; offset += 1) {
      const columnX = (state.cursor + offset) % width;
      for (let bin = 0; bin < bins.length; bin += 1) {
        bufferCtx.fillStyle = COLORMAP[Math.round(clamp01(bins[bin]) * 255)];
        bufferCtx.fillRect(columnX, Math.floor(height - (bin + 1) * rowHeight), 1, Math.ceil(rowHeight) + 1);
      }
    }
    state.cursor = (state.cursor + columnWidth) % width;
  }

  // Oldest columns (cursor to end) on the left, newest (start to cursor) on the right.
  const scale = plot.w / width;
  const olderWidth = width - state.cursor;
  ctx.drawImage(state.buffer, state.cursor, 0, olderWidth, height, plot.x, plot.y, olderWidth * scale, plot.h);
  if (state.cursor > 0) {
    ctx.drawImage(state.buffer, 0, 0, state.cursor, height, plot.x + olderWidth * scale, plot.y, state.cursor * scale, plot.h);
  }

  setLabelFont(ctx, font);
  ctx.textAlign = 'right';
  const labelX = plot.x - 8;
  ctx.textBaseline = 'top';
  ctx.fillText(formatHz(frame.spectrumMaxHz), labelX, plot.y);
  ctx.textBaseline = 'middle';
  ctx.fillText(formatHz(frame.spectrumMaxHz / 2), labelX, plot.y + plot.h / 2);
  ctx.textBaseline = 'bottom';
  ctx.fillText('0 Hz', labelX, plot.y + plot.h);
}

/* Breathing wave guide with voice biofeedback ---------------------------- */

const TRAIL_CAPACITY = 900;

export interface BreathingRenderState {
  elapsed: Float64Array;
  level: Float32Array;
  head: number;
  size: number;
  version: number;
}

export function createBreathingState(): BreathingRenderState {
  return {
    elapsed: new Float64Array(TRAIL_CAPACITY),
    level: new Float32Array(TRAIL_CAPACITY),
    head: 0,
    size: 0,
    version: -1,
  };
}

export interface BreathingDrawOptions {
  pattern: BreathingPattern;
  elapsedMs: number;
  running: boolean;
  version: number;
  /** Current voice volume in [0, 1]. */
  voiceLevel: number;
  /** Keep the wave still and move the marker instead of scrolling. */
  reducedMotion: boolean;
  state: BreathingRenderState;
}

export function drawBreathing(ctx: CanvasRenderingContext2D, rect: Rect, options: BreathingDrawOptions) {
  const { pattern, elapsedMs, running, version, voiceLevel, reducedMotion, state } = options;

  if (state.version !== version) {
    state.version = version;
    state.head = 0;
    state.size = 0;
  }
  const lastIndex = (state.head - 1 + TRAIL_CAPACITY) % TRAIL_CAPACITY;
  if (running && (state.size === 0 || elapsedMs > state.elapsed[lastIndex])) {
    state.elapsed[state.head] = elapsedMs;
    state.level[state.head] = voiceLevel;
    state.head = (state.head + 1) % TRAIL_CAPACITY;
    state.size = Math.min(TRAIL_CAPACITY, state.size + 1);
  }

  const cycle = cycleMs(pattern);
  const padding = 12;
  const plotTop = rect.y + padding;
  const plotHeight = rect.h - padding * 2;
  const yFor = (value: number) => plotTop + (1 - value) * plotHeight;

  const msPerPx = reducedMotion ? cycle / rect.w : (cycle * 1.5) / rect.w;
  const originX = reducedMotion ? rect.x : rect.x + rect.w * 0.3;
  const originT = reducedMotion ? elapsedMs - (((elapsedMs % cycle) + cycle) % cycle) : elapsedMs;
  const timeAt = (px: number) => originT + (px - originX) * msPerPx;
  const xAt = (t: number) => originX + (t - originT) / msPerPx;
  const nowX = xAt(elapsedMs);
  const right = rect.x + rect.w;

  // Exhale windows, where gentle speech belongs.
  ctx.fillStyle = 'rgba(79, 172, 254, 0.08)';
  const firstCycle = Math.floor(timeAt(rect.x) / cycle) - 1;
  const endTime = timeAt(right);
  for (let c = firstCycle; c * cycle < endTime; c += 1) {
    const start = xAt(c * cycle + pattern.inhaleMs);
    const end = xAt(c * cycle + pattern.inhaleMs + pattern.exhaleMs);
    const x0 = Math.max(rect.x, start);
    const x1 = Math.min(right, end);
    if (x1 > x0) ctx.fillRect(x0, rect.y, x1 - x0, rect.h);
  }

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x, Math.round(yFor(0)) + 0.5);
  ctx.lineTo(right, Math.round(yFor(0)) + 0.5);
  ctx.stroke();

  const curve = new Path2D();
  const area = new Path2D();
  area.moveTo(rect.x, yFor(0));
  for (let px = rect.x; px <= right + 2; px += 2) {
    const py = yFor(breathingTargetAt(pattern, timeAt(px)));
    if (px === rect.x) curve.moveTo(px, py);
    else curve.lineTo(px, py);
    area.lineTo(px, py);
  }
  area.lineTo(right + 2, yFor(0));
  area.closePath();

  const areaFill = ctx.createLinearGradient(0, plotTop, 0, yFor(0));
  areaFill.addColorStop(0, 'rgba(0, 242, 254, 0.20)');
  areaFill.addColorStop(1, 'rgba(0, 242, 254, 0)');

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, Math.max(0, nowX - rect.x), rect.h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke(curve);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(nowX, rect.y, Math.max(0, right - nowX), rect.h);
  ctx.clip();
  ctx.fillStyle = areaFill;
  ctx.fill(area);
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.18)';
  ctx.lineWidth = 8;
  ctx.stroke(curve);
  ctx.strokeStyle = neonGradient(ctx, rect);
  ctx.lineWidth = 2.5;
  ctx.stroke(curve);
  ctx.restore();

  if (state.size > 1) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < state.size; i += 1) {
      const index = (state.head - state.size + i + TRAIL_CAPACITY) % TRAIL_CAPACITY;
      const px = xAt(state.elapsed[index]);
      if (px < rect.x || px > nowX + 1) {
        started = false;
        continue;
      }
      const py = yFor(clamp01(state.level[index]) * 0.95);
      if (started) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
      started = true;
    }
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(232, 241, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(nowX) + 0.5, rect.y);
  ctx.lineTo(Math.round(nowX) + 0.5, rect.y + rect.h);
  ctx.stroke();

  const markerY = yFor(breathingTargetAt(pattern, elapsedMs));
  ctx.fillStyle = 'rgba(0, 242, 254, 0.22)';
  ctx.beginPath();
  ctx.arc(nowX, markerY, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CYAN;
  ctx.beginPath();
  ctx.arc(nowX, markerY, 5, 0, Math.PI * 2);
  ctx.fill();
}
